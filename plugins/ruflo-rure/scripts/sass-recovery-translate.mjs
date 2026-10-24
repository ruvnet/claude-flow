#!/usr/bin/env node
// Node 20 compatible input-only adapter. Run in the reviewed namespace sandbox:
// module + SASS/ELF input read-only, empty output writable, no network/secrets.
import { createHash } from 'node:crypto';
import { writeFile, mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, i, all) => {
  if (!(i % 2)) out.push([value.replace(/^--/, ''), all[i + 1]]);
  return out;
}, []));
const safe = (name) => /^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/.test(name);
const check = (value, message) => { if (!value) throw new Error(message); };
export async function bounded(path, limit) {
  check(Number.isSafeInteger(limit) && limit > 0 && limit <= 2 * 1024 * 1024, 'invalid read bound');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    check(stat.isFile() && stat.size <= limit, 'unsafe or oversized input');
    // The descriptor binds the opened file; its size can still grow, so cap the
    // actual read before allocation instead of trusting the earlier fstat size.
    const bytes = Buffer.allocUnsafe(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    check(length <= limit, 'unsafe or oversized input');
    return Buffer.from(bytes.subarray(0, length));
  } finally { await file.close(); }
}

async function main() {
  for (const key of ['module', 'input', 'output', 'manifest-sha256', 'module-sha256']) check(args[key], `missing --${key}`);
  const input = resolve(args.input), output = resolve(args.output), module = resolve(args.module);
  const manifestBytes = await bounded(join(input, 'translation-input.json'), 128 * 1024);
  check(hash(manifestBytes) === args['manifest-sha256'], 'input manifest digest mismatch');
  const manifest = JSON.parse(manifestBytes);
  check(manifest.schemaVersion === 1 && Array.isArray(manifest.kernels) && manifest.kernels.length > 0 && manifest.kernels.length <= 30, 'invalid input manifest');
  check(new Set(manifest.kernels.map(k => k.id)).size === manifest.kernels.length, 'duplicate kernel IDs');
  const moduleBytes = await bounded(module, 2 * 1024 * 1024);
  check(hash(moduleBytes) === args['module-sha256'], 'candidate module digest mismatch');
  // Validate every input before loading candidate code. The adapter never reads a
  // CUDA source, PTX, cubin, oracle, model response, or expected-output file.
  const inputs = [];
  for (const kernel of manifest.kernels) {
    check(safe(kernel.id), 'unsafe kernel ID');
    const sass = await bounded(join(input, kernel.id, 'original.sass'), 2 * 1024 * 1024);
    const elf = await bounded(join(input, kernel.id, 'original.elf'), 2 * 1024 * 1024);
    check(hash(sass) === kernel.sassSha256 && hash(elf) === kernel.elfSha256, 'SASS/ELF digest mismatch');
    inputs.push({ kernel, sass, elf });
  }
  await mkdir(output, { recursive: false });
  const receipt = { schemaVersion: 1, status: 'incomplete', startedAt: new Date().toISOString(),
    moduleSha256: hash(moduleBytes), inputManifestSha256: hash(manifestBytes), node: process.version,
    translatorInput: ['sass', 'elf'], proofStatus: 'not-proven', kernels: [] };
  try {
    // Execute exactly the bytes whose digest was checked. A pathname import
    // would reopen the candidate and permit a swap after hashing.
    const { recoverSass } = await import('data:text/javascript;base64,' + moduleBytes.toString('base64'));
    check(typeof recoverSass === 'function', 'recoverSass export missing');
    for (const { kernel, sass, elf } of inputs) {
      const result = recoverSass(sass.toString('utf8'), elf.toString('utf8'));
      check(result && result.schemaVersion === 1 && ['emitted', 'unsupported', 'invalid'].includes(result.status), 'invalid result status');
      check(result.sourceSha256 === kernel.sassSha256 && result.elfSha256 === kernel.elfSha256, 'result input binding mismatch');
      check(result.proofStatus === 'not-proven' && result.language === 'cuda-cpp', 'invalid proof/language contract');
      check(result.status === 'emitted' ? typeof result.code === 'string' && result.code.length > 0 && result.code.length <= 1024 * 1024 : result.code === null, 'code/status mismatch');
      if (result.status === 'emitted') {
        check(result.functions?.length === 1 && safe(result.functions[0].emittedName), 'expected one bounded emitted function');
        check(!/\b(?:asm|__asm__)\s*\(/.test(result.code), 'assembly passthrough is not source recovery');
        const parameters = result.functions[0].parameters;
        check(parameters?.length === 5 && parameters.every((p, i) => p.ordinal === i && p.size === [8, 8, 8, 4, 8][i] && p.type === (i === 3 ? 'uint32_t' : 'uint64_t')), 'frozen five-argument ABI mismatch');
      }
      const dir = join(output, kernel.id); await mkdir(dir);
      const resultBytes = JSON.stringify(result, null, 2) + '\n';
      await writeFile(join(dir, 'recovery.json'), resultBytes);
      if (result.code !== null) await writeFile(join(dir, 'recovered.cu'), result.code);
      receipt.kernels.push({ id: kernel.id, status: result.status, sourceSha256: kernel.sassSha256,
        elfSha256: kernel.elfSha256, recoverySha256: hash(resultBytes),
        codeSha256: result.code === null ? null : hash(result.code) });
    }
    receipt.status = 'translated';
  } catch (error) {
    receipt.status = 'failed'; receipt.error = String(error.message ?? error);
  } finally {
    receipt.completedAt = new Date().toISOString();
    receipt.coverage = { total: inputs.length, emitted: receipt.kernels.filter(k => k.status === 'emitted').length,
      unsupported: receipt.kernels.filter(k => k.status === 'unsupported').length, invalid: receipt.kernels.filter(k => k.status === 'invalid').length };
    await writeFile(join(output, 'translation-result.json'), JSON.stringify(receipt, null, 2) + '\n');
  }
  console.log(JSON.stringify({ status: receipt.status, coverage: receipt.coverage }));
  process.exitCode = receipt.status === 'translated' ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
