/** Synthetic minimal ELF64 / PE32+ / Mach-O64 images for ruRE binary-parse tests. */

export function buildElf64(): Buffer {
  const shstr = Buffer.from('\0.shstrtab\0.dynstr\0.dynamic\0.dynsym\0', 'latin1');
  const dynstr = Buffer.from('\0libc.so.6\0puts\0exported_fn\0', 'latin1');
  const dynamic = Buffer.alloc(32);
  dynamic.writeBigUInt64LE(1n, 0); // DT_NEEDED
  dynamic.writeBigUInt64LE(1n, 8); // -> "libc.so.6"
  const dynsym = Buffer.alloc(72);
  // sym 1: puts (undefined, GLOBAL FUNC)
  dynsym.writeUInt32LE(11, 24);
  dynsym[28] = 0x12;
  dynsym.writeUInt16LE(0, 30);
  // sym 2: exported_fn (defined in section 1, GLOBAL FUNC)
  dynsym.writeUInt32LE(16, 48);
  dynsym[52] = 0x12;
  dynsym.writeUInt16LE(1, 54);

  const shstrOff = 64;
  const dynstrOff = shstrOff + shstr.length;
  const dynamicOff = dynstrOff + dynstr.length;
  const dynsymOff = dynamicOff + dynamic.length;
  const shoff = dynsymOff + dynsym.length;
  const buf = Buffer.alloc(shoff + 5 * 64);

  buf.write('\x7fELF', 0, 'latin1');
  buf[4] = 2; // 64-bit
  buf[5] = 1; // little endian
  buf[6] = 1;
  buf.writeUInt16LE(3, 16); // ET_DYN
  buf.writeUInt16LE(62, 18); // x86-64
  buf.writeBigUInt64LE(0x1040n, 24); // entry
  buf.writeBigUInt64LE(BigInt(shoff), 40);
  buf.writeUInt16LE(64, 52);
  buf.writeUInt16LE(64, 58);
  buf.writeUInt16LE(5, 60);
  buf.writeUInt16LE(1, 62); // shstrndx

  shstr.copy(buf, shstrOff);
  dynstr.copy(buf, dynstrOff);
  dynamic.copy(buf, dynamicOff);
  dynsym.copy(buf, dynsymOff);

  const sh = (i: number, name: number, type: number, off: number, size: number, link: number, entsize: number) => {
    const o = shoff + i * 64;
    buf.writeUInt32LE(name, o);
    buf.writeUInt32LE(type, o + 4);
    buf.writeBigUInt64LE(BigInt(off), o + 24);
    buf.writeBigUInt64LE(BigInt(size), o + 32);
    buf.writeUInt32LE(link, o + 40);
    buf.writeBigUInt64LE(BigInt(entsize), o + 56);
  };
  sh(1, 1, 3, shstrOff, shstr.length, 0, 0);
  sh(2, 11, 3, dynstrOff, dynstr.length, 0, 0);
  sh(3, 19, 6, dynamicOff, dynamic.length, 2, 16);
  sh(4, 28, 11, dynsymOff, dynsym.length, 2, 24);
  return buf;
}

export function buildPe64(): Buffer {
  const buf = Buffer.alloc(0x400);
  buf.write('MZ', 0, 'latin1');
  buf.writeUInt32LE(0x40, 0x3c);
  buf.write('PE\0\0', 0x40, 'latin1');
  const coff = 0x44;
  buf.writeUInt16LE(0x8664, coff);
  buf.writeUInt16LE(1, coff + 2);
  buf.writeUInt16LE(240, coff + 16);
  buf.writeUInt16LE(0x0022, coff + 18);
  const opt = coff + 20;
  buf.writeUInt16LE(0x20b, opt);
  buf.writeUInt32LE(0x1000, opt + 16);
  buf.writeUInt32LE(16, opt + 108);
  buf.writeUInt32LE(0x1000, opt + 112 + 8); // import dir rva
  buf.writeUInt32LE(0x28, opt + 112 + 12);
  const sec = opt + 240;
  buf.write('.idata', sec, 'latin1');
  buf.writeUInt32LE(0x200, sec + 8);
  buf.writeUInt32LE(0x1000, sec + 12);
  buf.writeUInt32LE(0x200, sec + 16);
  buf.writeUInt32LE(0x200, sec + 20);
  // descriptor @ rva 0x1000 -> file 0x200
  buf.writeUInt32LE(0x1040, 0x200);
  buf.writeUInt32LE(0x1060, 0x200 + 12);
  buf.writeUInt32LE(0x1040, 0x200 + 16);
  buf.writeBigUInt64LE(0x1070n, 0x240); // thunk by name
  buf.write('KERNEL32.dll\0', 0x260, 'latin1');
  buf.write('ExitProcess\0', 0x272, 'latin1'); // hint(2) + name
  return buf;
}

export function buildMachO64(): Buffer {
  const name = '/usr/lib/libSystem.B.dylib\0';
  const dylibSize = 24 + Math.ceil(name.length / 8) * 8;
  const buf = Buffer.alloc(32 + dylibSize + 24);
  buf.writeUInt32LE(0xfeedfacf, 0);
  buf.writeUInt32LE(0x0100000c, 4);
  buf.writeUInt32LE(2, 12); // executable
  buf.writeUInt32LE(2, 16);
  buf.writeUInt32LE(dylibSize + 24, 20);
  buf.writeUInt32LE(0xc, 32);
  buf.writeUInt32LE(dylibSize, 36);
  buf.writeUInt32LE(24, 40);
  buf.write(name, 32 + 24, 'latin1');
  const main = 32 + dylibSize;
  buf.writeUInt32LE(0x80000028, main);
  buf.writeUInt32LE(24, main + 4);
  buf.writeBigUInt64LE(0x1234n, main + 8);
  return buf;
}
