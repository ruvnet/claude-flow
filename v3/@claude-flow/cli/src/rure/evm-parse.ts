/**
 * ruRE Phase 4 — EVM bytecode static inventory (ADR-0005).
 * Aligned disassembly + pattern scan over bytes. There is no interpreter:
 * nothing is executed, no RPC, no network.
 */

export const MAX_EVM_BYTES = 256 * 1024;
const MAX_LIST = 200;
const MAX_OFFSETS = 20;
const MAX_STRINGS = 100;

const SIMPLE: Record<number, string> = {
  0x00: 'STOP', 0x01: 'ADD', 0x02: 'MUL', 0x03: 'SUB', 0x04: 'DIV', 0x05: 'SDIV', 0x06: 'MOD', 0x07: 'SMOD', 0x08: 'ADDMOD',
  0x09: 'MULMOD', 0x0a: 'EXP', 0x0b: 'SIGNEXTEND', 0x10: 'LT', 0x11: 'GT', 0x12: 'SLT', 0x13: 'SGT', 0x14: 'EQ', 0x15: 'ISZERO',
  0x16: 'AND', 0x17: 'OR', 0x18: 'XOR', 0x19: 'NOT', 0x1a: 'BYTE', 0x1b: 'SHL', 0x1c: 'SHR', 0x1d: 'SAR', 0x20: 'KECCAK256',
  0x30: 'ADDRESS', 0x31: 'BALANCE', 0x32: 'ORIGIN', 0x33: 'CALLER', 0x34: 'CALLVALUE', 0x35: 'CALLDATALOAD', 0x36: 'CALLDATASIZE',
  0x37: 'CALLDATACOPY', 0x38: 'CODESIZE', 0x39: 'CODECOPY', 0x3a: 'GASPRICE', 0x3b: 'EXTCODESIZE', 0x3c: 'EXTCODECOPY',
  0x3d: 'RETURNDATASIZE', 0x3e: 'RETURNDATACOPY', 0x3f: 'EXTCODEHASH', 0x40: 'BLOCKHASH', 0x41: 'COINBASE', 0x42: 'TIMESTAMP',
  0x43: 'NUMBER', 0x44: 'PREVRANDAO', 0x45: 'GASLIMIT', 0x46: 'CHAINID', 0x47: 'SELFBALANCE', 0x48: 'BASEFEE', 0x49: 'BLOBHASH',
  0x4a: 'BLOBBASEFEE', 0x50: 'POP', 0x51: 'MLOAD', 0x52: 'MSTORE', 0x53: 'MSTORE8', 0x54: 'SLOAD', 0x55: 'SSTORE', 0x56: 'JUMP',
  0x57: 'JUMPI', 0x58: 'PC', 0x59: 'MSIZE', 0x5a: 'GAS', 0x5b: 'JUMPDEST', 0x5c: 'TLOAD', 0x5d: 'TSTORE', 0x5e: 'MCOPY', 0x5f: 'PUSH0',
  0xf0: 'CREATE', 0xf1: 'CALL', 0xf2: 'CALLCODE', 0xf3: 'RETURN', 0xf4: 'DELEGATECALL', 0xf5: 'CREATE2', 0xfa: 'STATICCALL',
  0xfd: 'REVERT', 0xfe: 'INVALID', 0xff: 'SELFDESTRUCT',
};

export function opcodeName(op: number): string | null {
  if (SIMPLE[op]) return SIMPLE[op];
  if (op >= 0x60 && op <= 0x7f) return `PUSH${op - 0x5f}`;
  if (op >= 0x80 && op <= 0x8f) return `DUP${op - 0x7f}`;
  if (op >= 0x90 && op <= 0x9f) return `SWAP${op - 0x8f}`;
  if (op >= 0xa0 && op <= 0xa4) return `LOG${op - 0xa0}`;
  return null;
}

const HAZARDS: Record<number, string> = {
  0xff: 'SELFDESTRUCT', 0xf4: 'DELEGATECALL', 0xf2: 'CALLCODE', 0xf0: 'CREATE', 0xf5: 'CREATE2', 0x32: 'ORIGIN',
  0xf1: 'CALL', 0xfa: 'STATICCALL',
};

