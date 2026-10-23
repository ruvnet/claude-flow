/**
 * ruRE Phase 5 (ADR-0006): the CUDA reader on hostile input. Every case is a file an attacker could hand over; none may throw, hang, or
 * allocate past the caps, and what was read before the damage stays. Synthetic cubins and fatbins from rure-binary-fixtures.ts.
 */
import { deflateSync, zstdCompressSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { analyzeCuda } from '../src/rure/cuda-parse.js';
import { lz4Block, MAX_ENTRY_BYTES, MAX_ENTRIES, defaultZstd } from '../src/rure/cuda-fatbin.js';
import { simpleIdentifier } from '../src/rure/cuda-cubin.js';
import { looksLikePtx, scanPtx } from '../src/rure/cuda-ptx.js';
import { buildCubin, buildFatbin } from './rure-binary-fixtures.js';

const cubinEntry = (kernels: Parameters<typeof buildCubin>[0], arch = 80) => ({ kind: 2, arch, payload: buildCubin(kernels, arch) });
/** An LZ4 block that decodes to exactly `n` 'a' bytes (one literal, then one long overlapping match): about n/255 bytes of input. */
function lz4Run(n: number): Buffer {
  const rest = n - 1 - 4; // match length beyond the 4 every match has
  const nibble = Math.min(rest, 15);
  const ext: number[] = [];

  if (rest >= 15) {
    let left = rest - 15;

    while (left >= 255) {
      ext.push(255);
      left -= 255;
    }

    ext.push(left);
  }

  return Buffer.from([0x10 | nibble, 0x61, 0x01, 0x00, ...ext]);
}
const ptxText = (name = 'k') => Buffer.from(`//\n.version 8.5\n.target sm_80\n.address_size 64\n.visible .entry ${name}(\n.param .u64 a,\n.param .u32 n\n)\n{\nret;\n}\n`, 'latin1');

describe('synthetic cubins and fatbins read as the real ones do', () => {
  it('kernels, device functions, registers from sh_info are not used, sizes from sections', () => {
    const info = analyzeCuda(buildFatbin([cubinEntry([{ name: '_Z3addPfS_i', regs: 12, codeBytes: 256, constBytes: 380 }, { name: '_Z6helperf', deviceFn: true }])]));

    expect(info.source).toBe('fatbin');
    expect(info.kernels.map(k => [k.name, k.isEntry, k.arch, k.codeBytes, k.constantBytes, k.identifier])).toEqual([
      ['_Z3addPfS_i', true, 'sm_80', 256, 380, 'add'],
      ['_Z6helperf', false, 'sm_80', 128, null, 'helper'],
    ]);
    // No global .nv.info record names them, so the register count is unknown, not the sh_info byte.
    expect(info.kernels.every(k => k.registers === null)).toBe(true);
  });

  it('uncompressed PTX is read, the trailing padding is dropped', () => {
    const info = analyzeCuda(buildFatbin([{ kind: 1, arch: 80, payload: Buffer.concat([ptxText('saxpy'), Buffer.alloc(5)]) }]));

    expect(info.ptx[0]).toMatchObject({ version: '8.5', target: 'sm_80', addressSize: 64, entries: [{ name: 'saxpy', params: 2 }] });
  });
});

describe('a fatbin that lies about its own size', () => {
  it('a payload size past the end of the data is clamped with a warning, and what is there is read', () => {
    const info = analyzeCuda(buildFatbin([cubinEntry([{ name: 'a' }])], { fatSize: 1_000_000n }));

    expect(info.warnings.join(' ')).toMatch(/runs past the data/);
    expect(info.kernels).toHaveLength(1);
  });

  it('an entry header length of 0, of 5, and of 5000 stops the walk without reading garbage', () => {
    for (const headerSize of [0, 5, 5000]) {
      const info = analyzeCuda(buildFatbin([{ ...cubinEntry([{ name: 'a' }]), headerSize }]));

      expect(info.entries, `headerSize ${headerSize}`).toEqual([]);
      expect(info.warnings.join(' ')).toMatch(/out of range/);
    }
  });

  it('a container header length that is not sane stops the walk', () => {
    const info = analyzeCuda(buildFatbin([cubinEntry([{ name: 'a' }])], { headerSize: 9000 }));

    expect(info.entries).toEqual([]);
    expect(info.warnings.join(' ')).toMatch(/header size 9000 is out of range/);
  });

  it('more than the entry cap stops at the cap and says so', () => {
    const many = Array.from({ length: MAX_ENTRIES + 10 }, () => ({ kind: 1, arch: 80, payload: Buffer.from('.version 1.0\n') }));
    const info = analyzeCuda(buildFatbin(many));

    expect(info.entries).toHaveLength(MAX_ENTRIES);
    expect(info.truncated).toBe(true);
  });

  it('trailing bytes after the last container are a warning, zero padding is not', () => {
    const base = buildFatbin([cubinEntry([{ name: 'a' }])]);

    expect(analyzeCuda(Buffer.concat([base, Buffer.alloc(40)])).warnings.join(' ')).not.toMatch(/after the last container/);
    expect(analyzeCuda(Buffer.concat([base, Buffer.from('junk-after-the-fatbin')])).warnings.join(' ')).toMatch(/after the last container/);
  });
});

describe('decompression is capped, and a lying header cannot widen the cap', () => {
  it('a claim of 1e9 decompressed bytes is refused before any decompression is attempted', () => {
    const zstd = vi.fn(() => Buffer.alloc(0));
    const info = analyzeCuda(buildFatbin([{ kind: 1, arch: 80, payload: Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3, 4]), flags: 0x8011n, compressedSize: 8, decompressedSize: 1_000_000_000n }]), { zstd });

    expect(zstd).not.toHaveBeenCalled();
    expect(info.entries[0]).toMatchObject({ read: false, compressed: 'zstd' });
    expect(info.entries[0]?.note).toMatch(/over the \d+-byte cap, not read/);
  });

  it('a claim of exactly the cap is accepted as a size, one more byte is not', () => {
    const at = analyzeCuda(buildFatbin([{ kind: 1, arch: 80, payload: Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), flags: 0x8011n, compressedSize: 4, decompressedSize: BigInt(MAX_ENTRY_BYTES) }]), { zstd: () => Buffer.alloc(0) });
    const over = analyzeCuda(buildFatbin([{ kind: 1, arch: 80, payload: Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), flags: 0x8011n, compressedSize: 4, decompressedSize: BigInt(MAX_ENTRY_BYTES + 1) }]), { zstd: () => Buffer.alloc(0) });

    expect(at.entries[0]?.note).toMatch(/decompressed to 0 bytes, the header says/);
    expect(over.entries[0]?.note).toMatch(/over the .* cap/);
  });

  it.skipIf(defaultZstd === null)('a real zstd bomb (small frame, huge output) cannot exceed what the header claimed', () => {
    const bomb = zstdCompressSync(Buffer.alloc(8 * 1024 * 1024));
    const info = analyzeCuda(buildFatbin([{ kind: 1, arch: 80, payload: bomb, flags: 0x8011n, compressedSize: bomb.length, decompressedSize: 1000n }]));

    expect(bomb.length).toBeLessThan(1000);
    expect(info.entries[0]).toMatchObject({ read: false, compressed: 'zstd' });
    expect(info.entries[0]?.note).toMatch(/could not be decompressed|decompressed to/);
  });

  it('the zstd flag on a payload that is not a zstd frame is not trusted', () => {
    const info = analyzeCuda(buildFatbin([{ kind: 1, arch: 80, payload: Buffer.from('.version 8.0\n'), flags: 0x8011n, compressedSize: 13, decompressedSize: 13n }]), { zstd: defaultZstd });

    expect(info.entries[0]).toMatchObject({ read: false, compressed: 'unknown' });
    expect(info.entries[0]?.note).toMatch(/does not start with a zstd frame/);
  });

  it('both compression flags at once is unknown, and not read', () => {
    const info = analyzeCuda(buildFatbin([{ kind: 1, arch: 80, payload: Buffer.alloc(8), flags: 0xa011n, compressedSize: 8, decompressedSize: 8n }]));

    expect(info.entries[0]).toMatchObject({ read: false, compressed: 'unknown' });
  });

  it('a header that gives no decompressed size for a compressed entry is not read', () => {
    const info = analyzeCuda(buildFatbin([{ kind: 1, arch: 80, payload: Buffer.alloc(8), flags: 0x2011n, compressedSize: 8, decompressedSize: 0n }]));

    expect(info.entries[0]?.note).toMatch(/no decompressed size/);
  });

  it('a decompressed length that differs from the header is not used', () => {
    const info = analyzeCuda(buildFatbin([{ kind: 1, arch: 80, payload: Buffer.from([0x10, 0x41]), flags: 0x2011n, compressedSize: 2, decompressedSize: 5n }]));

    expect(info.entries[0]).toMatchObject({ read: false, compressed: 'lz4' });
    expect(info.entries[0]?.note).toMatch(/decompressed to 1 bytes, the header says 5/);
  });

  it('the total budget across entries is spent as entries decompress, and the rest are not read', () => {
    const run = lz4Run(MAX_ENTRY_BYTES);
    const entry = { kind: 1, arch: 80, payload: run, flags: 0x2011n, compressedSize: run.length, decompressedSize: BigInt(MAX_ENTRY_BYTES) };
    const info = analyzeCuda(buildFatbin([entry, entry, entry, entry, entry]));

    // 4 x 16 MiB is the 64 MiB budget; the fifth is refused whole, not cut.
    expect(info.entries.map(e => e.read)).toEqual([true, true, true, true, false]);
    expect(info.entries[4]?.note).toMatch(/budget for this file is spent/);
    expect(info.entries[0]?.size).toBe(MAX_ENTRY_BYTES);
  });
});

