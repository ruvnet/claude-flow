#!/usr/bin/env node
// Independent frozen structural/semantic oracle. Never evaluates generated JS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = resolve(ROOT, 'v3/@claude-flow/cli/__tests__/fixtures/cuda');
const hash = (text) => createHash('sha256').update(text).digest('hex');
export const CONFIRMATION_SHA256 = 'db69341fc0312e810e25b7c8ed97ca3112e4b2d057b13aaf2d7ade71201ed420';
const K80_SHA256 = 'f6235f78b392f6ca6f6d80112c2963568f260fe7ef2e25a277f63fadbb0935af';

// Frozen expected instruction order, not computed from candidate output.
const SAXPY = ['ld.param.u32', 'ld.param.f32', 'ld.param.u64', 'ld.param.u64', 'mov.u32', 'mov.u32', 'mov.u32', 'mad.lo.s32', 'setp.ge.s32', 'bra', 'cvta.to.global.u64', 'cvta.to.global.u64', 'mul.wide.s32', 'add.s64', 'ld.global.f32', 'add.s64', 'ld.global.f32', 'fma.rn.f32', 'st.global.f32', 'ret'];
const SCALE = ['ld.param.u64', 'ld.param.u32', 'mov.u32', 'setp.ge.s32', 'bra', 'cvta.to.global.u64', 'mul.wide.s32', 'add.s64', 'ld.global.f32', 'mul.f32', 'st.global.f32', 'ret'];

/** Test-only exact small integer PTX interpreter. Refuses every unimplemented opcode. */
function executeInteger(fn, input, count, thread, output) {
  const regs = new Map([['%ctaid.x', Math.floor(thread / 128)], ['%ntid.x', 128], ['%tid.x', thread % 128]]);
  const params = new Map([['input', 0x100000], ['output', 0x200000], ['count', count]]);
  const operand = (s) => {
    const value = s.replace(/\s/g, '');
    if (regs.has(value)) return regs.get(value);
    if (/^-?\d+$/.test(value)) return Number(value);
    throw new Error(`Oracle refuses operand ${value}`);
  };
  const address = (s) => operand(s.replace(/[\[\]]/g, ''));
  let pc = 0, steps = 0;
  while (pc < fn.instructions.length) {
    assert.ok(++steps < 1000, 'oracle instruction budget');
    const ins = fn.instructions[pc++];
    if (ins.predicate) {
      const inverted = ins.predicate.startsWith('!');
      const name = inverted ? ins.predicate.slice(1) : ins.predicate;
      assert.ok(regs.has(name), 'predicate must be defined');
      if (Boolean(regs.get(name)) === inverted) continue;
    }
    const [d, a, b, c] = ins.operands;
    switch (ins.opcode) {
      case 'ld.param.u64': case 'ld.param.u32': {
        const key = a.replace(/[\[\]\s]/g, '');
        assert.ok(params.has(key)); regs.set(d, params.get(key)); break;
      }
      case 'mov.u32': regs.set(d, operand(a) >>> 0); break;
      case 'mad.lo.s32': regs.set(d, (Math.imul(operand(a), operand(b)) + operand(c)) | 0); break;
      case 'mul.wide.u32': regs.set(d, (operand(a) >>> 0) * (operand(b) >>> 0)); break;
      case 'add.u64': regs.set(d, operand(a) + operand(b)); break;
      case 'add.s32': regs.set(d, (operand(a) + operand(b)) | 0); break;
      case 'setp.ge.u32': regs.set(d, (operand(a) >>> 0) >= (operand(b) >>> 0)); break;
      case 'setp.ge.s32': regs.set(d, (operand(a) | 0) >= (operand(b) | 0)); break;
      case 'cvta.to.global.u64': regs.set(d, operand(a)); break;
      case 'ld.global.s32': {
        const index = (address(a) - 0x100000) / 4;
        assert.ok(Number.isInteger(index) && index >= 0 && index < input.length);
        regs.set(d, input[index]); break;
      }
      case 'st.global.s32': {
        const index = (address(d) - 0x200000) / 4;
        assert.ok(Number.isInteger(index) && index >= 0 && index < output.length);
        output[index] = operand(a); break;
      }
      case 'bra': assert.ok(Object.hasOwn(fn.labels, d)); pc = fn.labels[d]; break;
      case 'ret': return;
      default: throw new Error(`Oracle refuses opcode ${ins.opcode}`);
    }
  }
  throw new Error('Oracle fell through without ret');
}

/** Emits PTX solely from returned IR, including declarations and labels. No source text is reused. */
export function roundtripPtx(result) {
  assert.equal(result.status, 'complete');
  assert.equal(result.truncated, false);
  // This emitter is limited to the two public confirmation entry points.
  assert.deepEqual(result.functions.map(f => f.name), ['affine_i32', 'sum_i32']);
  const output = ['.version 7.8', '.target sm_75', '.address_size 64'];
  for (const fn of result.functions) {
    assert.equal(fn.kind, 'entry');
    output.push(`.visible .entry ${fn.name}(${fn.params.join(', ')})`, '{');
    output.push(...fn.registers.map(r => `.reg ${r};`));
    for (const ins of fn.instructions) {
      for (const [label, index] of Object.entries(fn.labels)) if (index === ins.index) output.push(`${label}:`);
      output.push(`${ins.predicate ? `@${ins.predicate} ` : ''}${ins.opcode} ${ins.operands.join(', ')};`);
    }
    output.push('}');
  }
  return output.join('\n') + '\n';
}

