// Public member enrollment. Durable reservations precede every relay side effect.
import { createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { verifyEvent } from 'nostr-tools/pure';
import { Firestore } from '@google-cloud/firestore';

export class RegistrationError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new RegistrationError(status, message); };
export const REGISTRATION_LIMITS = Object.freeze({ ipHourly: 3, daily: 100, maxConcurrent: 4 });

export function registrationIp(req, trustedProxyHops = 0) {
  const raw = req.headers['x-forwarded-for'] || '';
  if (typeof raw !== 'string' || raw.length > 1024) fail(400, 'invalid forwarding chain');
  const chain = [...raw.split(',').map(x => x.trim()).filter(Boolean), req.socket.remoteAddress];
  const address = chain[chain.length - 1 - trustedProxyHops];
  if (!address || !isIP(address)) fail(400, 'client address unavailable');
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) return address.slice(7);
  // URL canonicalization removes alternate IPv6 spellings. Limit IPv6 by /64
  // so rotating interface identifiers does not create a fresh quota.
  if (isIP(address) === 6) {
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const [left, right = ''] = canonical.split('::');
    const a = left ? left.split(':') : [], b = right ? right.split(':') : [];
    return [...a, ...Array(8 - a.length - b.length).fill('0'), ...b].slice(0, 4).join(':') + '::/64';
  }
  return address;
}

export function verifyRegistration(header, body, url, now = Date.now()) {
  if (body !== '{}') fail(400, 'registration body must be {}');
  if (typeof header !== 'string' || header.length > 4096 || !/^Nostr [A-Za-z0-9+/]+={0,2}$/.test(header)) fail(401, 'signed NIP-98 authorization required');
  let event;
  try { event = JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8')); } catch { fail(401, 'invalid authorization'); }
  const seconds = Math.floor(now / 1000);
  const hash = createHash('sha256').update(body).digest('hex');
  const expected = new Map([['u', url], ['method', 'POST'], ['payload', hash]]);
  if (!event || event.kind !== 27235 || event.content !== '' || !Number.isSafeInteger(event.created_at)
    || event.created_at < seconds - 60 || event.created_at > seconds + 5
    || !Array.isArray(event.tags) || event.tags.length !== 3) fail(401, 'invalid or expired authorization');
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag.length !== 2 || !expected.has(tag[0]) || expected.get(tag[0]) !== tag[1]) fail(401, 'authorization binding mismatch');
    expected.delete(tag[0]);
  }
  try { if (!verifyEvent(event)) fail(401, 'invalid signature'); } catch { fail(401, 'invalid signature'); }
  return event;
}

// Firestore transactions serialize reservations across instances and restarts.
// Control and key documents are permanent; expired counter documents can use TTL.
export function createRegistrationStore(db, collection = 'rufloRegistration') {
  const ref = id => db.collection(collection).doc(id);
  return {
    async reserve({ pubkey, eventId, ipHash, now, limits }) {
      const hour = Math.floor(now / 3600000), day = Math.floor(now / 86400000);
      return db.runTransaction(async tx => {
        const controlRef = ref('control'), keyRef = ref(`key_${pubkey}`);
        const ipRef = ref(`ip_${hour}_${ipHash}`), dayRef = ref(`day_${day}`);
        const [control, key, ip, global] = await Promise.all([controlRef, keyRef, ipRef, dayRef].map(r => tx.get(r)));
        const policy = control.data();
        if (policy?.enabled !== true || policy?.revocationsImported !== true) fail(503, 'registration paused');
        const previous = key.data();
        if (previous?.status === 'blocked') fail(403, 'registration denied');
        if (previous?.eventId === eventId) fail(409, 'authorization already used');
        if (previous?.status === 'admitted') return { existing: true };
        if (previous) fail(409, 'admission pending operator reconciliation');
        if ((ip.data()?.count || 0) >= limits.ipHourly || (global.data()?.count || 0) >= limits.daily) fail(429, 'registration limit reached; try later');
        tx.set(keyRef, { status: 'pending', eventId, createdAt: new Date(now) });
        tx.set(ipRef, { count: (ip.data()?.count || 0) + 1, expiresAt: new Date((hour + 2) * 3600000) });
        tx.set(dayRef, { count: (global.data()?.count || 0) + 1, expiresAt: new Date((day + 2) * 86400000) });
        return { existing: false };
      });
    },
    async complete(pubkey, eventId) {
      await db.runTransaction(async tx => {
        const keyRef = ref(`key_${pubkey}`), doc = await tx.get(keyRef);
        if (doc.data()?.status !== 'pending' || doc.data()?.eventId !== eventId) fail(409, 'admission state changed; operator reconciliation required');
        tx.update(keyRef, { status: 'admitted' });
      });
    },
  };
}