describe('decompression work is charged when an attempt starts', () => {
  it('256 entries that each claim the cap and fail are attempted only as many times as the budget allows', () => {
    const calls = vi.fn(() => Buffer.alloc(0));
    const entry = { kind: 1, arch: 80, payload: Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 0, 0]), flags: 0x8011n, compressedSize: 8, decompressedSize: BigInt(MAX_ENTRY_BYTES) };
    const info = analyzeCuda(buildFatbin(Array.from({ length: 200 }, () => entry)), { zstd: calls });

    expect(calls).toHaveBeenCalledTimes(4);
    expect(info.entries.filter(e => /budget/.test(e.note ?? ''))).toHaveLength(196);
  });
});

describe('the LZ4 block decoder', () => {
  it('decodes literals, and a match that overlaps its own output (a run)', () => {
    // "abc" literals, then a match: offset 3, length 4+2 = 6 -> abcabcabc
    expect(lz4Block(Buffer.from([0x32, 0x61, 0x62, 0x63, 0x03, 0x00]), 64).toString()).toBe('abcabcabc');
    // literal "a", then match offset 1, length 4+11 -> 16 a's
    expect(lz4Block(Buffer.from([0x1b, 0x61, 0x01, 0x00]), 64).toString()).toBe('a'.repeat(16));
    // length nibble 15 plus an extension byte of 7: 15 + 7 + 4 = 26, plus the one literal -> 27 a's
    expect(lz4Block(Buffer.from([0x1f, 0x61, 0x01, 0x00, 0x07]), 64).toString()).toBe('a'.repeat(27));
    // and the helper used elsewhere agrees with the decoder at sizes with and without extension bytes
    for (const n of [5, 9, 20, 300, 70000]) expect(lz4Block(lz4Run(n), n).toString()).toBe('a'.repeat(n));
  });

  it('refuses a match offset that points before the start of the output', () => {
    expect(() => lz4Block(Buffer.from([0x11, 0x61, 0x05, 0x00]), 64)).toThrow(/before the start/);
    expect(() => lz4Block(Buffer.from([0x11, 0x61, 0x00, 0x00]), 64)).toThrow(/before the start/);
  });

  it('refuses literals past the input, and output past the cap', () => {
    expect(() => lz4Block(Buffer.from([0x50, 0x61]), 64)).toThrow(/past the input/);
    expect(() => lz4Block(Buffer.from([0x40, 0x61, 0x62, 0x63, 0x64]), 3)).toThrow(/past the cap/);
    expect(() => lz4Block(Buffer.from([0x1f, 0x61, 0x01, 0x00, 0xff, 0xff, 0xff, 0x10]), 100)).toThrow(/past the cap/);
  });

  it('refuses a length extension that runs off the end', () => {
    expect(() => lz4Block(Buffer.from([0xf0, 0xff, 0xff]), 1 << 20)).toThrow();
  });

  it('is not fooled by zlib data', () => {
    expect(() => lz4Block(deflateSync(Buffer.alloc(100)), 64)).toThrow();
  });
});