const KNOWN_SELECTORS: Record<string, string> = {
  '0xa9059cbb': 'transfer(address,uint256)', '0x70a08231': 'balanceOf(address)', '0x23b872dd': 'transferFrom(address,address,uint256)',
  '0x095ea7b3': 'approve(address,uint256)', '0xdd62ed3e': 'allowance(address,address)', '0x18160ddd': 'totalSupply()',
  '0x06fdde03': 'name()', '0x95d89b41': 'symbol()', '0x313ce567': 'decimals()', '0x8da5cb5b': 'owner()',
  '0xf2fde38b': 'transferOwnership(address)', '0x715018a6': 'renounceOwnership()', '0x3659cfe6': 'upgradeTo(address)',
  '0x5c60da1b': 'implementation()', '0x01ffc9a7': 'supportsInterface(bytes4)', '0x42842e0e': 'safeTransferFrom(address,address,uint256)',
  '0x6352211e': 'ownerOf(uint256)', '0x40c10f19': 'mint(address,uint256)', '0x42966c68': 'burn(uint256)',
  '0x8456cb59': 'pause()', '0x3f4ba83a': 'unpause()',
};

const KNOWN_TOPICS: Record<string, string> = {
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'Transfer(address,address,uint256)',
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925': 'Approval(address,address,uint256)',
};

export interface EvmInfo {
  byteLength: number;
  instructionCount: number;
  jumpdestCount: number;
  invalidOpcodeCount: number;
  selectors: { selector: string; name: string | null; offset: number }[];
  hazards: Record<string, { count: number; offsets: number[] }>;
  addresses: string[];
  eventTopics: { topic: string; name: string | null; offset: number }[];
  minimalProxy: { implementation: string } | null;
  metadata: { solc?: string; ipfs?: string; bzzr?: string; experimental?: boolean } | null;
  strings: string[];
  disassembly?: string[];
  warnings: string[];
  truncated: boolean;
}

export type HexParse = { ok: true; bytes: Buffer } | { ok: false; error: string };

/** Accepts `0x`-optional hex; rejects odd length, non-hex, empty, and over-cap input. */
export function parseHex(text: string): HexParse {
  const t = text.trim().replace(/^0x/i, '');
  if (!t) return { ok: false, error: 'empty bytecode' };
  if (t.length % 2 !== 0) return { ok: false, error: 'odd number of hex digits' };
  if (t.length / 2 > MAX_EVM_BYTES) return { ok: false, error: `bytecode exceeds the ${MAX_EVM_BYTES}-byte cap` };
  if (!/^[0-9a-fA-F]+$/.test(t)) return { ok: false, error: 'not hexadecimal' };
  return { ok: true, bytes: Buffer.from(t, 'hex') };
}

function hex(b: Buffer, start: number, end: number): string {
  return '0x' + b.toString('hex', start, end);
}

function parseMetadata(b: Buffer): EvmInfo['metadata'] {
  if (b.length < 4) return null;
  const len = (b[b.length - 2] << 8) | b[b.length - 1];
  const start = b.length - 2 - len;
  if (len < 3 || len > 128 || start < 0) return null;
  const end = b.length - 2;
  let o = start;
  if ((b[o] & 0xe0) !== 0xa0) return null;
  const pairs = b[o] & 0x1f;
  o += 1;
  const out: NonNullable<EvmInfo['metadata']> = {};
  for (let i = 0; i < pairs; i++) {
    if (o >= end || (b[o] & 0xe0) !== 0x60) return null;
    const klen = b[o] & 0x1f;
    if (klen >= 24 || o + 1 + klen > end) return null;
    const key = b.toString('latin1', o + 1, o + 1 + klen);
    o += 1 + klen;
    if (o >= end) return null;
    const head = b[o];
    if (head === 0xf5 || head === 0xf4) {
      if (key === 'experimental') out.experimental = head === 0xf5;
      o += 1;
    } else if ((head & 0xe0) === 0x40) {
      let vlen = head & 0x1f;
      let vo = o + 1;
      if (vlen === 24) {
        vlen = b[vo];
        vo += 1;
      } else if (vlen > 24) return null;
      if (vo + vlen > end) return null;
      if (key === 'solc' && vlen === 3) out.solc = `${b[vo]}.${b[vo + 1]}.${b[vo + 2]}`;
      else if (key === 'ipfs') out.ipfs = b.toString('hex', vo, vo + vlen);
      else if (key.startsWith('bzzr')) out.bzzr = b.toString('hex', vo, vo + vlen);
      o = vo + vlen;
    } else return null;
  }
  return o === end && (out.solc || out.ipfs || out.bzzr) ? out : null;
}

const EIP1167_PREFIX = Buffer.from('363d3d373d3d3d363d73', 'hex');
const EIP1167_SUFFIX = Buffer.from('5af43d82803e903d91602b57fd5bf3', 'hex');

function detectMinimalProxy(b: Buffer): { implementation: string } | null {
  if (b.length < 45 || !b.subarray(0, 10).equals(EIP1167_PREFIX) || !b.subarray(30, 45).equals(EIP1167_SUFFIX)) return null;
  return { implementation: hex(b, 10, 30) };
}

