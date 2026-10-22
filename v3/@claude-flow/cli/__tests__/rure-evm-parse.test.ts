import { describe, expect, it } from 'vitest';
import { analyzeEvm, parseHex, MAX_EVM_BYTES } from '../src/rure/evm-parse.js';
import { buildEvmBytecode, buildMinimalProxy } from './rure-binary-fixtures.js';

describe('ruRE evm-parse', () => {
  const info = analyzeEvm(buildEvmBytecode(), true);

  it('recognizes dispatcher selectors, names only the well-known ones, ignores LT range pivots', () => {
    expect(info.selectors.map((s) => [s.selector, s.name])).toEqual([
      ['0xa9059cbb', 'transfer(address,uint256)'],
      ['0x12345678', null],
      ['0x70a08231', 'balanceOf(address)'],
    ]);
    expect(info.selectors.find((s) => s.selector === '0x11223344')).toBeUndefined();
  });

  it('counts hazardous opcodes only at instruction boundaries, never inside PUSH data', () => {
    expect(info.hazards.ORIGIN?.count).toBe(1);
    expect(info.hazards.SELFDESTRUCT?.count).toBe(1);
    expect(info.hazards.DELEGATECALL?.count).toBe(1);
  });

  it('extracts embedded addresses, event topics, strings and counts', () => {
    expect(info.addresses).toEqual(['0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef']);
    expect(info.eventTopics[0]).toMatchObject({ name: 'Transfer(address,address,uint256)' });
    expect(info.strings).toContain('Ownable: caller is not the owner');
    expect(info.jumpdestCount).toBe(2);
  });

  it('decodes the solc metadata trailer', () => {
    expect(info.metadata).toEqual({ solc: '0.8.20', ipfs: 'ab'.repeat(34) });
  });

  it('emits an aligned disassembly when asked', () => {
    expect(info.disassembly?.[0]).toBe('0 PUSH0');
    expect(info.disassembly?.some((l) => l.includes('PUSH4 0xa9059cbb'))).toBe(true);
  });

  it('detects an EIP-1167 minimal proxy and its implementation', () => {
    expect(analyzeEvm(buildMinimalProxy()).minimalProxy).toEqual({ implementation: '0x' + 'be'.repeat(20) });
    expect(info.minimalProxy).toBeNull();
  });

  it('clamps a truncated trailing PUSH instead of reading past the end', () => {
    const r = analyzeEvm(Buffer.from('7f aabb'.replace(/\s/g, ''), 'hex'));
    expect(r.instructionCount).toBe(1);
    expect(r.addresses).toEqual([]);
  });

  it('never throws on random bytes', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
    for (let i = 0; i < 300; i++) {
      const b = Buffer.alloc(1 + Math.floor(rnd() * 400));
      for (let k = 0; k < b.length; k++) b[k] = Math.floor(rnd() * 256);
      expect(() => analyzeEvm(b, true)).not.toThrow();
    }
  });

  it('refuses over-cap input without analyzing it', () => {
    const r = analyzeEvm(Buffer.alloc(MAX_EVM_BYTES + 1));
    expect(r.instructionCount).toBe(0);
    expect(r.warnings.length).toBe(1);
  });
});

describe('ruRE parseHex', () => {
  it('accepts 0x-prefixed and bare hex', () => {
    expect(parseHex('0x6001')).toMatchObject({ ok: true });
    expect(parseHex('  6001\n')).toMatchObject({ ok: true });
  });
  it.each([['', 'empty'], ['0x', 'empty'], ['abc', 'odd'], ['zz11', 'hexadecimal']])('rejects %j', (input, why) => {
    const r = parseHex(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(why);
  });
});
