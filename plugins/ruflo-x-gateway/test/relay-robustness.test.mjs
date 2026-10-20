// Relay robustness for the read helpers and the read tools built on them.
//
// What used to happen, reproduced against the unpatched helpers with the fake relay below:
//   - a malformed frame ('not json{', 'null', an EVENT whose event is a string) threw inside the
//     socket's 'message' listener: an uncaught exception, which takes the whole process down;
//   - ['CLOSED', sub, 'invalid: filter'] and an abrupt socket drop were ignored, so the call
//     waited out the full 12 s timer and returned [] as if the relay had nothing to say;
//   - limit/sinceSeconds went to the relay unchecked (channel_list {limit:-1} took 12.2 s live).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { fetchRecent, fetchManyOn, fetchChannel, listChannels, publish, publishTagged, cached } from '../src/nostr-federation.mjs';
import { createGateway } from '../src/server.mjs';

// Any exception that escapes a socket listener lands here instead of failing a test, so every
// test asserts this stays empty. splice() so one leak fails the test that caused it, not every
// test after it.
const escaped = [];
process.on('uncaughtException', (e) => escaped.push(e));
process.on('unhandledRejection', (e) => escaped.push(e));
afterEach(() => { assert.deepEqual(escaped.splice(0), [], 'an error escaped a socket listener'); });

/**
 * A NIP-42 relay stand-in. It sends an AUTH challenge, accepts any correctly signed kind-22242
 * reply with OK, then hands every REQ to `onReq(sock, subId, filter)`. `onClose` sees the
 * client's CLOSE frames, `onEvent(sock, event)` the client's EVENTs. `stats` records what reached it.
 */
async function fakeRelay(onReq, { onClose, onEvent } = {}) {
  const wss = new WebSocketServer({ port: 0 });
  const stats = { conns: 0, reqs: 0, filters: [] };
  wss.on('connection', (sock) => {
    stats.conns++;
    sock.send(JSON.stringify(['AUTH', 'chal-' + Math.random().toString(36).slice(2)]));
    sock.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m[0] === 'AUTH') { sock.send(JSON.stringify(['OK', m[1].id, m[1].kind === 22242 && verifyEvent(m[1]), ''])); return; }
      if (m[0] === 'REQ') { stats.reqs++; stats.filters.push(m[2]); onReq(sock, m[1], m[2]); }
      if (m[0] === 'CLOSE') onClose?.(sock, m[1]);
      if (m[0] === 'EVENT') onEvent?.(sock, m[1]);
    });
  });
  await new Promise((r) => wss.once('listening', r));
  return {
    url: `ws://127.0.0.1:${wss.address().port}`,
    stats,
    close: () => { for (const c of wss.clients) c.terminate(); wss.close(); },
  };
}

const author = generateSecretKey();
const signed = (content, tags = [['t', 'ruflo-swarm']]) =>
  finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content }, author);
const send = (sock, frame) => sock.send(typeof frame === 'string' ? frame : JSON.stringify(frame));

// Reply shapes, one per failure mode.
const answer = (events) => (sock, sub) => { for (const e of events) send(sock, ['EVENT', sub, e]); send(sock, ['EOSE', sub]); };
const malformedThen = (events) => (sock, sub) => {
  for (const junk of ['not json{', 'null', '42', '"EOSE"', '{"0":"EOSE"}',
    JSON.stringify(['EVENT', sub]), JSON.stringify(['EVENT', sub, null]), JSON.stringify(['EVENT', sub, 'str']),
    JSON.stringify(['EVENT', sub, 7]), JSON.stringify(['EVENT', sub, {}]),
    JSON.stringify(['EVENT', 'not-our-sub', signed('{"type":"Foreign"}')]), JSON.stringify(['EOSE', 'not-our-sub'])]) send(sock, junk);
  answer(events)(sock, sub);
};
const refuse = (reason) => (sock, sub) => send(sock, ['CLOSED', sub, reason]);
const drop = (sock) => sock.terminate();
const silent = () => {};

const timed = async (p) => { const t0 = Date.now(); try { return { value: await p, ms: Date.now() - t0 }; } catch (error) { return { error, ms: Date.now() - t0 }; } };
const sk = generateSecretKey();

