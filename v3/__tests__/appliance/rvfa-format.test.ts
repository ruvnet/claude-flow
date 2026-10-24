/**
 * RVFA binary format tests.
 *
 * Uses Vitest (collected by the v3 root vitest config).
 * Run: cd v3 && npx vitest run __tests__/appliance/rvfa-format.test.ts
 */

import { describe, it, beforeEach, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  RvfaWriter,
  RvfaReader,
  createDefaultHeader,
  formatSize,
  validateHeader,
  RVFA_MAGIC,
  RVFA_VERSION,
} from '../../@claude-flow/cli/src/appliance/rvfa-format.js';

// -- Helpers ------------------------------------------------------------------

function makeWriter(profile: 'cloud' | 'hybrid' | 'offline' = 'cloud') {
  const header = createDefaultHeader(profile);
  return new RvfaWriter({ ...header, name: 'test-appliance' });
}

function addTestSections(writer: RvfaWriter): void {
  writer.addSection('kernel', Buffer.from('kernel-payload'), { compression: 'none' });
  writer.addSection('runtime', Buffer.from('runtime-payload'), { compression: 'gzip' });
  writer.addSection('ruflo', Buffer.from('ruflo-payload'), { compression: 'none' });
}

// -- 1. Format constants ------------------------------------------------------

describe('Format constants', () => {
  it('RVFA_MAGIC is the 4-byte ASCII string "RVFA"', () => {
    expect(RVFA_MAGIC.toString('ascii')).toBe('RVFA');
    expect(RVFA_MAGIC.length).toBe(4);
  });

  it('RVFA_VERSION is 1', () => {
    expect(RVFA_VERSION).toBe(1);
  });
});

// -- 2. createDefaultHeader ---------------------------------------------------

describe('createDefaultHeader', () => {
  for (const profile of ['cloud', 'hybrid', 'offline'] as const) {
    it(`returns a valid header for "${profile}" profile`, () => {
      const header = createDefaultHeader(profile);
      expect(header.profile).toBe(profile);
      expect(header.magic).toBe('RVFA');
      expect(header.version).toBe(RVFA_VERSION);
      expect(Array.isArray(header.sections)).toBeTruthy();
      expect(Array.isArray(header.capabilities)).toBeTruthy();
      expect(typeof header.boot.entrypoint).toBe('string');
      expect(validateHeader(header)).toBeTruthy();
    });
  }

  it('cloud profile does not include ruvllm capability', () => {
    expect(!createDefaultHeader('cloud').capabilities.includes('ruvllm')).toBeTruthy();
  });

  it('offline profile includes ruvllm capability', () => {
    expect(createDefaultHeader('offline').capabilities.includes('ruvllm')).toBeTruthy();
  });
});

// -- 3. validateHeader --------------------------------------------------------

describe('validateHeader', () => {
  it('accepts a well-formed header', () => {
    expect(validateHeader(createDefaultHeader('cloud'))).toBeTruthy();
  });

  it('rejects null, non-object, and primitives', () => {
    expect(validateHeader(null)).toBe(false);
    expect(validateHeader('string')).toBe(false);
    expect(validateHeader(42)).toBe(false);
  });

  it('rejects header with missing or wrong magic', () => {
    const h1 = createDefaultHeader('cloud') as Record<string, unknown>;
    delete h1.magic;
    expect(validateHeader(h1)).toBe(false);

    const h2 = createDefaultHeader('cloud') as Record<string, unknown>;
    h2.magic = 'NOPE';
    expect(validateHeader(h2)).toBe(false);
  });

  it('rejects header with wrong version type', () => {
    const h = createDefaultHeader('cloud') as Record<string, unknown>;
    h.version = 'not-a-number';
    expect(validateHeader(h)).toBe(false);
  });

  it('rejects header with invalid profile', () => {
    const h = createDefaultHeader('cloud') as Record<string, unknown>;
    h.profile = 'invalid';
    expect(validateHeader(h)).toBe(false);
  });

  it('rejects header with invalid boot.isolation', () => {
    const h = createDefaultHeader('cloud');
    (h.boot as Record<string, unknown>).isolation = 'bad';
    expect(validateHeader(h)).toBe(false);
  });

  it('rejects header with invalid models.provider', () => {
    const h = createDefaultHeader('cloud');
    (h.models as Record<string, unknown>).provider = 'bad';
    expect(validateHeader(h)).toBe(false);
  });
});

// -- 4. formatSize ------------------------------------------------------------

describe('formatSize', () => {
  it('formats 0 bytes', () => expect(formatSize(0)).toBe('0 B'));
  it('formats bytes below 1 KB', () => expect(formatSize(512)).toBe('512 B'));
  it('formats kilobytes', () => expect(formatSize(1536)).toBe('1.5 KB'));
  it('formats megabytes', () => expect(formatSize(2.3 * 1024 * 1024)).toBe('2.3 MB'));
  it('formats gigabytes', () => expect(formatSize(4.1 * 1024 * 1024 * 1024)).toBe('4.1 GB'));
  it('formats negative bytes as 0 B', () => expect(formatSize(-100)).toBe('0 B'));
});

