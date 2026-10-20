import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { WebSocketServer } from 'ws';
import { createRegistration, createRegistrationStore, verifyRegistration, registrationIp } from '../src/registration.mjs';
import { createGateway } from '../src/server.mjs';
import { admitMember } from '../src/relay-admin.mjs';
import { connectAuthed, publish } from '../src/nostr-federation.mjs';

const endpoint = 'https://x.ruv.io/api/registration', time = 1800000000000;
function proof(sk, { url = endpoint, body = '{}', created_at = time / 1000, tags, ...rest } = {}) {
  const ev = finalizeEvent({ kind: 27235, created_at, content: '',
    tags: tags || [['u', url], ['method', 'POST'], ['payload', createHash('sha256').update(body).digest('hex')]], ...rest }, sk);
  return { ev, header: 'Nostr ' + Buffer.from(JSON.stringify(ev)).toString('base64') };
}
const req = (header, ip = '203.0.113.1') => ({ headers: { authorization: header }, socket: { remoteAddress: ip } });
// Transactional test adapter, not a production storage backend. The same store
// implementation is exercised with atomic serialization and rollback on throws.
function database() {
  const docs = new Map([['control', { enabled: true, revocationsImported: true }]]);
  let tail = Promise.resolve();
  return { docs, collection: () => ({ doc: id => id }), runTransaction(fn) {
    const result = tail.then(async () => {
      const next = structuredClone(docs);
      const value = await fn({ get: async id => ({ data: () => next.get(id) }),
        set: (id, val) => next.set(id, val), update: (id, val) => next.set(id, { ...next.get(id), ...val }) });
      docs.clear(); for (const [k, v] of next) docs.set(k, v);
      return value;
    }); tail = result.catch(() => {}); return result;
  } };
}
function service(extra = {}) {
  const db = database(), admissions = [];
  const options = { enabled: true, publicUrl: 'https://x.ruv.io', ipSalt: 'test-only-salt-'.repeat(3),
    store: createRegistrationStore(db), admit: async (...a) => admissions.push(a), now: () => time, ...extra };
  return { db, admissions, options, registration: createRegistration(options) };
}

test('registration verifies ownership and all exact NIP-98 bindings', () => {
  const sk = generateSecretKey(), good = proof(sk);
  assert.equal(verifyRegistration(good.header, '{}', endpoint, time).pubkey, getPublicKey(sk));
  for (const changed of [{ url: 'https://attacker.test/api/registration' }, { body: '{"role":"admin"}' },
    { kind: 1 }, { content: 'not empty' }, { created_at: time / 1000 - 61 }, { created_at: time / 1000 + 6 },
    { tags: [['u', endpoint], ['u', endpoint], ['method', 'POST']] }]) {
    assert.throws(() => verifyRegistration(proof(sk, changed).header, '{}', endpoint, time));
  }
  const forged = { ...good.ev, pubkey: getPublicKey(generateSecretKey()) };
  assert.throws(() => verifyRegistration('Nostr ' + Buffer.from(JSON.stringify(forged)).toString('base64'), '{}', endpoint, time), /signature/);
  for (const header of ['', 'Bearer token', 'Nostr ####', 'Nostr ' + 'A'.repeat(4096)]) assert.throws(() => verifyRegistration(header, '{}', endpoint, time));
  assert.throws(() => verifyRegistration(good.header, '{"pubkey":"other"}', endpoint, time), /body/);
});

test('proxy trust is explicit; spoofed leftmost address never selects quota identity', () => {
  const r = req(''); r.headers['x-forwarded-for'] = '198.51.100.99, 203.0.113.4';
  assert.equal(registrationIp(r), '203.0.113.1');
  assert.equal(registrationIp(r, 1), '203.0.113.4');
  assert.equal(registrationIp(req('', '::ffff:127.0.0.1')), '127.0.0.1');
  assert.equal(registrationIp(req('', '2001:0db8:0000:0001::1')), registrationIp(req('', '2001:db8:0:1::abcd')));
  assert.throws(() => registrationIp({ headers: {}, socket: {} }, 1));
  assert.throws(() => createRegistration({ trustedProxyHops: -1 }));
});