export function validate(decompilePtx) {
  const real = readFileSync(resolve(FIXTURES, 'k80.ptx'), 'utf8');
  const confirmation = readFileSync(resolve(FIXTURES, 'ptx-decompile-confirmation.ptx'), 'utf8');
  assert.equal(hash(real), K80_SHA256, 'source-known fixture changed');
  assert.equal(hash(confirmation), CONFIRMATION_SHA256, 'frozen confirmation changed');
  const result = decompilePtx(real);
  assert.equal(result.status, 'complete');
  assert.equal(result.sourceSha256, K80_SHA256);
  assert.deepEqual(result.functions.map(f => f.name), ['_Z5saxpyifPKfPf', '_Z12scale_secretPfi']);
  assert.deepEqual(result.functions[0].instructions.map(i => i.opcode), SAXPY);
  assert.deepEqual(result.functions[1].instructions.map(i => i.opcode), SCALE);
  assert.deepEqual(result.functions[0].blocks.map(b => [b.start, b.end]), [[0, 10], [10, 19], [19, 20]]);
  assert.deepEqual(result.functions[1].blocks.map(b => [b.start, b.end]), [[0, 5], [5, 11], [11, 12]]);
  assert.equal(result.functions[0].instructions[9].predicate, '%p1');
  assert.equal(result.functions[1].instructions[9].operands[2], '0f46F4D200');
  assert.match(result.functions[0].pseudocode, /fma_rn_f32/);
  assert.deepEqual(decompilePtx(real), result, 'deterministic reconstruction');

  const parsed = decompilePtx(confirmation);
  assert.equal(parsed.status, 'complete');
  assert.equal(parsed.sourceSha256, CONFIRMATION_SHA256);
  const loop = parsed.functions[1];
  const loopAt = loop.labels.LOOP;
  const loopBlock = loop.blocks.find(b => b.start === loopAt);
  assert.ok(loopBlock);
  assert.ok(loop.blocks.some(b => b.start > loopAt && b.successors.includes(loopBlock.id)), 'CFG must preserve back edge');
  let cases = 0, elementComparisons = 0;
  for (const fn of parsed.functions) for (const count of [0, 1, 31, 32, 33, 127, 129, 257, 1025]) {
    const input = Int32Array.from({ length: count + 17 }, (_, i) => ((i * 17 + 11) % 47) - 9);
    const output = new Int32Array(count + 17).fill(-1234567);
    for (let thread = 0; thread < (Math.ceil(count / 128) + 1) * 128; ++thread) executeInteger(fn, input, count, thread, output);
    for (let i = 0; i < output.length; ++i) {
      let expected = -1234567;
      if (i < count) {
        if (fn.name === 'affine_i32') expected = input[i] * 3 + 7;
        else { expected = 0; for (let j = 0; j < input[i]; ++j) expected += j; }
      }
      assert.equal(output[i], expected, `${fn.name} n=${count} i=${i}`); ++elementComparisons;
    }
    ++cases;
  }
  const roundtrip = roundtripPtx(parsed);
  const reparsed = decompilePtx(roundtrip);
  assert.equal(reparsed.status, 'complete');
  const evidence = r => r.functions.map(f => ({ name: f.name, params: f.params, registers: f.registers, labels: f.labels, blocks: f.blocks, instructions: f.instructions.map(({ line, ...i }) => i) }));
  assert.deepEqual(evidence(reparsed), evidence(parsed), 'IR survives roundtrip without instruction/CFG loss');
  const unsupported = decompilePtx(confirmation.replace('mov.u32 %r7, 0;', 'bar.sync 0; mov.u32 %r7, 0;'));
  assert.notEqual(unsupported.status, 'complete', 'unsupported barriers must not be accepted');
  assert.equal(decompilePtx(confirmation.replace('bra LOOP;', 'bra MISSING;')).status, 'invalid');
  return { status: 'pass', claim: 'structural reconstruction and bounded integer IR semantics', cases, elementComparisons, realFixtureInstructions: 32, confirmationSha256: CONFIRMATION_SHA256, roundtripSha256: hash(roundtrip), roundtrip };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const modulePath = process.argv[2] ?? resolve(ROOT, 'v3/@claude-flow/cli/src/rure/ptx-decompile.ts');
  const { decompilePtx } = await import(pathToFileURL(resolve(modulePath)).href);
  const start = performance.now();
  const { roundtrip, ...validation } = validate(decompilePtx);
  const validationMs = performance.now() - start;
  if (process.argv[3]) writeFileSync(resolve(process.argv[3]), roundtrip, { flag: 'wx' });
  const input = readFileSync(resolve(FIXTURES, 'k80.ptx'), 'utf8');
  for (let i = 0; i < 20; ++i) decompilePtx(input);
  const samples = [];
  for (let i = 0; i < 100; ++i) { const t = performance.now(); decompilePtx(input); samples.push(performance.now() - t); }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ ...validation, node: process.version, validationMs, benchmark: { samples: 100, inputBytes: Buffer.byteLength(input), medianMs: samples[49], p95Ms: samples[94], peakRssBytes: process.resourceUsage().maxRSS * 1024, claim: 'single-process parser measurements; no acceleration claim' } }, null, 2));
}
