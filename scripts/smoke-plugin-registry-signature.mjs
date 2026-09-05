#!/usr/bin/env node
/**
 * CWE-347 regression smoke — plugin registry Ed25519 verification.
 *
 * Reference: ruvnet/ruflo PR #1922 / aaronjmars's disclosure.
 *
 * The historical bug: `verifyRegistrySignature` in
 * v3/@claude-flow/cli/src/plugins/store/discovery.ts was a stub that
 * returned `true` whenever the served `registryPublicKey` field
 * started with `"ed25519"`. The call site then only `console.warn`ed
 * on failure and continued to use the unverified registry. With
 * `requireVerification: true` (the default), a network adversary on
 * the path to an IPFS gateway could swap the served registry and
 * still pass verification → user installs attacker-controlled
 * plugin tarballs with filesystem+network+hooks permissions.
 *
 * This smoke locks in the fix on two axes:
 *
 *   [1/3] STATIC CONTRACT — the source file must:
 *         - import `verifyEd25519Signature` from `transfer/ipfs/client.ts`
 *         - call it from the `verifyRegistrySignature` private method
 *         - strip BOTH `registrySignature` AND `registryPublicKey` from
 *           the registry copy before stringifying (canonical form)
 *         - pin to the caller-supplied `expectedPublicKey`, NOT to the
 *           served `registry.registryPublicKey` field
 *         - the call site must `await` the verifier AND fail-closed
 *           (return demo registry / not just `console.warn`)
 *
 *   [2/3] CRYPTO ROUND-TRIP — using the exact same Ed25519 scheme as
 *         `signRegistry()` in
 *         v3/@claude-flow/cli/scripts/publish-registry.ts:127-151:
 *         - signed fixture verifies
 *         - mutated registry body fails
 *         - empty signature fails
 *         - empty pubkey fails
 *         - served `registryPublicKey` ≠ trusted pubkey → still pinned
 *           to trusted pubkey (this is the "swap the served key too"
 *           scenario the original report calls out)
 *
 *   [3/3] CALL-SITE BYTE — the call site must contain `requireVerification`
 *         AND `await this.verifyRegistrySignature` AND a `return` (the
 *         fail-closed branch). A future regression that drops `await`
 *         or that reverts to plain `console.warn` will be caught here.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextEncoder } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DISCOVERY_PATH = resolve(
  REPO_ROOT,
  'v3/@claude-flow/cli/src/plugins/store/discovery.ts',
);

let passed = 0;
let failed = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
  passed++;
}

function fail(msg, detail) {
  console.error(`  ✗ ${msg}`);
  if (detail) console.error(`    ${detail}`);
  failed++;
}

console.log('[1/3] Static contract check on discovery.ts');

const src = readFileSync(DISCOVERY_PATH, 'utf8');

if (/import\s*{[^}]*\bverifyEd25519Signature\b[^}]*}\s*from\s*['"]\.\.\/\.\.\/transfer\/ipfs\/client\.js['"]/.test(src)) {
  ok('imports verifyEd25519Signature from transfer/ipfs/client.js');
} else {
  fail(
    'verifyEd25519Signature import missing',
    'expected: import { verifyEd25519Signature } from "../../transfer/ipfs/client.js"',
  );
}

function extractMethodBody(source, methodSignatureRegex) {
  const m = methodSignatureRegex.exec(source);
  if (!m) return null;
  // Find the opening { at or after m.index + m[0].length
  let i = source.indexOf('{', m.index + m[0].length - 1);
  if (i === -1) return null;
  let depth = 0;
  const start = i;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

const body = extractMethodBody(
  src,
  /private\s+async\s+verifyRegistrySignature\s*\(/,
);
if (body) {
  if (/delete\s+\w+\.registrySignature/.test(body) && /delete\s+\w+\.registryPublicKey/.test(body)) {
    ok('canonicalization strips BOTH registrySignature AND registryPublicKey');
  } else {
    fail(
      'verifyRegistrySignature must delete both signature fields before stringify',
      'attacker can otherwise re-sign by spreading the served fields back in',
    );
  }
  if (/JSON\.stringify\(\s*registryToVerify/.test(body) || /JSON\.stringify\(\s*\w+\s*\)/.test(body)) {
    ok('canonical message is JSON.stringify of stripped registry');
  } else {
    fail(
      'verifyRegistrySignature must JSON.stringify the stripped registry',
      'the signer uses plain JSON.stringify (no whitespace, no sort) — the verifier must match',
    );
  }
  // Verifier must call verifyEd25519Signature with `expectedPublicKey` as the
  // third argument. Allow trailing comma + arbitrary whitespace before the
  // closing paren (formatter-friendly).
  if (/verifyEd25519Signature\s*\([\s\S]*?,\s*expectedPublicKey\s*,?\s*\)/.test(body) &&
      !/verifyEd25519Signature\s*\([\s\S]*?registry\.registryPublicKey[\s\S]*?\)/.test(body)) {
    ok('verifier pins to expectedPublicKey (NOT registry.registryPublicKey)');
  } else {
    fail(
      'verifier must pin to expectedPublicKey (caller arg) not registry.registryPublicKey',
      'pinning to the served field defeats the whole verification — attacker can swap it',
    );
  }
} else {
  fail('verifyRegistrySignature method not found in async form');
}

// Old stub pattern must be GONE. A future regression that brings back
// `.startsWith(...)` on a "registryPublicKey" field would be caught here.
if (/registry\.registryPublicKey\.startsWith\s*\(/.test(src)) {
  fail(
    'old stub pattern still present (.startsWith on registryPublicKey)',
    'the prefix-match stub returned true for any "ed25519:*" served key — CWE-347',
  );
} else {
  ok('old prefix-match stub is gone');
}

console.log('\n[2/3] Crypto round-trip with real Ed25519 (matches signRegistry scheme)');

let ed;
try {
  ed = await import('@noble/ed25519');
} catch (err) {
  fail(
    '@noble/ed25519 not installed — run `npm install` at repo root',
    err.message,
  );
  process.exit(1);
}

const privateKey = new Uint8Array(32);
for (let i = 0; i < 32; i++) privateKey[i] = (i * 17 + 13) % 256; // deterministic test key
const publicKeyBytes = await ed.getPublicKeyAsync(privateKey);
const trustedPubKeyHex = `ed25519:${Buffer.from(publicKeyBytes).toString('hex')}`;

// Build a fixture registry mirroring the real one's shape
const fixture = {
  version: 1,
  totalPlugins: 1,
  publisher: 'claude-flow-team',
  plugins: [
    {
      id: '@claude-flow/test-plugin',
      name: '@claude-flow/test-plugin',
      version: '1.0.0',
      categories: ['official'],
      tags: ['test'],
      type: 'integration',
      permissions: ['memory'],
      verified: true,
      trustLevel: 'official',
    },
  ],
  registrySignature: '',
  registryPublicKey: '',
};

// Mirror signRegistry() in publish-registry.ts:127-151 exactly
async function signFixture(reg, sk) {
  const registryToSign = { ...reg };
  delete registryToSign.registrySignature;
  delete registryToSign.registryPublicKey;
  const message = JSON.stringify(registryToSign);
  const signature = await ed.signAsync(new TextEncoder().encode(message), sk);
  return Buffer.from(signature).toString('hex');
}

// Verifier replicating discovery.ts contract (the implementation we want to lock in)
async function verifyFixture(reg, expectedPubKey) {
  if (!reg.registrySignature || !expectedPubKey) return false;
  const registryToVerify = { ...reg };
  delete registryToVerify.registrySignature;
  delete registryToVerify.registryPublicKey;
  const message = JSON.stringify(registryToVerify);
  try {
    const pubKeyHex = expectedPubKey.replace(/^ed25519:/, '');
    return await ed.verifyAsync(
      Buffer.from(reg.registrySignature, 'hex'),
      new TextEncoder().encode(message),
      Buffer.from(pubKeyHex, 'hex'),
    );
  } catch {
    return false;
  }
}

const signature = await signFixture(fixture, privateKey);
const signed = { ...fixture, registrySignature: signature, registryPublicKey: trustedPubKeyHex };

// (a) happy path
if (await verifyFixture(signed, trustedPubKeyHex)) {
  ok('signed fixture verifies with trusted pubkey');
} else {
  fail('signed fixture fails verification (canonicalization mismatch?)');
}

// (b) tampered body fails
const tampered = JSON.parse(JSON.stringify(signed));
tampered.plugins[0].id = '@evil/swapped-plugin';
if (!(await verifyFixture(tampered, trustedPubKeyHex))) {
  ok('tampered registry body fails verification');
} else {
  fail('tampered body verified — canonicalization is broken');
}

// (c) empty signature fails
if (!(await verifyFixture({ ...signed, registrySignature: '' }, trustedPubKeyHex))) {
  ok('empty signature fails');
} else {
  fail('empty signature verified');
}

// (d) empty pubkey fails
if (!(await verifyFixture(signed, ''))) {
  ok('empty pubkey fails');
} else {
  fail('empty pubkey verified');
}

// (e) the attacker-swap-served-key scenario:
//     served registryPublicKey is attacker-controlled, but the verifier must
//     pin to the trusted pubkey. We simulate by setting registryPublicKey to
//     an entirely different key; the verifier should still succeed because
//     we pin to trustedPubKeyHex (not the served field).
const swappedServedKey = {
  ...signed,
  registryPublicKey: 'ed25519:0000000000000000000000000000000000000000000000000000000000000000',
};
if (await verifyFixture(swappedServedKey, trustedPubKeyHex)) {
  ok('verifier ignores swapped registryPublicKey and pins to trusted pubkey');
} else {
  fail('verifier should pin to trusted pubkey regardless of served field');
}

// (f) flipping the trusted pubkey to a different one fails — proves we're
//     actually using the pin, not accepting any key.
const wrongTrusted = `ed25519:0000000000000000000000000000000000000000000000000000000000000000`;
if (!(await verifyFixture(signed, wrongTrusted))) {
  ok('wrong trusted pubkey fails (pin is real, not a no-op)');
} else {
  fail('wrong trusted pubkey verified — pin is being ignored');
}

console.log('\n[3/3] Call-site byte check on discovery.ts');

const callSiteMatch = src.match(
  /if\s*\(\s*this\.config\.requireVerification[\s\S]{0,400}?\}\s*\}/,
);
if (callSiteMatch) {
  const block = callSiteMatch[0];
  if (/await\s+this\.verifyRegistrySignature\(/.test(block)) {
    ok('call site awaits verifyRegistrySignature');
  } else {
    fail(
      'call site does not await the async verifier',
      'without await, the Promise<boolean> is truthy and verification is bypassed',
    );
  }
  if (/return\s+this\.createDemoRegistryAsync\(/.test(block) || /return\s+\w+/.test(block)) {
    ok('call site fails closed (returns rather than continuing)');
  } else {
    fail(
      'call site must return/fall-back on verification failure (not just warn)',
      'silently continuing with an unverified registry was the CWE-347 trigger',
    );
  }
} else {
  fail('requireVerification call-site block not found');
}

console.log('');
if (failed > 0) {
  console.error(`FAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`OK: ${passed} checks passed — CWE-347 fix is locked in`);
