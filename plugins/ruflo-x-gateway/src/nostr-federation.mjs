// Nostr federation bridge for the ruflo swarm.
// Transport: a membership-gated Nostr relay (buzz-relay). Every coordination
// message is a signed Nostr event, so authorship is cryptographically verifiable
// and participation is open to anyone the relay admits as a member.
import WebSocket from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SWARM_TAG = 'ruflo-swarm';           // discoverable hashtag
export const SWARM_KIND = 1;                        // text-note kind, tagged for the swarm
export const MAX_MSGTYPE = 64, MAX_PAYLOAD_BYTES = 32 * 1024;
const MSGTYPE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => Uint8Array.from(Buffer.from(h, 'hex'));

export function loadIdentity(keyFile) {
  // Priority: a hex key injected via env (a GCP secret in prod, for a STABLE
  // identity across Cloud Run instances) > a persisted key file > a fresh key.
  const envHex = (process.env.RUFLO_NOSTR_KEY_HEX || '').trim();
  if (/^[0-9a-f]{64}$/i.test(envHex)) { const sk = unhex(envHex); return { sk, pubkey: getPublicKey(sk) }; }
  let sk;
  try {
    mkdirSync(dirname(keyFile), { recursive: true });
    if (existsSync(keyFile)) sk = unhex(readFileSync(keyFile, 'utf8').trim());
    else { sk = generateSecretKey(); writeFileSync(keyFile, hex(sk), { mode: 0o600 }); }
  } catch { sk = generateSecretKey(); }  // read-only FS fallback (ephemeral)
  return { sk, pubkey: getPublicKey(sk) };
}

// Connect + NIP-42 authenticate. Resolves the open socket, or rejects with the
// relay's reason (e.g. "restricted: not a relay member").
export function connectAuthed(relayUrl, sk, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 });
    let settled = false, authId;
    const done = (fn, arg) => { if (settled) return; settled = true; fn(arg); };
    const timer = setTimeout(() => { try { ws.close(); } catch {} done(reject, new Error('auth timeout')); }, timeoutMs);
    ws.on('message', (data) => {
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      if (Array.isArray(m) && m[0] === 'AUTH' && typeof m[1] === 'string' && m[1].length <= 1024 && !authId) {
        const ev = finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000),
          tags: [['relay', relayUrl], ['challenge', m[1]]], content: '' }, sk);
        authId = ev.id; ws.send(JSON.stringify(['AUTH', ev]));
      } else if (Array.isArray(m) && m[0] === 'OK' && authId && m[1] === authId) {
        clearTimeout(timer);
        if (m[2] === true) done(resolve, ws);
        else { try { ws.close(); } catch {} done(reject, new Error(m[3] || 'auth rejected')); }
      }
    });
    ws.on('error', (e) => { clearTimeout(timer); done(reject, e); });
    ws.on('close', () => { clearTimeout(timer); done(reject, new Error('closed before auth')); });
  });
}

// Publish a signed coordination message. Resolves the event id on relay OK.
export async function publish(relayUrl, sk, msgType, payload) {
  // Bound what we sign: a bad/oversized event would be rejected by the relay anyway,
  // but validating here fails fast and keeps our own memory/CPU bounded.
  if (!MSGTYPE_RE.test(String(msgType))) throw new Error(`invalid msgType (${MAX_MSGTYPE} chars, [A-Za-z0-9_-])`);
  const bytes = Buffer.byteLength(JSON.stringify(payload ?? {}));
  if (bytes > MAX_PAYLOAD_BYTES) throw new Error(`payload too large (${bytes} > ${MAX_PAYLOAD_BYTES} bytes)`);
  const ws = await connectAuthed(relayUrl, sk);
  const ev = finalizeEvent({ kind: SWARM_KIND, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', SWARM_TAG], ['k', String(msgType)]],
    content: JSON.stringify({ type: msgType, ts: new Date().toISOString(), ...payload }) }, sk);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('publish timeout')); }, 15000);
    ws.on('message', (data) => {
      // A malformed or non-array frame must not throw inside the listener (uncaught = process exit).
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      if (!Array.isArray(m)) return;
      if (m[0] === 'OK' && m[1] === ev.id) { clearTimeout(timer); try { ws.close(); } catch {}
        m[2] ? resolve(ev.id) : reject(new Error(m[3] || 'publish rejected')); }
    });
    ws.send(JSON.stringify(['EVENT', ev]));
  });
}