// -- 5. RvfaWriter ------------------------------------------------------------

describe('RvfaWriter', () => {
  it('creates a binary starting with RVFA magic bytes', () => {
    const writer = makeWriter();
    addTestSections(writer);
    const buf = writer.build();
    expect(buf.subarray(0, 4).toString('ascii')).toBe('RVFA');
  });

  it('writes the correct version number', () => {
    const writer = makeWriter();
    addTestSections(writer);
    expect(writer.build().readUInt32LE(4)).toBe(RVFA_VERSION);
  });

  it('adds sections with correct SHA256', () => {
    const writer = makeWriter();
    const payload = Buffer.from('test-data-for-sha256-check');
    writer.addSection('kernel', payload, { compression: 'none' });
    const buf = writer.build();

    const reader = RvfaReader.fromBuffer(buf);
    const sections = reader.getSections();
    const stored = buf.subarray(sections[0].offset, sections[0].offset + sections[0].size);
    const expected = createHash('sha256').update(stored).digest('hex');
    expect(sections[0].sha256).toBe(expected);
  });

  it('compresses sections with gzip when requested', () => {
    const writer = makeWriter();
    const payload = Buffer.alloc(1024, 0x42);
    writer.addSection('kernel', payload, { compression: 'gzip' });
    const buf = writer.build();

    const reader = RvfaReader.fromBuffer(buf);
    const sections = reader.getSections();
    expect(sections[0].compression).toBe('gzip');
    expect(sections[0].size < payload.length).toBeTruthy();
  });

  it('computes a valid footer hash', () => {
    const writer = makeWriter();
    addTestSections(writer);
    const reader = RvfaReader.fromBuffer(writer.build());
    const result = reader.verify();
    expect(result.valid, `Footer hash invalid: ${result.errors.join(', ')}`).toBeTruthy();
  });

  it('produces valid header JSON', () => {
    const writer = makeWriter();
    addTestSections(writer);
    const buf = writer.build();
    const headerLen = buf.readUInt32LE(8);
    const headerJson = buf.subarray(12, 12 + headerLen).toString('utf-8');
    expect(() => JSON.parse(headerJson)).not.toThrow();
  });

  it('section offsets are correct and non-overlapping', () => {
    const writer = makeWriter();
    writer.addSection('kernel', Buffer.from('aaa'), { compression: 'none' });
    writer.addSection('runtime', Buffer.from('bbbbb'), { compression: 'none' });
    writer.addSection('ruflo', Buffer.from('ccccccc'), { compression: 'none' });

    const reader = RvfaReader.fromBuffer(writer.build());
    const sections = reader.getSections();
    for (let i = 1; i < sections.length; i++) {
      const prev = sections[i - 1];
      const curr = sections[i];
      expect(prev.offset + prev.size <= curr.offset, `${prev.id} overlaps ${curr.id}`).toBeTruthy();
    }
  });
});

// -- 6. RvfaReader ------------------------------------------------------------