test('grants exactly the signer as member; replay and concurrent retry produce one effect', async () => {
  const s = service(), sk = generateSecretKey(), p = proof(sk);
  const results = await Promise.allSettled([s.registration.register(req(p.header), '{}'), s.registration.register(req(p.header), '{}')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.deepEqual(s.admissions, [[getPublicKey(sk), 'member']]);
  assert.equal(results.find(r => r.status === 'fulfilled').value.membershipVerified, false);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  // New process, same database: quota/replay state survives. A new signed request
  // for the same key never re-grants membership after a relay-side revocation.
  const restarted = createRegistration(s.options);
  const r = await restarted.register(req(proof(sk, { created_at: time / 1000 + 1 }).header), '{}');
  assert.equal(r.alreadyRegistered, true); assert.equal(s.admissions.length, 1);
  const keyDoc = s.db.docs.get('key_' + getPublicKey(sk)); keyDoc.status = 'blocked';
  await assert.rejects(restarted.register(req(proof(sk, { created_at: time / 1000 + 2 }).header), '{}'), { status: 403 });
});

test('invalid requests, pause, unimported revocations and missing durable config fail closed', async () => {
  const s = service(), p = proof(generateSecretKey());
  await assert.rejects(s.registration.register(req(p.header), '{"role":"admin"}'), { status: 400 });
  await assert.rejects(s.registration.register(req(''), '{}'), { status: 401 });
  s.db.docs.set('control', { enabled: false, revocationsImported: true });
  await assert.rejects(s.registration.register(req(p.header), '{}'), { status: 503 });
  s.db.docs.set('control', { enabled: true });
  await assert.rejects(s.registration.register(req(p.header), '{}'), { status: 503 });
  await assert.rejects(createRegistration({ publicUrl: 'https://x.ruv.io' }).register(req(p.header), '{}'), { status: 503 });
  assert.throws(() => createRegistration({ enabled: true }), /durable store/);
  assert.equal(s.admissions.length, 0);
});

test('IP and global quotas are atomic across independent service instances', async () => {
  const s = service({ limits: { ipHourly: 2, daily: 3, maxConcurrent: 4 } });
  const other = createRegistration(s.options);
  await s.registration.register(req(proof(generateSecretKey()).header), '{}');
  await other.register(req(proof(generateSecretKey()).header), '{}');
  await assert.rejects(other.register(req(proof(generateSecretKey()).header), '{}'), { status: 429 });
  await other.register(req(proof(generateSecretKey()).header, '203.0.113.2'), '{}');
  await assert.rejects(s.registration.register(req(proof(generateSecretKey()).header, '203.0.113.3'), '{}'), { status: 429 });
  assert.equal(s.admissions.length, 3);
  assert.ok(!JSON.stringify([...s.db.docs]).includes('203.0.113'), 'raw IPs are never persisted');
});

test('relay failure keeps reservation and suppresses errors; retry cannot re-admit', async () => {
  let effects = 0;
  const s = service({ admit: async () => { effects++; throw new Error('private backend detail'); } }), sk = generateSecretKey();
  await assert.rejects(s.registration.register(req(proof(sk).header), '{}'), e => e.status === 503 && !e.message.includes('private'));
  await assert.rejects(s.registration.register(req(proof(sk, { created_at: time / 1000 + 1 }).header), '{}'), { status: 409 });
  assert.equal(effects, 1);
});

test('in-flight shedding bounds relay work before reservations', async () => {
  let release;
  const s = service({ limits: { ipHourly: 3, daily: 100, maxConcurrent: 1 }, admit: () => new Promise(r => { release = r; }) });
  const pending = s.registration.register(req(proof(generateSecretKey()).header), '{}');
  while (!release) await new Promise(r => setImmediate(r));
  await assert.rejects(s.registration.register(req(proof(generateSecretKey()).header), '{}'), { status: 429 });
  release(); await pending;
});

test('HTTP enrollment -> relay admission -> same-key AUTH and signed event acknowledgment', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'registration-e2e-'));
  const admin = generateSecretKey(), user = generateSecretKey(), members = new Set([getPublicKey(admin)]), events = [];
  const wss = new WebSocketServer({ port: 0 }); await new Promise(r => wss.once('listening', r));
  const relay = `ws://127.0.0.1:${wss.address().port}`;
  wss.on('connection', ws => {
    let authenticated;
    ws.send(JSON.stringify(['AUTH', 'e2e-challenge']));
    ws.on('message', data => {
      const [type, event] = JSON.parse(data);
      assert.ok(verifyEvent(event));
      if (type === 'AUTH') {
        const ok = members.has(event.pubkey) && event.kind === 22242 && event.tags.some(x => x[0] === 'relay' && x[1] === relay);
        if (ok) authenticated = event.pubkey;
        ws.send(JSON.stringify(['OK', event.id, ok, ok ? '' : 'not a member']));
      } else if (type === 'EVENT') {
        let ok = authenticated === event.pubkey;
        if (event.kind === 9030) {
          ok &&= authenticated === getPublicKey(admin) && event.tags.some(x => x[0] === 'role' && x[1] === 'member');
          if (ok) members.add(event.tags.find(x => x[0] === 'p')[1]);
        } else if (ok) events.push(event);
        ws.send(JSON.stringify(['OK', event.id, ok, '']));
      }
    });
  });
  let reg;
  const gw = createGateway({ relay, keyFile: join(dir, 'gateway.key'), registration: { info: () => reg.info(), register: (...a) => reg.register(...a) } });
  const port = await gw.listen(0), base = `http://127.0.0.1:${port}`;
  reg = service({ publicUrl: base, now: Date.now, admit: (pk, role) => admitMember(relay, admin, pk, role) }).registration;
  t.after(async () => { gw.server.closeAllConnections(); await new Promise(r => gw.server.close(r)); for (const c of wss.clients) c.terminate(); await new Promise(r => wss.close(r)); rmSync(dir, { recursive: true, force: true }); });
  const meta = await (await fetch(base + '/api/registration')).json(); assert.equal(meta.role, 'member');
  await assert.rejects(connectAuthed(relay, user), /not a member/);
  const p = proof(user, { url: base + '/api/registration', created_at: Math.floor(Date.now() / 1000) });
  const response = await fetch(base + '/api/registration', { method: 'POST', headers: { authorization: p.header }, body: '{}' });
  assert.equal(response.status, 200); assert.equal((await response.json()).pubkey, getPublicKey(user));
  const ws = await connectAuthed(relay, user); ws.close();
  const id = await publish(relay, user, 'Status', { note: 'local registration acceptance test' });
  assert.equal(events.length, 1); assert.equal(events[0].pubkey, getPublicKey(user)); assert.equal(events[0].id, id);
  const replay = await fetch(base + '/api/registration', { method: 'POST', headers: { authorization: p.header }, body: '{}' }); assert.equal(replay.status, 409);
  assert.equal((await fetch(base + '/api/registration', { method: 'PUT' })).status, 405);
  assert.equal((await fetch(base + '/api/registration?target=other')).status, 400);
});