test('fetch helpers: events + EOSE resolve as before, unmarked', async () => {
  const relay = await fakeRelay(answer([signed(JSON.stringify({ type: 'Status', n: 1 })), signed(JSON.stringify({ type: 'Status', n: 2 }), [['t', 'ruflo-swarm'], ['c', 'pub:ops']])]));
  try {
    const recent = await fetchRecent(relay.url, sk, {});
    assert.deepEqual(recent.map((m) => m.n), [1, 2]);
    assert.equal(recent.partial, undefined, 'a complete answer is not marked partial');
    assert.equal(JSON.stringify(Object.keys(recent)), '["0","1"]', 'no enumerable marker on the array');
    const chan = await fetchChannel(relay.url, sk, { channelId: 'pub:ops' });
    assert.equal(chan.length, 2);
    assert.equal(chan[1].channel, 'pub:ops');
    const many = await fetchManyOn(relay.url, sk, [{ limit: 1 }, { limit: 2 }]);
    assert.deepEqual(many.map((r) => r.length), [2, 2]);
    assert.equal(many.partial, undefined);
  } finally { relay.close(); }
  assert.deepEqual(escaped, []);
});

test('fetch helpers: malformed and foreign frames are skipped, not thrown', async () => {
  const good = signed(JSON.stringify({ type: 'Status', ok: true }), [['t', 'ruflo-swarm'], ['c', 'pub:ops']]);
  const relay = await fakeRelay(malformedThen([good]));
  try {
    for (const [name, call] of [
      ['fetchRecent', () => fetchRecent(relay.url, sk, {})],
      ['fetchChannel', () => fetchChannel(relay.url, sk, { channelId: 'pub:ops' })],
    ]) {
      const { value, error, ms } = await timed(call());
      assert.equal(error, undefined, `${name} rejected: ${error?.message}`);
      assert.equal(value.length, 1, `${name}: only the one valid event survives`);
      assert.equal(value[0].id, good.id);
      assert.equal(value.partial, undefined, `${name}: the EOSE after the junk still completes the round`);
      assert.ok(ms < 2000, `${name} took ${ms} ms`);
    }
    const [many] = await fetchManyOn(relay.url, sk, [{ limit: 5 }]);
    assert.deepEqual(many.map((e) => e.id), [good.id]);
  } finally { relay.close(); }
  assert.deepEqual(escaped, [], 'a malformed frame escaped a socket listener');
});

test('fetch helpers: relay CLOSED rejects fast with the relay reason', async () => {
  const relay = await fakeRelay(refuse('invalid: filter'));
  try {
    for (const [name, call] of [
      ['fetchRecent', () => fetchRecent(relay.url, sk, {})],
      ['fetchChannel', () => fetchChannel(relay.url, sk, { channelId: 'pub:ops' })],
      ['fetchManyOn', () => fetchManyOn(relay.url, sk, [{ limit: 1 }, { limit: 1 }])],
      ['listChannels', () => listChannels(relay.url, sk, {})],
    ]) {
      const { error, ms } = await timed(call());
      assert.ok(error, `${name} resolved on a CLOSED`);
      assert.match(error.message, /relay closed subscription \S+: invalid: filter/, name);
      assert.ok(ms < 2000, `${name} took ${ms} ms`);
    }
  } finally { relay.close(); }
  assert.deepEqual(escaped, []);
});

test('fetch helpers: an abrupt socket close before EOSE rejects fast', async () => {
  const relay = await fakeRelay(drop);
  try {
    for (const [name, call] of [
      ['fetchRecent', () => fetchRecent(relay.url, sk, {})],
      ['fetchChannel', () => fetchChannel(relay.url, sk, { channelId: 'pub:ops' })],
      ['fetchManyOn', () => fetchManyOn(relay.url, sk, [{ limit: 1 }])],
    ]) {
      const { error, ms } = await timed(call());
      assert.ok(error, `${name} resolved on a dropped socket`);
      assert.match(error.message, /relay closed the connection before EOSE \(code 1006\)/, name);
      assert.ok(ms < 2000, `${name} took ${ms} ms`);
    }
  } finally { relay.close(); }
  assert.deepEqual(escaped, []);
});