// A read that hit its timer resolves with what arrived. The mark is non-enumerable, so the
// array serialises and compares exactly as before; callers that care read `.partial`.
const markPartial = (arr, notice) => {
  Object.defineProperty(arr, 'partial', { value: true });
  if (notice) Object.defineProperty(arr, 'relayNotice', { value: notice });
  return arr;
};

// One REQ round on an authenticated socket, shared by fetchRecent, fetchManyOn and fetchChannel.
// connectAuthed's close/error listeners settle a promise that has already resolved, so after
// auth nothing was listening: a relay CLOSED, a dropped socket or a socket error made these
// helpers wait out the whole timer and return [] as if the relay had nothing, and a malformed
// frame threw inside the 'message' listener, which is an uncaught exception. Every settle path
// below goes through one gate, so the timer is cleared and the socket closed exactly once:
//   done(v)               resolve; the caller's final EOSE
//   CLOSED, close, error  reject with the relay's reason, while a sub is still before EOSE
//   timer                 resolve what arrived, marked partial
// frame(data) returns a frame the caller may act on, or null: malformed JSON, non-arrays,
// frames for a sub id that is not ours, a duplicate EOSE, and an EVENT without an event object
// (verifyEvent throws on null and on primitives) never reach the caller.
function relayRound(ws, resolve, reject, { subIds, collected, timeoutMs = 12000 }) {
  const ours = new Set(subIds), pending = new Set(subIds);
  let settled = false, notice;
  // Relay text ends up in an error result: one bounded line, no control characters.
  // Also C1 controls, Unicode line/paragraph separators and bidi controls, which could otherwise
  // break or visually reorder the text outside the fence.
  const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').trim().slice(0, 200);
  const end = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); try { ws.close(); } catch {} fn(v); };
  const fail = (msg) => end(reject, new Error(notice ? `${msg} (last relay NOTICE: ${notice})` : msg));
  const timer = setTimeout(() => end(resolve, markPartial(collected, notice)), timeoutMs);
  ws.on('error', (e) => fail(`relay connection error before EOSE: ${clean(e?.message)}`));
  ws.on('close', (code, reason) => fail(`relay closed the connection before EOSE (code ${code}${clean(reason) ? `: ${clean(reason)}` : ''})`));
  return {
    done: (v) => end(resolve, v),
    frame(data) {
      if (settled) return null;
      let m; try { m = JSON.parse(data.toString()); } catch { return null; }
      if (!Array.isArray(m)) return null;
      if (m[0] === 'NOTICE') { notice = clean(m[1]); return null; }
      if (!ours.has(m[1])) return null;
      // After EOSE a CLOSED is the relay answering our own CLOSE (fetchManyOn), not a refusal.
      if (m[0] === 'CLOSED') { if (pending.has(m[1])) fail(`relay closed subscription ${m[1]}: ${clean(m[2]) || 'no reason given'}`); return null; }
      if (m[0] === 'EOSE') return pending.delete(m[1]) ? m : null;
      if (m[0] === 'EVENT' && (m[2] === null || typeof m[2] !== 'object')) return null;
      return m;
    },
  };
}