describe('RvfaReader', () => {
  let validBuf: Buffer;

  beforeEach(() => {
    const writer = makeWriter();
    addTestSections(writer);
    validBuf = writer.build();
  });

  it('reads back what RvfaWriter wrote (round-trip)', () => {
    const reader = RvfaReader.fromBuffer(validBuf);
    const header = reader.getHeader();
    expect(header.name).toBe('test-appliance');
    expect(header.profile).toBe('cloud');
    expect(header.sections.length).toBe(3);
  });

  it('extracts uncompressed sections correctly', () => {
    const data = RvfaReader.fromBuffer(validBuf).extractSection('kernel');
    expect(data.toString('utf-8')).toBe('kernel-payload');
  });

  it('extracts gzip-compressed sections correctly', () => {
    const data = RvfaReader.fromBuffer(validBuf).extractSection('runtime');
    expect(data.toString('utf-8')).toBe('runtime-payload');
  });

  it('verify() passes for a valid file', () => {
    const result = RvfaReader.fromBuffer(validBuf).verify();
    expect(result.valid).toBeTruthy();
    expect(result.errors.length).toBe(0);
  });

  it('verify() fails for tampered magic bytes', () => {
    const tampered = Buffer.from(validBuf);
    tampered[0] = 0x00;
    expect(() => RvfaReader.fromBuffer(tampered)).toThrow(/Invalid RVFA magic/);
  });

  it('verify() fails for tampered section data', () => {
    const tampered = Buffer.from(validBuf);
    const sections = RvfaReader.fromBuffer(validBuf).getSections();
    tampered[sections[0].offset + 1] ^= 0xff;
    const result = RvfaReader.fromBuffer(tampered).verify();
    expect(!result.valid).toBeTruthy();
    expect(result.errors.some((e) => e.includes('SHA256 mismatch'))).toBeTruthy();
  });

  it('verify() fails for tampered footer hash', () => {
    const tampered = Buffer.from(validBuf);
    tampered[tampered.length - 1] ^= 0xff;
    const result = RvfaReader.fromBuffer(tampered).verify();
    expect(!result.valid).toBeTruthy();
    expect(result.errors.some((e) => e.includes('Footer SHA256 mismatch'))).toBeTruthy();
  });

  it('rejects files with wrong magic bytes', () => {
    const bad = Buffer.alloc(100);
    bad.write('NOPE', 0, 'ascii');
    expect(() => RvfaReader.fromBuffer(bad)).toThrow(/Invalid RVFA magic/);
  });

  it('rejects files with header too large (>1MB)', () => {
    const buf = Buffer.alloc(20);
    buf.write('RVFA', 0, 'ascii');
    buf.writeUInt32LE(RVFA_VERSION, 4);
    buf.writeUInt32LE(2 * 1024 * 1024, 8);
    expect(() => RvfaReader.fromBuffer(buf)).toThrow(/exceeds maximum size/);
  });

  it('handles empty sections', () => {
    const writer = makeWriter();
    writer.addSection('kernel', Buffer.alloc(0), { compression: 'none' });
    const data = RvfaReader.fromBuffer(writer.build()).extractSection('kernel');
    expect(data.length).toBe(0);
  });

  it('handles multiple sections', () => {
    const writer = makeWriter();
    writer.addSection('kernel', Buffer.from('k'), { compression: 'none' });
    writer.addSection('runtime', Buffer.from('r'), { compression: 'none' });
    writer.addSection('ruflo', Buffer.from('f'), { compression: 'none' });
    writer.addSection('models', Buffer.from('m'), { compression: 'none' });
    writer.addSection('data', Buffer.from('d'), { compression: 'none' });
    writer.addSection('verify', Buffer.from('v'), { compression: 'none' });
    const reader = RvfaReader.fromBuffer(writer.build());
    expect(reader.getSections().length).toBe(6);
    expect(reader.extractSection('kernel').toString()).toBe('k');
    expect(reader.extractSection('verify').toString()).toBe('v');
  });

  it('throws when extracting a nonexistent section', () => {
    expect(() => RvfaReader.fromBuffer(validBuf).extractSection('nonexistent')).toThrow(/not found/);
  });
});

// -- 7. Security --------------------------------------------------------------

describe('Security', () => {
  it('rejects negative section offsets', () => {
    const writer = makeWriter();
    writer.addSection('kernel', Buffer.from('data'), { compression: 'none' });
    const buf = writer.build();

    const headerLen = buf.readUInt32LE(8);
    const header = JSON.parse(buf.subarray(12, 12 + headerLen).toString('utf-8'));
    header.sections[0].offset = -100;
    const corruptedHeader = Buffer.from(JSON.stringify(header), 'utf-8');

    const corrupted = Buffer.concat([
      buf.subarray(0, 4),
      buf.subarray(4, 8),
      Buffer.alloc(4),
      corruptedHeader,
      buf.subarray(12 + headerLen),
    ]);
    corrupted.writeUInt32LE(corruptedHeader.length, 8);

    expect(() => RvfaReader.fromBuffer(corrupted)).toThrow(/negative/i);
  });

  it('rejects overlapping sections', () => {
    const writer = makeWriter();
    writer.addSection('kernel', Buffer.from('aaaa'), { compression: 'none' });
    writer.addSection('runtime', Buffer.from('bbbb'), { compression: 'none' });
    const buf = writer.build();

    const headerLen = buf.readUInt32LE(8);
    const header = JSON.parse(buf.subarray(12, 12 + headerLen).toString('utf-8'));
    header.sections[1].offset = header.sections[0].offset + 1;
    const corruptedHeader = Buffer.from(JSON.stringify(header), 'utf-8');

    const corrupted = Buffer.concat([
      buf.subarray(0, 4),
      buf.subarray(4, 8),
      Buffer.alloc(4),
      corruptedHeader,
      buf.subarray(12 + headerLen),
    ]);
    corrupted.writeUInt32LE(corruptedHeader.length, 8);

    expect(() => RvfaReader.fromBuffer(corrupted)).toThrow(/overlap/i);
  });

  it('rejects header larger than 1MB', () => {
    const buf = Buffer.alloc(20);
    buf.write('RVFA', 0, 'ascii');
    buf.writeUInt32LE(RVFA_VERSION, 4);
    buf.writeUInt32LE(1_048_577, 8);
    expect(() => RvfaReader.fromBuffer(buf)).toThrow(/exceeds maximum size/);
  });

  it('rejects buffer too small for preamble', () => {
    const buf = Buffer.alloc(8);
    buf.write('RVFA', 0, 'ascii');
    expect(() => RvfaReader.fromBuffer(buf)).toThrow(/too small/);
  });

  it('rejects file paths with null bytes', async () => {
    await expect(RvfaReader.fromFile('/tmp/test\0exploit.rvfa')).rejects.toThrow(/null bytes/);
  });
});
