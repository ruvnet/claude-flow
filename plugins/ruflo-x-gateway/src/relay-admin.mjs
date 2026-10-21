import { finalizeEvent } from 'nostr-tools/pure';
import { createHash, randomUUID } from 'node:crypto';
import { connectAuthed } from './nostr-federation.mjs';
function nip98(sk, url, method, body) {
  const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', method], ['nonce', randomUUID()], ...(body ? [['payload', createHash('sha256').update(body).digest('hex')]] : [])], content: '' }, sk);
  return 'Nostr ' + Buffer.from(JSON.stringify(ev)).toString('base64');
}
// Mint a v2 invite (caller must be relay admin/owner). Returns {code, expires_at, max_uses}.
export async function mintInvite(httpBase, sk, { ttlSecs = 7 * 86400, maxUses = 25 } = {}) {
  const url = `${httpBase}/api/invites`, body = JSON.stringify({ ttl_secs: ttlSecs, max_uses: maxUses });
  const r = await fetch(url, { method: 'POST', headers: { Authorization: nip98(sk, url, 'POST', body), 'Content-Type': 'application/json' }, body });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || j.message || `mint failed ${r.status}`); return j;
}
// Admit a pubkey as member via NIP-43 kind 9030 (caller must be admin/owner).
export async function admitMember(relayUrl, sk, pubkey, role = 'member') {
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) throw new Error('pubkey must be 64 hex');
  if (!['member', 'admin'].includes(role)) throw new Error('role must be member|admin');
  const ws = await connectAuthed(relayUrl, sk);
  const ev = finalizeEvent({ kind: 9030, created_at: Math.floor(Date.now() / 1000), tags: [['p', pubkey], ['role', role]], content: '' }, sk);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      try { ws.close(); } catch {}
      error ? reject(error) : resolve({ pubkey, role });
    };
    const timer = setTimeout(() => finish(new Error('admit timeout')), 15000);
    ws.on('message', d => {
      let m; try { m = JSON.parse(d.toString()); } catch { return; }
      if (Array.isArray(m) && m[0] === 'OK' && m[1] === ev.id) finish(m[2] === true ? null : new Error('admit rejected'));
    });
    ws.on('error', () => finish(new Error('admit connection error')));
    ws.on('close', () => finish(new Error('closed before admission acknowledgment')));
    ws.send(JSON.stringify(['EVENT', ev]));
  });
}

// Read live durable restrictions before each new automatic grant. The relay
// remains authoritative for bans created after the initial import as well.
export async function isMemberBanned(httpBase, sk, pubkey) {
  const url = `${httpBase}/moderation/restricted`;
  const r = await fetch(url, { headers: { Authorization: nip98(sk, url, 'GET') },
    redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('relay restrictions unavailable');
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.some(x => !x || typeof x.pubkey !== 'string' || typeof x.banned !== 'boolean')) throw new Error('invalid relay restrictions');
  return rows.some(x => x.pubkey === pubkey && x.banned);
}