interface Ins { off: number; op: number; dataStart: number; dataLen: number }

/** Aligned disassembly: PUSH immediates are data, never opcodes. Truncated trailing PUSH data is clamped. */
function disassemble(b: Buffer): Ins[] {
  const out: Ins[] = [];
  for (let i = 0; i < b.length; ) {
    const op = b[i];
    const n = op >= 0x60 && op <= 0x7f ? op - 0x5f : 0;
    out.push({ off: i, op, dataStart: i + 1, dataLen: Math.min(n, b.length - i - 1) });
    i += 1 + n;
  }
  return out;
}

export function analyzeEvm(b: Buffer, includeDisassembly = false): EvmInfo {
  const info: EvmInfo = {
    byteLength: b.length, instructionCount: 0, jumpdestCount: 0, invalidOpcodeCount: 0, selectors: [], hazards: {},
    addresses: [], eventTopics: [], minimalProxy: null, metadata: null, strings: [], warnings: [], truncated: false,
  };
  if (b.length > MAX_EVM_BYTES) {
    info.warnings.push(`bytecode exceeds the ${MAX_EVM_BYTES}-byte cap; nothing analyzed`);
    return info;
  }
  info.minimalProxy = detectMinimalProxy(b);
  info.metadata = parseMetadata(b);
  const ins = disassemble(b);
  info.instructionCount = ins.length;
  const addrSeen = new Set<string>();
  const strSeen = new Set<string>();
  const seenSel = new Set<string>();

  if (includeDisassembly) {
    info.disassembly = ins.slice(0, 500).map((x) => {
      const name = opcodeName(x.op) ?? `UNKNOWN(0x${x.op.toString(16)})`;
      return x.dataLen ? `${x.off} ${name} ${hex(b, x.dataStart, x.dataStart + x.dataLen)}` : `${x.off} ${name}`;
    });
    if (ins.length > 500) info.truncated = true;
  }

  for (let k = 0; k < ins.length; k++) {
    const x = ins[k];
    if (x.op === 0x5b) info.jumpdestCount += 1;
    if (opcodeName(x.op) === null) info.invalidOpcodeCount += 1;

    const hazard = HAZARDS[x.op];
    if (hazard) {
      const h = (info.hazards[hazard] ??= { count: 0, offsets: [] });
      h.count += 1;
      if (h.offsets.length < MAX_OFFSETS) h.offsets.push(x.off);
    }

    if (x.op === 0x63 && x.dataLen === 4) {
      const next = ins[k + 1];
      const after = ins[k + 2];
      const isEq = next?.op === 0x14 || (next?.op === 0x81 && after?.op === 0x14);
      const sel = hex(b, x.dataStart, x.dataStart + 4);
      if (isEq && !seenSel.has(sel)) {
        seenSel.add(sel);
        if (info.selectors.length < MAX_LIST) info.selectors.push({ selector: sel, name: KNOWN_SELECTORS[sel] ?? null, offset: x.off });
        else info.truncated = true;
      }
    }

    if (x.op === 0x73 && x.dataLen === 20) {
      const a = hex(b, x.dataStart, x.dataStart + 20);
      const nonTrivial = /[1-9a-f]/.test(a.slice(2)) && !/^0x(f{40})$/.test(a);
      if (nonTrivial && !addrSeen.has(a)) {
        addrSeen.add(a);
        if (info.addresses.length < MAX_LIST) info.addresses.push(a);
        else info.truncated = true;
      }
    }

    if (x.op >= 0xa1 && x.op <= 0xa4) {
      for (let j = k - 1; j >= Math.max(0, k - 12); j--) {
        if (ins[j].op === 0x7f && ins[j].dataLen === 32) {
          const topic = hex(b, ins[j].dataStart, ins[j].dataStart + 32);
          if (!info.eventTopics.some((t) => t.topic === topic) && info.eventTopics.length < MAX_LIST) {
            info.eventTopics.push({ topic, name: KNOWN_TOPICS[topic] ?? null, offset: x.off });
          }
          break;
        }
      }
    }

    if (x.op >= 0x60 && x.op <= 0x7f && x.dataLen >= 8) {
      const raw = b.subarray(x.dataStart, x.dataStart + x.dataLen);
      let end = raw.length;
      while (end > 0 && raw[end - 1] === 0) end--;
      let start = 0;
      while (start < end && raw[start] === 0) start++;
      const text = raw.subarray(start, end);
      if (text.length >= 8 && text.every((c) => c >= 0x20 && c < 0x7f)) {
        const s = text.toString('latin1');
        if (!strSeen.has(s) && info.strings.length < MAX_STRINGS) {
          strSeen.add(s);
          info.strings.push(s);
        }
      }
    }
  }
  return info;
}