test('fetch helpers: a socket error before EOSE rejects fast, and carries the last NOTICE', async () => {
  // A frame over the client's 256 KiB maxPayload is a ws 'error' on an already-authed socket,
  // the path connectAuthed's listeners used to swallow.
  const relay = await fakeRelay((sock) => { send(sock, ['NOTICE', 'slow down\nplease']); send(sock, 'x'.repeat(300 * 1024)); });
  try {
    const { error, ms } = await timed(fetchRecent(relay.url, sk, {}));
    assert.ok(error);
    assert.match(error.message, /relay connection error before EOSE: Max payload size exceeded/);
    assert.match(error.message, /last relay NOTICE: slow down please\)$/, 'NOTICE text is kept, on one line');
    assert.ok(ms < 2000, `took ${ms} ms`);
  } finally { relay.close(); }
  assert.deepEqual(escaped, []);
});

test('fetch helpers: a silent relay resolves what arrived at the timer, marked partial', async () => {
  const early = signed(JSON.stringify({ type: 'Status', early: true }), [['t', 'ruflo-swarm'], ['c', 'pub:ops']]);
  const relay = await fakeRelay((sock, sub) => { send(sock, ['NOTICE', 'ERROR: too many concurrent REQs']); send(sock, ['EVENT', sub, early]); });
  try {
    const { value, ms } = await timed(fetchRecent(relay.url, sk, { timeoutMs: 300 }));
    assert.deepEqual(value.map((e) => e.id), [early.id], 'what arrived before the timer is kept');
    assert.equal(value.partial, true);
    assert.equal(value.relayNotice, 'ERROR: too many concurrent REQs');
    assert.equal(JSON.stringify(value), JSON.stringify([...value]), 'the marker does not change the serialised shape');
    assert.ok(ms >= 250 && ms < 2000, `took ${ms} ms`);

    const chan = await fetchChannel(relay.url, sk, { channelId: 'pub:ops', timeoutMs: 300 });
    assert.equal(chan.partial, true);
    const many = await fetchManyOn(relay.url, sk, [{ limit: 1 }, { limit: 1 }], { timeoutMs: 300 });
    assert.equal(many.partial, true);
    assert.deepEqual(many.map((r) => r.length), [1, 1]);
    // seraphina_guidance reads the mark this way (array destructuring would drop it).
    const { 0: first, partial } = many;
    assert.equal(first.length, 1);
    assert.equal(partial, true);
    // listChannels builds a fresh array; the mark has to survive that.
    const channels = await listChannels(relay.url, sk, { timeoutMs: 300 });
    assert.equal(channels.partial, true);
    assert.ok(channels.some((c) => c.channel === 'pub:ops' && c.messages === 1));
  } finally { relay.close(); }
  assert.deepEqual(escaped, []);
});

test('fetchManyOn: CLOSED after EOSE is the reply to our CLOSE, not a failure; duplicate and foreign EOSE are ignored', async () => {
  const late = signed(JSON.stringify({ type: 'Status', late: true }));
  const relay = await fakeRelay((sock, sub, filter) => {
    if (sub === 'q0') { send(sock, ['EOSE', 'q0']); send(sock, ['EOSE', 'q0']); return; }
    // Before the fix a foreign 'q9' EVENT hit results[9].push (TypeError, uncaught) and a
    // foreign EOSE decremented the open counter, finishing before q1 had answered.
    send(sock, ['EVENT', 'q9', late]); send(sock, ['EOSE', 'q9']);
    setTimeout(() => { send(sock, ['EVENT', sub, late]); send(sock, ['EOSE', sub]); }, 100);
  }, { onClose: (sock, sub) => send(sock, ['CLOSED', sub, 'closed by client']) });
  try {
    const { value, error, ms } = await timed(fetchManyOn(relay.url, sk, [{ limit: 1 }, { limit: 1 }]));
    assert.equal(error, undefined, `rejected: ${error?.message}`);
    assert.deepEqual(value.map((r) => r.length), [0, 1], 'q1 was waited for and got its event');
    assert.equal(value.partial, undefined);
    assert.ok(ms < 2000, `took ${ms} ms`);
  } finally { relay.close(); }
  assert.deepEqual(escaped, []);
});