test('revocation procedure pauses, drains, blocks, revokes, then refuses reenrollment', async () => {
  let release;
  const members = new Set(), sk = generateSecretKey(), pk = getPublicKey(sk);
  const s = service({ admit: () => new Promise(r => { release = () => { members.add(pk); r(); }; }) });
  const inFlight = s.registration.register(req(proof(sk).header), '{}');
  while (!release) await new Promise(r => setImmediate(r));
  s.db.docs.set('control', { enabled: false, revocationsImported: true });
  await assert.rejects(s.registration.register(req(proof(generateSecretKey()).header), '{}'), { status: 503 });
  release(); await inFlight; // Drain before revoking; earlier admission can finish.
  s.db.docs.set('key_' + pk, { status: 'blocked' });
  members.delete(pk); // Operator's relay revocation, after the drain.
  s.db.docs.set('control', { enabled: true, revocationsImported: true });
  await assert.rejects(s.registration.register(req(proof(sk, { created_at: time / 1000 + 1 }).header), '{}'), { status: 403 });
  assert.equal(members.has(pk), false);
});

test('an unrelated relay OK cannot authenticate the gateway signer', async () => {
  const wss = new WebSocketServer({ port: 0 }); await new Promise(r => wss.once('listening', r));
  wss.on('connection', ws => {
    ws.send(JSON.stringify(['AUTH', 'challenge']));
    ws.on('message', data => {
      const [, ev] = JSON.parse(data);
      ws.send(JSON.stringify(['OK', 'unrelated', true, '']));
      ws.send(JSON.stringify(['OK', ev.id, false, 'denied']));
    });
  });
  try { await assert.rejects(connectAuthed(`ws://127.0.0.1:${wss.address().port}`, generateSecretKey()), /denied/); }
  finally { for (const c of wss.clients) c.terminate(); await new Promise(r => wss.close(r)); }
});

test('a live ban or unavailable restrictions blocks the grant after reservation', async () => {
  const { RegistrationError } = await import('../src/registration.mjs');
  for (const error of [new RegistrationError(403, 'registration denied'), new Error('backend detail')]) {
    const s = service({ checkAllowed: async () => { throw error; } });
    await assert.rejects(s.registration.register(req(proof(generateSecretKey()).header), '{}'), { status: error.status || 503 });
    assert.equal(s.admissions.length, 0);
  }
});