describe('hostile cubins', () => {
  it('a kernel name carrying terminal escapes comes back as it is (the tool screens it), without breaking the walk', () => {
    const evil = '\u001b[31mEVIL\u001b[0m\u001b]52;c;aGk=\u0007';
    const info = analyzeCuda(buildFatbin([cubinEntry([{ name: evil }])]));

    expect(info.kernels[0]?.name).toBe(evil);
    expect(info.kernels[0]?.identifier).toBeNull();
  });

  it('a section header table past the file, and a symbol table past the file, are warnings', () => {
    const cubin = buildCubin([{ name: 'a' }]);

    cubin.writeBigUInt64LE(BigInt(cubin.length + 4096), 0x28);
    expect(analyzeCuda(cubin).warnings.join(' ')).toMatch(/section header table/);

    const truncated = buildCubin([{ name: 'a' }]).subarray(0, 120);

    expect(() => analyzeCuda(truncated)).not.toThrow();
  });

  it('a name that is not terminated inside the string table is cut, not read past the table', () => {
    const cubin = buildCubin([{ name: 'kernel_name_here' }]);
    const at = cubin.indexOf('kernel_name_here');

    cubin.fill(0x41, at, at + 16);

    expect(analyzeCuda(cubin).kernels[0]?.name.length).toBeLessThanOrEqual(200);
  });

  it('a wrong-endian or 32-bit ELF with e_machine 190 is not read as a cubin', () => {
    const cubin = buildCubin([{ name: 'a' }]);

    cubin[4] = 1;

    expect(analyzeCuda(cubin).kernels).toEqual([]);
  });

  it('random bytes after a valid ELF header never throw', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const cubin = buildCubin([{ name: 'a', constBytes: 20 }, { name: 'b' }]);
      let x = seed * 2654435761;

      for (let i = 64; i < cubin.length; i += 7) {
        x = (x * 1103515245 + 12345) >>> 0;
        cubin[i] = x & 0xff;
      }

      expect(() => analyzeCuda(cubin), `seed ${seed}`).not.toThrow();
      expect(() => analyzeCuda(buildFatbin([{ kind: 2, arch: 80, payload: cubin }])), `fatbin seed ${seed}`).not.toThrow();
    }
  });
});

