import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as nodeSign, verify as nodeVerify, timingSafeEqual } from 'node:crypto';

export const b64u = (b: Uint8Array | Buffer): string => Buffer.from(b).toString('base64url');
export const fromB64u = (s: string): Buffer => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64url');
  return Buffer.from(s, 'base64url');
};

export interface KeyPair { publicKey: string; privateKey: string } // raw 32-byte keys, base64url
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  return { publicKey: b64u(spki.subarray(spki.length - 32)), privateKey: b64u(pkcs8.subarray(pkcs8.length - 32)) };
}
const pubKeyObj = (raw: string) => {
  const b = fromB64u(raw);
  if (b.length !== 32) throw new Error('bad public key length');
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, b]), format: 'der', type: 'spki' });
};
const privKeyObj = (raw: string) => {
  const b = fromB64u(raw);
  if (b.length !== 32) throw new Error('bad private key length');
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, b]), format: 'der', type: 'pkcs8' });
};
export function signBytes(privateKey: string, data: string): string {
  return b64u(nodeSign(null, Buffer.from(data, 'utf8'), privKeyObj(privateKey)));
}
export function verifyBytes(publicKey: string, data: string, sig: string): boolean {
  try {
    const s = fromB64u(sig);
    if (s.length !== 64) return false;
    return nodeVerify(null, Buffer.from(data, 'utf8'), pubKeyObj(publicKey), s);
  } catch { return false; }
}
export const fingerprint = (publicKey: string): string => createHash('sha256').update(fromB64u(publicKey)).digest('hex').slice(0, 32);
export const randomToken = (bytes = 32): string => b64u(randomBytes(bytes));
export const sha256b64u = (s: string): string => b64u(createHash('sha256').update(s).digest());
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