test('fetch helpers: a CLOSED for some other sub id is ignored', async () => {
  const e = signed(JSON.stringify({ type: 'Status' }));
  const relay = await fakeRelay((sock, sub) => { send(sock, ['CLOSED', 'someone-else', 'invalid: filter']); answer([e])(sock, sub); });
  try {
    assert.equal((await fetchRecent(relay.url, sk, {})).length, 1);
  } finally { relay.close(); }
});

test('fetch helpers: relay text in an error is one line with no Unicode line or bidi controls', async () => {
  const relay = await fakeRelay(refuse('invalid:\u2028line two\u202egnp.exe\u2066x\u2069\u0085end\u0007'));
  try {
    const { error } = await timed(fetchRecent(relay.url, sk, {}));
    assert.ok(error);
    assert.equal(error.message, 'relay closed subscription ruflo-sync: invalid: line two gnp.exe x end');
  } finally { relay.close(); }
});

test('fetchManyOn: no filters resolves [] without dialing the relay', async () => {
  const relay = await fakeRelay(silent);
  try {
    const { value, ms } = await timed(fetchManyOn(relay.url, sk, []));
    assert.deepEqual(value, []);
    assert.equal(value.partial, undefined);
    assert.ok(ms < 500, `took ${ms} ms`);
    assert.equal(relay.stats.conns, 0);
  } finally { relay.close(); }
});

test('cached: a partial read is returned but not cached; a complete one is', async () => {
  const relay = await fakeRelay(silent);
  let calls = 0;
  const read = () => { calls++; return fetchRecent(relay.url, sk, { timeoutMs: 200 }); };
  try {
    const key = 'rr-partial-' + Math.random();
    assert.equal((await cached(key, 60_000, read)).partial, true);
    assert.equal((await cached(key, 60_000, read)).partial, true);
    assert.equal(calls, 2, 'the partial result was served from cache instead of retrying the relay');
    const full = ['complete'];
    const key2 = 'rr-full-' + Math.random();
    assert.equal(await cached(key2, 60_000, async () => full), full);
    assert.equal(await cached(key2, 60_000, async () => ['fresh']), full, 'a complete result is cached as before');
  } finally { relay.close(); }
});

test('publish / publishTagged: malformed frames before the OK are skipped, not thrown', async () => {
  const relay = await fakeRelay(silent, { onEvent: (sock, ev) => {
    for (const junk of ['not json{', 'null', '42', '"OK"', '{"0":"OK"}', JSON.stringify(['OK', 'someone-else', true, ''])]) send(sock, junk);
    send(sock, ['OK', ev.id, true, '']);
  } });
  try {
    for (const [name, call] of [
      ['publish', () => publish(relay.url, sk, 'Status', { n: 1 })],
      ['publishTagged', () => publishTagged(relay.url, sk, [['t', 'ruflo-swarm'], ['c', 'pub:ops']], '{"type":"Status"}')],
    ]) {
      const { value, error, ms } = await timed(call());
      assert.equal(error, undefined, `${name} rejected: ${error?.message}`);
      assert.match(value, /^[0-9a-f]{64}$/, `${name} resolves the event id`);
      assert.ok(ms < 2000, `${name} took ${ms} ms`);
    }
  } finally { relay.close(); }
});

// ---- tool layer ----

async function gatewayOn(relayUrl) {
  process.env.RUFLO_ADMIN_TOKEN = 'test-admin-token';
  const gw = createGateway({ relay: relayUrl, keyFile: '/tmp/x-gw-rr-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.key', port: 0 });
  const port = await gw.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const rpc = async (path, method, params) => {
    const raw = await fetch(base + path, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.text());
    return JSON.parse(raw.slice(raw.indexOf('{')));
  };
  const call = async (name, args, path = '/mcp') => {
    const t0 = Date.now();
    const { result, error } = await rpc(path, 'tools/call', { name, arguments: args });
    assert.equal(error, undefined, `JSON-RPC error instead of a tool result: ${JSON.stringify(error)}`);
    return { isError: result.isError === true, text: result.content?.[0]?.text ?? '', ms: Date.now() - t0 };
  };
  return { rpc, call, close: () => gw.server.close() };
}