describe('looksLikePtx is linear on hostile comment structure (CodeQL js/redos)', () => {
  const ptx = (s: string) => looksLikePtx(Buffer.from(s, 'latin1'));

  it('accepts PTX after line comments, block comments and blank space', () => {
    expect(ptx('.version 8.0\n')).toBe(true);
    expect(ptx('//\n// Generated by NVIDIA\n//\n\n.version 9.0\n.target sm_80\n')).toBe(true);
    expect(ptx('/* a */ /* b */\n  .version 7.8\n')).toBe(true);
  });

  it('refuses what is not PTX', () => {
    for (const text of ['', 'hello', '// only a comment', '/* unterminated', '.target sm_80\n.version 8.0', '.version x', '\x7fELF']) expect(ptx(text), JSON.stringify(text)).toBe(false);
  });

  it('does not backtrack on a comment opener followed by many comment closers', () => {
    for (const text of ['/*' + '*/'.repeat(3000) + 'x', '/*' + '*/ /*'.repeat(1500), '/*'.repeat(4000), '//' + ' '.repeat(8000), ' '.repeat(8191) + 'x']) {
      const start = Date.now();

      ptx(text);

      expect(Date.now() - start, text.slice(0, 12)).toBeLessThan(100);
    }
  });
});

describe('simpleIdentifier and the PTX scan', () => {
  it('only a plain _Z<len><name> gets an identifier', () => {
    expect(simpleIdentifier('_Z5saxpyifPKfPf')).toBe('saxpy');
    expect(simpleIdentifier('_Z12scale_secretPfi')).toBe('scale_secret');
    expect(simpleIdentifier('_ZN3foo3barEv')).toBeNull();
    expect(simpleIdentifier('plain_c_kernel')).toBeNull();
    expect(simpleIdentifier('_Z99shortPfi')).toBeNull();
    expect(simpleIdentifier('_Z0xPfi')).toBeNull();
  });

  it('a PTX with a million entry-like lines is bounded by the name cap and the scan cap', () => {
    const big = '.version 8.0\n' + '.entry k(.param .u32 a)\n'.repeat(5000);
    const info = scanPtx(big, false);

    expect(info.entries.length + info.functions.length).toBeLessThanOrEqual(500);
  });

  it('text is returned only when asked for and is cut at 64 KiB', () => {
    const big = '.version 8.0\n' + '// padding\n'.repeat(20000);

    expect(scanPtx(big, false).text).toBeUndefined();
    expect(scanPtx(big, true).text?.length).toBe(64 * 1024);
    expect(scanPtx(big, true).textTruncated).toBe(true);
  });

  it('a long run of blank lines (or of whitespace after a directive) does not take quadratic time', () => {
    const measure = (text: string) => {
      const start = Date.now();
      const info = scanPtx(text, false);

      return { ms: Date.now() - start, info };
    };
    // Before the fix 80000 blank lines took 4.6 s and 320000 took 71 s; now the cost is linear and the directive is still found.
    const blank = measure('\n'.repeat(400_000) + '.version 8.0\n.target sm_80\n.address_size 64\n');
    const crlf = measure('\r\n'.repeat(200_000) + '.version 8.0\n');
    const spaces = measure('.version 8.0\n' + '.entry' + ' '.repeat(2_000_000) + 'k(\n');
    const manyEntries = measure('.version 8.0\n' + ('.entry' + ' '.repeat(200) + '\n').repeat(10_000));

    expect(blank.ms).toBeLessThan(500);
    expect(blank.info).toMatchObject({ version: '8.0', target: 'sm_80', addressSize: 64 });
    expect(crlf.ms).toBeLessThan(500);
    expect(spaces.ms).toBeLessThan(500);
    expect(manyEntries.ms).toBeLessThan(500);
  });

  it('a pathological parameter list does not take quadratic time', () => {
    const evil = '.version 8.0\n.entry k(' + '.param '.repeat(200000);
    const start = Date.now();

    scanPtx(evil, false);

    expect(Date.now() - start).toBeLessThan(2000);
  });
});