// Fetch recent swarm coordination messages (verified). Optional type filter.
export async function fetchRecent(relayUrl, sk, { sinceSeconds = 3600, limit = 100, type, timeoutMs } = {}) {
  const ws = await connectAuthed(relayUrl, sk);
  const filter = { kinds: [SWARM_KIND], '#t': [SWARM_TAG], since: Math.floor(Date.now() / 1000) - sinceSeconds, limit };
  if (type) filter['#k'] = [String(type)];
  const out = [];
  return new Promise((resolve, reject) => {
    const round = relayRound(ws, resolve, reject, { subIds: ['ruflo-sync'], collected: out, timeoutMs });
    ws.on('message', (data) => {
      const m = round.frame(data); if (!m) return;
      if (m[0] === 'EVENT' && verifyEvent(m[2])) {
        let body; try { body = JSON.parse(m[2].content); } catch { body = { raw: m[2].content }; }
        // Verified envelope fields MUST win over anything the publisher put in
        // their own (attacker-controlled) content — spreading body first, then
        // overwriting id/pubkey/created_at, is the only order a publisher can't
        // use to impersonate another member's identity downstream (reduceClaims
        // trusts .pubkey for release/handoff authorization).
        out.push({ ...body, id: m[2].id, pubkey: m[2].pubkey, created_at: m[2].created_at });
      } else if (m[0] === 'EOSE') round.done(out);
    });
    ws.send(JSON.stringify(['REQ', 'ruflo-sync', filter]));
  });
}

// Run several REQs over ONE authenticated connection (one NIP-42 handshake instead of N).
// `filters` is an array; resolves an array of verified message lists in the same order.
export async function fetchManyOn(relayUrl, sk, filters, { timeoutMs } = {}) {
  if (!filters.length) return [];  // no REQ means no EOSE: don't dial and wait out the timer
  const ws = await connectAuthed(relayUrl, sk);
  const results = filters.map(() => []); let open = filters.length;
  return new Promise((resolve, reject) => {
    const round = relayRound(ws, resolve, reject, { subIds: filters.map((_, i) => 'q' + i), collected: results, timeoutMs });
    ws.on('message', (data) => {
      const m = round.frame(data); if (!m) return;
      const idx = typeof m[1] === 'string' && m[1].startsWith('q') ? Number(m[1].slice(1)) : -1;
      if (m[0] === 'EVENT' && idx >= 0 && verifyEvent(m[2])) { let body; try { body = JSON.parse(m[2].content); } catch { body = { raw: m[2].content }; } results[idx].push({ ...body, id: m[2].id, pubkey: m[2].pubkey, created_at: m[2].created_at }); }
      else if (m[0] === 'EOSE' && idx >= 0) { ws.send(JSON.stringify(['CLOSE', m[1]])); if (--open === 0) round.done(results); }
    });
    filters.forEach((f, i) => ws.send(JSON.stringify(['REQ', 'q' + i, { kinds: [SWARM_KIND], '#t': [SWARM_TAG], since: Math.floor(Date.now() / 1000) - (f.sinceSeconds ?? 3600), limit: f.limit ?? 100, ...(f.type ? { '#k': [String(f.type)] } : {}) }])));
  });
}
// Tiny TTL cache for hot read paths (roster/claims) to absorb bursts without re-dialing the relay.
// A partial (timed-out) read is returned but not cached, so the next call retries the relay.
const cache = new Map();
export async function cached(key, ttlMs, fn) { const c = cache.get(key); const now = Date.now(); if (c && now - c.at < ttlMs) return c.v; const v = await fn(); if (!v?.partial) cache.set(key, { v, at: now }); return v; }

// ---- ADR-386 channels ----
// A channel scopes events with a ['c', channelId] tag (`h` is reserved by the relay for NIP-29 groups). Private channels carry
// NIP-44 ciphertext in `content` and hide the type behind k='enc'; the gateway
// holds no channel keys and never decrypts them.

/** Publish an already-shaped channel event (tags built by channels.mjs). */
export async function publishTagged(relayUrl, sk, tags, content) {
  const bytes = Buffer.byteLength(String(content));
  if (bytes > MAX_PAYLOAD_BYTES) throw new Error(`content too large (${bytes} > ${MAX_PAYLOAD_BYTES} bytes)`);
  const ws = await connectAuthed(relayUrl, sk);
  const ev = finalizeEvent({ kind: SWARM_KIND, created_at: Math.floor(Date.now() / 1000), tags, content: String(content) }, sk);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('publish timeout')); }, 15000);
    ws.on('message', (data) => {
      let m; try { m = JSON.parse(data.toString()); } catch { return; }  // same guard as publish
      if (!Array.isArray(m)) return;
      if (m[0] === 'OK' && m[1] === ev.id) { clearTimeout(timer); try { ws.close(); } catch {}
        m[2] ? resolve(ev.id) : reject(new Error(m[3] || 'publish rejected')); }
    });
    ws.send(JSON.stringify(['EVENT', ev]));
  });
}