test('tools: a relay CLOSED or dropped socket is a fast isError result naming the reason', async () => {
  for (const [label, onReq, re] of [
    ['CLOSED', refuse('invalid: filter'), /relay closed subscription ruflo-\w+: invalid: filter/],
    ['drop', drop, /relay closed the connection before EOSE \(code 1006\)/],
  ]) {
    const relay = await fakeRelay(onReq);
    const gw = await gatewayOn(relay.url);
    try {
      for (const [name, args] of [['channel_list', {}], ['channel_sync', { channel: 'pub:ops' }], ['federation_sync', {}], ['claims_status', {}]]) {
        const r = await gw.call(name, args);
        assert.equal(r.isError, true, `${label}/${name} returned a result instead of an error: ${r.text.slice(0, 200)}`);
        assert.match(r.text, re, `${label}/${name}`);
        assert.ok(r.ms < 2000, `${label}/${name} took ${r.ms} ms`);
      }
    } finally { gw.close(); relay.close(); }
  }
  assert.deepEqual(escaped, []);
});

test('tools: malformed frames do not break a read, and a complete read is not marked partial', async () => {
  const relay = await fakeRelay(malformedThen([signed(JSON.stringify({ type: 'Status', hello: 'world' }), [['t', 'ruflo-swarm'], ['c', 'pub:ops']])]));
  const gw = await gatewayOn(relay.url);
  try {
    for (const [name, args] of [['federation_sync', { limit: 10 }], ['channel_sync', { channel: 'pub:ops' }]]) {
      const r = await gw.call(name, args);
      assert.equal(r.isError, false, `${name}: ${r.text.slice(0, 200)}`);
      assert.match(r.text, /"count":1,/, name);
      assert.doesNotMatch(r.text, /"partial"|may be incomplete/, `${name}: a complete read must not be marked partial`);
    }
  } finally { gw.close(); relay.close(); }
  assert.deepEqual(escaped, []);
});