export function createRegistration({ enabled = false, publicUrl, admit, store, ipSalt, checkAllowed = async () => {}, trustedProxyHops = 0,
  now = Date.now, limits = REGISTRATION_LIMITS } = {}) {
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 0 || trustedProxyHops > 3) throw new Error('registration proxy hops must be 0..3');
  if (enabled && (!store || typeof ipSalt !== 'string' || ipSalt.length < 32)) throw new Error('public registration requires durable store and stable IP salt');
  const endpoint = `${publicUrl}/api/registration`;
  let inFlight = 0, tokens = 30, last = now();
  return {
    info: () => ({ enabled, endpoint, role: 'member', authentication: 'NIP-98', limits }),
    async register(req, body) {
      if (!enabled) fail(503, 'registration paused');
      // Cheap instance-wide shedding before signature verification or database work.
      const time = now(); tokens = Math.min(30, tokens + (time - last) / 1000); last = time;
      if (tokens < 1 || inFlight >= limits.maxConcurrent) fail(429, 'registration busy; try later');
      tokens--; inFlight++;
      try {
        const ip = registrationIp(req, trustedProxyHops);
        const event = verifyRegistration(req.headers.authorization, body, endpoint, time);
        const ipHash = createHmac('sha256', ipSalt).update(ip).digest('hex');
        const reservation = await store.reserve({ pubkey: event.pubkey, eventId: event.id, ipHash, now: time, limits });
        if (!reservation.existing) {
          // Never accept a requested role, target key or relay from the caller.
          await checkAllowed(event.pubkey);
          await admit(event.pubkey, 'member');
          await store.complete(event.pubkey, event.id);
        }
        return { ok: true, pubkey: event.pubkey, role: 'member', alreadyRegistered: reservation.existing,
          membershipVerified: false, next: 'Authenticate to the relay with this key to verify current membership.' };
      } catch (e) {
        if (e instanceof RegistrationError) throw e;
        // Do not echo relay/SDK errors or credentials. A timeout may have admitted
        // the key: keep the reservation so retry cannot undo a later revocation.
        fail(503, 'admission unavailable; verify relay membership before retrying');
      } finally { inFlight--; }
    },
  };
}

export function registrationFromEnv({ publicUrl, admit, checkAllowed }) {
  const enabled = process.env.RUFLO_OPEN_REGISTRATION === 'true';
  const projectId = process.env.RUFLO_REGISTRATION_PROJECT;
  if (enabled && !projectId) throw new Error('RUFLO_REGISTRATION_PROJECT required');
  return createRegistration({ enabled, publicUrl, admit, checkAllowed,
    store: enabled ? createRegistrationStore(new Firestore({ projectId, databaseId: process.env.RUFLO_REGISTRATION_DATABASE || '(default)' })) : undefined,
    ipSalt: process.env.RUFLO_REGISTRATION_IP_SALT,
    trustedProxyHops: Number(process.env.RUFLO_REGISTRATION_PROXY_HOPS || 0) });
}
