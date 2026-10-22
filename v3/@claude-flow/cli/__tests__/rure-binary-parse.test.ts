import { describe, expect, it } from 'vitest';
import { parseBinary, extractStrings } from '../src/rure/binary-parse.js';
import { buildElf64, buildPe64, buildMachO64 } from './rure-binary-fixtures.js';

describe('ruRE binary-parse: ELF', () => {
  const info = parseBinary(buildElf64());
  it('identifies format, arch, bits, kind, entry', () => {
    expect(info).toMatchObject({ format: 'elf', arch: 'x86-64', bits: 64, endianness: 'little', kind: 'shared-or-pie', entryPoint: 0x1040 });
  });
  it('names sections from the section string table', () => {
    expect(info.sections.map((s) => s.name)).toEqual(['', '.shstrtab', '.dynstr', '.dynamic', '.dynsym']);
  });
  it('reads DT_NEEDED libraries and splits dynsym into imports vs exports', () => {
    expect(info.libraries).toEqual(['libc.so.6']);
    expect(info.imports).toEqual(['puts']);
    expect(info.exports).toEqual(['exported_fn']);
  });
});

describe('ruRE binary-parse: PE', () => {
  const info = parseBinary(buildPe64());
  it('identifies format, arch, bits, entry', () => {
    expect(info).toMatchObject({ format: 'pe', arch: 'x86-64', bits: 64, kind: 'executable', entryPoint: 0x1000 });
    expect(info.sections[0].name).toBe('.idata');
  });
  it('walks the import table through RVA translation', () => {
    expect(info.libraries).toEqual(['KERNEL32.dll']);
    expect(info.imports).toEqual(['KERNEL32.dll!ExitProcess']);
  });
});

describe('ruRE binary-parse: Mach-O', () => {
  it('reads header, linked dylibs, and LC_MAIN', () => {
    const info = parseBinary(buildMachO64());
    expect(info).toMatchObject({ format: 'macho', arch: 'aarch64', bits: 64, kind: 'executable', entryPoint: 0x1234 });
    expect(info.libraries).toEqual(['/usr/lib/libSystem.B.dylib']);
  });
});

describe('ruRE binary-parse: hostile input', () => {
  it('reports unknown format with a warning instead of throwing', () => {
    const info = parseBinary(Buffer.from('just some text, not a binary at all'));
    expect(info.format).toBe('unknown');
    expect(info.warnings.length).toBeGreaterThan(0);
  });

  it('never throws on any truncation of a valid image', () => {
    for (const build of [buildElf64, buildPe64, buildMachO64]) {
      const full = build();
      for (let n = 0; n <= full.length; n += 7) {
        expect(() => parseBinary(full.subarray(0, n))).not.toThrow();
      }
    }
  });

  it('never throws on deterministic pseudo-random corruption of valid images', () => {
    let seed = 0x9e3779b9;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
    for (const build of [buildElf64, buildPe64, buildMachO64]) {
      for (let round = 0; round < 200; round++) {
        const img = build();
        for (let k = 0; k < 6; k++) img[Math.floor(rnd() * img.length)] = Math.floor(rnd() * 256);
        expect(() => parseBinary(img)).not.toThrow();
      }
    }
  });

  it('caps an absurd section count and survives the out-of-bounds table', () => {
    const img = buildElf64();
    img.writeUInt16LE(0xffff, 60);
    let info: ReturnType<typeof parseBinary> | undefined;
    expect(() => { info = parseBinary(img); }).not.toThrow();
    expect(info!.truncated).toBe(true);
    expect(info!.warnings.length).toBeGreaterThan(0);
  });

  it('does not treat a Java class file (CAFEBABE) as a fat Mach-O', () => {
    const java = Buffer.alloc(64);
    java.writeUInt32BE(0xcafebabe, 0);
    java.writeUInt32BE(0x00000034, 4);
    expect(parseBinary(java).format).toBe('unknown');
  });
});

describe('ruRE extractStrings', () => {
  it('returns printable runs with offsets and honors the cap', () => {
    const b = Buffer.from('\0\0hello world\0\x01ab\0another-string\0', 'latin1');
    const { strings, truncated } = extractStrings(b, 6, 10);
    expect(strings.map((s) => s.value)).toEqual(['hello world', 'another-string']);
    expect(strings[0].offset).toBe(2);
    expect(truncated).toBe(false);
    expect(extractStrings(b, 6, 1).truncated).toBe(true);
  });
});