test('tools + resources: a read cut off by the relay timer says so outside the fence', async () => {
  // The tool layer has no timeout knob (timeoutMs is stripped by the schema), so this pays the
  // real 12 s timer once: every read runs concurrently against the same silent relay.
  const claim = signed(JSON.stringify({ type: 'ClaimIssued', from: 'n1', resourceId: 'task-42' }), [['t', 'ruflo-swarm'], ['c', 'pub:ops']]);
  const relay = await fakeRelay((sock, sub) => { send(sock, ['NOTICE', 'ERROR: too many concurrent REQs']); send(sock, ['EVENT', sub, claim]); });
  const gw = await gatewayOn(relay.url);
  const NOTE = 'Note from the gateway: the relay did not finish answering before the timeout, so this result may be incomplete.';
  const resource = async (uri) => { const t0 = Date.now(); const { result } = await gw.rpc('/mcp', 'resources/read', { uri }); return { isError: false, text: result.contents[0].text, ms: Date.now() - t0 }; };
  try {
    const reads = await Promise.all([
      ['federation_sync', () => gw.call('federation_sync', {})],
      ['claims_status', () => gw.call('claims_status', {})],
      ['channel_list', () => gw.call('channel_list', {})],
      ['channel_sync', () => gw.call('channel_sync', { channel: 'pub:ops' })],
      ['ruv://swarm/roster', () => resource('ruv://swarm/roster')],
      ['ruv://claims/board', () => resource('ruv://claims/board')],
      ['ruv://swarm/channels', () => resource('ruv://swarm/channels')],
    ].map(async ([name, run]) => [name, await run()]));
    for (const [name, r] of reads) {
      assert.equal(r.isError, false, `${name}: ${r.text.slice(0, 200)}`);
      const open = r.text.indexOf('<<<UNTRUSTED_RELAY_DATA ');
      assert.ok(open > 0 && r.text.slice(0, open).includes(NOTE), `${name}: the partial note must sit outside the fence`);
      assert.ok(r.ms >= 11_000 && r.ms < 16_000, `${name} took ${r.ms} ms`);
    }
    const byName = Object.fromEntries(reads);
    for (const name of ['federation_sync', 'channel_list', 'channel_sync']) {
      assert.match(byName[name].text, /"partial":true,"relayNotice":"ERROR: too many concurrent REQs"/, name);
    }
    // The claims ledger is keyed by member-chosen resource ids, so nothing is added to it.
    for (const name of ['claims_status', 'ruv://claims/board']) {
      assert.match(byName[name].text, /"data":\{"task-42":\{"owner":"[0-9a-f]{64}"/, name);
      assert.doesNotMatch(byName[name].text, /"partial"|relayNotice/, name);
    }
  } finally { gw.close(); relay.close(); }
});

test('tools: limit and sinceSeconds are integers within bounds, rejected by the schema before any relay work', async () => {
  // limit 7 is the probe for the timeoutMs check at the end: its EOSE comes late enough that a
  // leaked 1 ms timeout would show up as a partial result.
  const relay = await fakeRelay((sock, sub, filter) => (filter.limit === 7
    ? setTimeout(() => answer([])(sock, sub), 150) : answer([])(sock, sub)));
  const gw = await gatewayOn(relay.url);
  try {
    const bad = [
      { limit: -1 }, { limit: 0 }, { limit: 1.5 }, { limit: 1001 }, { limit: 1e9 },
      { sinceSeconds: -60 }, { sinceSeconds: 0 }, { sinceSeconds: 0.5 }, { sinceSeconds: 2592001 },
    ];
    for (const [name, extra] of [['federation_sync', {}], ['channel_list', {}], ['channel_sync', { channel: 'pub:ops' }], ['seraphina_guidance', { goal: 'g' }]]) {
      for (const args of bad) {
        const r = await gw.call(name, { ...extra, ...args });
        assert.equal(r.isError, true, `${name} ${JSON.stringify(args)} was accepted`);
        assert.match(r.text, /Input validation error/, `${name} ${JSON.stringify(args)}`);
        assert.ok(r.ms < 2000, `${name} ${JSON.stringify(args)} took ${r.ms} ms`);
      }
    }
    assert.equal(relay.stats.reqs, 0, 'a rejected argument must not reach the relay');

    // The boundaries themselves are accepted and reach the relay as given.
    for (const args of [{ limit: 1, sinceSeconds: 1 }, { limit: 1000, sinceSeconds: 2592000 }]) {
      const r = await gw.call('federation_sync', args);
      assert.equal(r.isError, false, `${JSON.stringify(args)}: ${r.text.slice(0, 200)}`);
      const f = relay.stats.filters.at(-1);
      assert.equal(f.limit, args.limit);
      assert.ok(Math.abs(Math.floor(Date.now() / 1000) - args.sinceSeconds - f.since) <= 2);
    }
    // Omitted arguments keep the helper defaults (fetchRecent 3600/100, listChannels 86400/500).
    await gw.call('federation_sync', {});
    assert.equal(relay.stats.filters.at(-1).limit, 100);
    await gw.call('channel_list', {});
    assert.equal(relay.stats.filters.at(-1).limit, 500);
    // timeoutMs is not a tool argument; an unknown key is stripped, never passed to the helper.
    const r = await gw.call('federation_sync', { limit: 7, timeoutMs: 1 });
    assert.equal(r.isError, false, r.text.slice(0, 200));
    assert.doesNotMatch(r.text, /"partial"/);
    assert.ok(r.ms >= 140, `answered in ${r.ms} ms, before the relay's delayed EOSE`);
  } finally { gw.close(); relay.close(); }
});

test('tools: the bounds are advertised in the input schema on every profile', async () => {
  const relay = await fakeRelay(answer([]));
  const gw = await gatewayOn(relay.url);
  try {
    for (const path of ['/mcp', '/chatgpt/mcp', '/claude/mcp']) {
      const { result } = await gw.rpc(path, 'tools/list', {});
      for (const name of ['federation_sync', 'channel_list', 'channel_sync', 'seraphina_guidance']) {
        const props = result.tools.find((t) => t.name === name).inputSchema.properties;
        assert.deepEqual({ type: props.limit.type, minimum: props.limit.minimum, maximum: props.limit.maximum },
          { type: 'integer', minimum: 1, maximum: 1000 }, `${path} ${name}.limit`);
        assert.deepEqual({ type: props.sinceSeconds.type, minimum: props.sinceSeconds.minimum, maximum: props.sinceSeconds.maximum },
          { type: 'integer', minimum: 1, maximum: 2592000 }, `${path} ${name}.sinceSeconds`);
      }
    }
  } finally { gw.close(); relay.close(); }
});