/**
 * Fetch a channel's recent events. Content is returned VERBATIM — parsed for a
 * public channel, left as ciphertext for a private one, because only a key
 * holder can open it and the gateway is not one.
 */
export async function fetchChannel(relayUrl, sk, { channelId, sinceSeconds = 3600, limit = 100, recipient, timeoutMs } = {}) {
  const ws = await connectAuthed(relayUrl, sk);
  const filter = { kinds: [SWARM_KIND], '#t': [SWARM_TAG], since: Math.floor(Date.now() / 1000) - sinceSeconds, limit };
  if (channelId) filter['#c'] = [String(channelId)];
  if (recipient) filter['#p'] = [String(recipient)];
  const out = [];
  return new Promise((resolve, reject) => {
    const round = relayRound(ws, resolve, reject, { subIds: ['ruflo-channel'], collected: out, timeoutMs });
    ws.on('message', (data) => {
      const m = round.frame(data); if (!m) return;
      if (m[0] === 'EVENT' && verifyEvent(m[2])) {
        const e = m[2];
        const h = e.tags.find((t) => t[0] === 'c')?.[1];
        const k = e.tags.find((t) => t[0] === 'k')?.[1];
        const rec = { id: e.id, pubkey: e.pubkey, created_at: e.created_at, channel: h, k };
        if (k === 'enc') out.push({ ...rec, encrypted: true, content: e.content });
        // Same override hazard as fetchRecent/fetchManyOn: rec's verified id/pubkey/
        // created_at must be applied AFTER body, not before.
        else { let body; try { body = JSON.parse(e.content); } catch { body = { raw: e.content }; } out.push({ ...body, ...rec }); }
      } else if (m[0] === 'EOSE') round.done(out);
    });
    ws.send(JSON.stringify(['REQ', 'ruflo-channel', filter]));
  });
}

/** Channel ids seen recently, with counts. Private ids are opaque by construction. */
export async function listChannels(relayUrl, sk, { sinceSeconds = 86400, limit = 500, timeoutMs } = {}) {
  const { DEFAULT_CHANNELS, isWellFormedChannel } = await import('./channels.mjs');
  const evs = await fetchChannel(relayUrl, sk, { sinceSeconds, limit, timeoutMs });
  const seen = new Map();
  // Declared defaults appear even when quiet — see DEFAULT_CHANNELS. Without this
  // an empty channel is undiscoverable, which is how it stays empty.
  for (const d of DEFAULT_CHANNELS) {
    seen.set(d.channel, { channel: d.channel, visibility: 'public', isDefault: true, purpose: d.purpose,
      messages: 0, publishers: new Set(), lastSeen: 0 });
  }
  for (const e of evs) {
    // A bare or malformed `c` tag is not a channel; keep probe traffic out of the directory.
    if (!e.channel || !isWellFormedChannel(e.channel)) continue;
    const c = seen.get(e.channel) || { channel: e.channel, visibility: e.channel.startsWith('prv:') ? 'private' : 'public', messages: 0, publishers: new Set(), lastSeen: 0 };
    c.messages++; c.publishers.add(e.pubkey); c.lastSeen = Math.max(c.lastSeen, e.created_at); seen.set(e.channel, c);
  }
  const channels = [...seen.values()]
    .map((c) => ({ ...c, publishers: c.publishers.size,
      lastSeen: c.lastSeen ? new Date(c.lastSeen * 1000).toISOString() : null }))
    // Active first, then quiet defaults — a directory should lead with what is alive.
    .sort((a, b) => (b.messages - a.messages) || String(a.channel).localeCompare(String(b.channel)));
  return evs.partial ? markPartial(channels, evs.relayNotice) : channels;
}
