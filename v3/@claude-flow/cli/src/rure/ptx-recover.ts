/**
 * Conservative, non-executing PTX -> CUDA C++ recovery (ADR-0009).
 * Emission is not a proof. It is limited to scalar integer kernels with valid,
 * aligned, race-free global accesses and the original launch/argument contract.
 * Neither source text nor recovered code is ever executed by this module.
 */
import { decompilePtx, type PtxFunction, type PtxInstruction } from './ptx-decompile.js';

export const MAX_PTX_RECOVERY_REGISTERS = 256;
export const MAX_PTX_RECOVERY_CODE_BYTES = 512 * 1024;
const MAX_MODULE_REGISTERS = 1024;
const MAX_DATAFLOW_STEPS = 100_000;
type Width = 32 | 64;
type Register = { name: string; emitted: string; width: Width | 'pred'; bit: bigint };
export interface PtxRecoveredParameter { name: string; emittedName: string; type: 'uint32_t' | 'uint64_t' }
export interface PtxRecoveredFunction { name: string; emittedName: string; parameters: PtxRecoveredParameter[] }
export interface PtxRecovery {
  schemaVersion: 1;
  sourceSha256: string;
  status: 'emitted' | 'unsupported' | 'invalid';
  language: 'cuda-cpp';
  code: string | null;
  diagnostics: string[];
  functions: PtxRecoveredFunction[];
  semanticScope: string[];
  proofStatus: 'not-proven';
}
class Unsupported extends Error {}
const fail = (message: string): never => { throw new Unsupported(message); };
const integerType = /^[bus](32|64)$/;
const cppType = (width: Width): 'uint32_t' | 'uint64_t' => width === 32 ? 'uint32_t' : 'uint64_t';
const mask = (width: Width): bigint => (1n << BigInt(width)) - 1n;
const cast = (width: Width, expression: string): string => `static_cast<${cppType(width)}>(${expression})`;

/** PTX integer spelling follows C, so 010 is octal eight, never decimal ten. */
function unsignedLiteral(value: string): bigint {
  if (/^0[xX][0-9a-fA-F]+$/.test(value)) return BigInt(value);
  if (/^0[0-7]+$/.test(value)) return BigInt(`0o${value.slice(1)}`);
  if (/^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  return fail(`unsupported integer literal ${value}`);
}

function registers(fn: PtxFunction): Map<string, Register> {
  const out = new Map<string, Register>();
  for (const declaration of fn.registers) {
    const match = /^\.(pred|[bus](?:32|64)) (.+)$/.exec(declaration);
    if (!match) fail(`unsupported register type in ${fn.name}`);
    const width = match![1] === 'pred' ? 'pred' : Number(match![1]!.slice(1)) as Width;
    for (const piece of match![2]!.split(' , ')) {
      const part = /^(%[A-Za-z][A-Za-z0-9_]*)(?: < ([1-9][0-9]*) >)?$/.exec(piece);
      if (!part) fail('unsupported register declaration');
      const count = part![2] ? Number(part![2]) : 1;
      if (!Number.isSafeInteger(count) || count > MAX_PTX_RECOVERY_REGISTERS || out.size + count > MAX_PTX_RECOVERY_REGISTERS) fail(`expanded register count exceeds ${MAX_PTX_RECOVERY_REGISTERS}`);
      for (let i = 0; i < count; i++) {
        const name = part![1]! + (part![2] ? i : '');
        if (out.has(name)) fail(`duplicate register ${name}`);
        const index = out.size;
        out.set(name, { name, emitted: `rure_reg_${index}`, width, bit: 1n << BigInt(index) });
      }
    }
  }
  return out;
}

function parameters(fn: PtxFunction): PtxRecoveredParameter[] {
  const out: PtxRecoveredParameter[] = [];
  const seen = new Set<string>();
  for (const declaration of fn.params) {
    const match = /^\.param \.([bus](?:32|64)) ([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(declaration);
    if (!match) fail(`only scalar 32/64-bit integer parameters are supported in ${fn.name}`);
    const name = match![2]!;
    if (seen.has(name)) fail(`duplicate parameter ${name}`);
    seen.add(name);
    out.push({ name, emittedName: `rure_arg_${out.length}`, type: cppType(Number(match![1]!.slice(1)) as Width) });
  }
  return out;
}

interface Lowered { statement: string; reads: bigint; defines: bigint; successors: number[] }
class FunctionRecovery {
  readonly regs: Map<string, Register>;
  readonly meta: PtxRecoveredFunction;
  private reads = 0n;
  private defines = 0n;
  constructor(readonly fn: PtxFunction, index: number) {
    if (fn.kind !== 'entry' || fn.returnParams.length || !fn.instructions.length) fail('only defined entry kernels are supported');
    this.regs = registers(fn);
    this.meta = { name: fn.name, emittedName: `rure_kernel_${index}`, parameters: parameters(fn) };
  }
  register(name: string, width: Width | 'pred', write = false): string {
    const reg = this.regs.get(name);
    if (!reg || reg.width !== width) fail(`undeclared or width-mismatched register ${name}; expected ${width}`);
    if (write) this.defines |= reg!.bit;
    else this.reads |= reg!.bit;
    return reg!.emitted;
  }
  operand(value: string, width: Width): string {
    const special = /^%(tid|ntid|ctaid|nctaid)\.([xyz])$/.exec(value);
    if (special) {
      if (width !== 32) fail(`special register ${value} requires a 32-bit operation`);
      const names: Record<string, string> = { tid: 'threadIdx', ntid: 'blockDim', ctaid: 'blockIdx', nctaid: 'gridDim' };
      return `static_cast<uint32_t>(${names[special[1]!]}.${special[2]})`;
    }
    if (value.startsWith('%')) return this.register(value, width);
    const compact = value.replaceAll(' ', '');
    if (!/^-?(?:[0-9]+|0[xX][0-9a-fA-F]+)$/.test(compact)) fail(`unsupported integer operand ${value}`);
    let integer: bigint;
    try { integer = compact.startsWith('-') ? -unsignedLiteral(compact.slice(1)) : unsignedLiteral(compact); }
    catch { return fail('invalid integer immediate'); }
    // PTX allows conversion of integer constants to the instruction width. This
    // backend deliberately declines narrowing outside the width's bit domain.
    if (integer < -(1n << BigInt(width - 1)) || integer > mask(width)) fail(`integer immediate outside ${width}-bit domain`);
    return cast(width, `0x${(integer & mask(width)).toString(16)}ULL`);
  }
  address(value: string): string {
    const match = /^\[ (%[A-Za-z][A-Za-z0-9_]*)(?: ([+-]) ([0-9]+|0[xX][0-9a-fA-F]+))? \]$/.exec(value);
    if (!match) fail(`unsupported global address ${value}`);
    const base = this.register(match![1]!, 64);
    if (!match![2]) return base;
    const offset = unsignedLiteral(match![3]!);
    if (offset > 0x7fffffffffffffffn) fail('global address offset exceeds signed 64-bit range');
    return `(${base} ${match![2]} 0x${offset.toString(16)}ULL)`;
  }
  lower(ins: PtxInstruction): Lowered {
    this.reads = 0n; this.defines = 0n;
    const op = ins.opcode;
    const args = ins.operands;
    let statement: string;
    let successors = ins.index + 1 < this.fn.instructions.length ? [ins.index + 1] : [];
    if (!ins.supported) fail(`unsupported instruction ${op} at line ${ins.line}`);
    if (op === 'ret' || op === 'exit') {
      statement = 'return;';
      if (ins.predicate === null) successors = [];
    } else if (op === 'bra' || op === 'bra.uni') {
      const target = this.fn.labels[args[0]!]!;
      statement = `goto rure_label_${target};`;
      successors = ins.predicate === null ? [target] : [...new Set([target, ...successors])];
    } else {
      const parts = op.split('.');
      const type = parts.at(-1)!;
      if (!integerType.test(type)) fail(`unsupported semantic opcode ${op} at line ${ins.line}`);
      const width = Number(type.slice(1)) as Width;
      const src = (n: number): string => this.operand(args[n]!, width);
      const dst = (bits: Width = width): string => this.register(args[0]!, bits, true);
      if (/^mov\.[bus](32|64)$/.test(op)) statement = `${dst()} = ${src(1)};`;
      else if (/^ld\.param\.[bus](32|64)$/.test(op)) {
        const match = /^\[ ([A-Za-z_$][A-Za-z0-9_$]*) \]$/.exec(args[1]!);
        const param = match && this.meta.parameters.find(p => p.name === match[1]);
        if (!param || param.type !== cppType(width)) fail(`parameter load must match a declared scalar's complete width at line ${ins.line}`);
        statement = `${dst()} = ${param!.emittedName};`;
      } else if (/^ld\.global\.[bus](32|64)$/.test(op)) statement = `${dst()} = rure_detail::load${width}(${this.address(args[1]!)});`;
      else if (/^st\.global\.[bus](32|64)$/.test(op)) statement = `rure_detail::store${width}(${this.address(args[0]!)}, ${src(1)});`;
      else if (op === 'cvta.to.global.u64') statement = `${dst()} = ${src(1)};`;
      else if (/^(add|sub)\.[us](32|64)$/.test(op)) statement = `${dst()} = ${cast(width, `static_cast<uint64_t>(${src(1)}) ${parts[0] === 'add' ? '+' : '-'} static_cast<uint64_t>(${src(2)})`)};`;
      else if (/^mul\.lo\.[us](32|64)$/.test(op)) statement = `${dst()} = ${cast(width, `static_cast<uint64_t>(${src(1)}) * static_cast<uint64_t>(${src(2)})`)};`;
      else if (/^mad\.lo\.[us](32|64)$/.test(op)) statement = `${dst()} = ${cast(width, `static_cast<uint64_t>(${src(1)}) * static_cast<uint64_t>(${src(2)}) + static_cast<uint64_t>(${src(3)})`)};`;
      else if (op === 'mul.wide.u32') statement = `${dst(64)} = static_cast<uint64_t>(${src(1)}) * static_cast<uint64_t>(${src(2)});`;
      else if (op === 'mul.wide.s32') statement = `${dst(64)} = static_cast<uint64_t>(rure_detail::signed32(${src(1)}) * rure_detail::signed32(${src(2)}));`;
      else if (/^setp\.(eq|ne|lt|le|gt|ge)\.[us](32|64)$/.test(op)) {
        const cmp: Record<string, string> = { eq: '==', ne: '!=', lt: '<', le: '<=', gt: '>', ge: '>=' };
        const a = src(1), b = src(2);
        const bias = type.startsWith('s') && !['eq', 'ne'].includes(parts[1]!) ? ` ^ 0x${(1n << BigInt(width - 1)).toString(16)}ULL` : '';
        statement = `${this.register(args[0]!, 'pred', true)} = (${a}${bias}) ${cmp[parts[1]!]} (${b}${bias});`;
      } else fail(`unsupported semantic opcode ${op} at line ${ins.line}`);
    }
    if (ins.predicate !== null) {
      const inverted = ins.predicate.startsWith('!');
      const predicate = this.register(inverted ? ins.predicate.slice(1) : ins.predicate, 'pred');
      statement = `if (${inverted ? '!' : ''}${predicate}) { ${statement!} }`;
      // A predicated assignment cannot establish a must-definition. Correlated
      // predicates are deliberately not used to excuse uninitialized reads.
      this.defines = 0n;
    }
    return { statement: statement!, reads: this.reads, defines: this.defines, successors };
  }
  emit(): string {
    const instructions = this.fn.instructions.map(ins => this.lower(ins));
    assertInitialized(instructions, this.regs, this.fn);
    const args = this.meta.parameters.map(p => `${p.type} ${p.emittedName}`).join(', ');
    const out = [`extern "C" __global__ void ${this.meta.emittedName}(${args}) {`];
    for (const r of this.regs.values()) out.push(`  ${r.width === 'pred' ? 'bool' : cppType(r.width)} ${r.emitted};`);
    const targets = new Set(this.fn.instructions.filter(ins => ins.opcode === 'bra' || ins.opcode === 'bra.uni').map(ins => this.fn.labels[ins.operands[0]!]!));
    for (let i = 0; i < instructions.length; i++) {
      if (targets.has(i)) out.push(`rure_label_${i}:`);
      out.push(`  ${instructions[i]!.statement}`);
    }
    out.push('}');
    return out.join('\n');
  }
}

/** Forward must-analysis with an explicit empty entry predecessor, even for loops. */
function assertInitialized(instructions: Lowered[], regs: Map<string, Register>, fn: PtxFunction): void {
  const reachable = new Set<number>();
  const pending = [0];
  while (pending.length) {
    const i = pending.pop()!;
    if (reachable.has(i)) continue;
    reachable.add(i);
    for (const target of instructions[i]!.successors) pending.push(target);
  }
  const predecessors = instructions.map(() => [] as number[]);
  for (const i of reachable) for (const s of instructions[i]!.successors) predecessors[s]!.push(i);
  const all = (1n << BigInt(regs.size)) - 1n;
  const incoming = instructions.map(() => all), outgoing = instructions.map(() => all);
  const queue = [...reachable];
  const queued = new Set(queue);
  let at = 0;
  while (at < queue.length) {
    if (at >= MAX_DATAFLOW_STEPS) fail('definite-initialization analysis budget exceeded');
    const i = queue[at++]!; queued.delete(i);
    let input = i === 0 ? 0n : all;
    for (const pred of predecessors[i]!) input &= outgoing[pred]!;
    incoming[i] = input;
    const output = input | instructions[i]!.defines;
    if (output === outgoing[i]) continue;
    outgoing[i] = output;
    for (const s of instructions[i]!.successors) if (!queued.has(s)) { queue.push(s); queued.add(s); }
  }
  for (const i of reachable) {
    const missing = instructions[i]!.reads & ~incoming[i]!;
    if (missing) {
      const names = [...regs.values()].filter(r => (r.bit & missing) !== 0n).map(r => r.name);
      fail(`register may be uninitialized at line ${fn.instructions[i]!.line}: ${names.join(', ')}`);
    }
    const ins = fn.instructions[i]!;
    if (i === instructions.length - 1 && !['ret', 'exit', 'bra', 'bra.uni'].includes(ins.opcode)) fail('reachable kernel fallthrough without ret/exit is unsupported');
    if (i === instructions.length - 1 && ins.predicate !== null) fail('conditional terminator can fall through kernel end');
  }
}

const PRELUDE = `// Generated scalar integer recovery. Not a proof or a memory safety guarantee.
// Requires original ABI/launch, valid aligned race-free global memory, 64-bit CUDA.
#include <stdint.h>
static_assert(sizeof(uintptr_t) == 8, "RuRE recovery requires 64-bit pointers");
// PTX global accesses must be naturally aligned (this module's stated precondition), so a typed access is the original instruction.
// may_alias keeps type punning defined; byte loops compiled to four LD.E.U8 / ST.E.U8 per word (measured 3.8x slower on a load-bound kernel).
typedef uint32_t __attribute__((may_alias, aligned(4))) rure_u32a;
typedef uint64_t __attribute__((may_alias, aligned(8))) rure_u64a;
namespace rure_detail {
static __device__ inline uint32_t load32(uint64_t address) { return *reinterpret_cast<const rure_u32a*>(static_cast<uintptr_t>(address)); }
static __device__ inline uint64_t load64(uint64_t address) { return *reinterpret_cast<const rure_u64a*>(static_cast<uintptr_t>(address)); }
static __device__ inline void store32(uint64_t address, uint32_t value) { *reinterpret_cast<rure_u32a*>(static_cast<uintptr_t>(address)) = value; }
static __device__ inline void store64(uint64_t address, uint64_t value) { *reinterpret_cast<rure_u64a*>(static_cast<uintptr_t>(address)) = value; }
static __device__ inline int64_t signed32(uint32_t value) {
  return static_cast<int64_t>(value) - static_cast<int64_t>(value >> 31) * 4294967296LL;
}
}
`;

export function recoverPtx(text: string): PtxRecovery {
  const parsed = decompilePtx(text);
  const result: PtxRecovery = {
    schemaVersion: 1, sourceSha256: parsed.sourceSha256, status: 'invalid', language: 'cuda-cpp',
    code: null, diagnostics: [], functions: [], proofStatus: 'not-proven',
    semanticScope: [
      'scalar 32/64-bit integer entry kernels; modular arithmetic and signed comparisons',
      'declared registers with conservative control-flow definite-initialization checks',
      '64-bit CUDA, original scalar argument ABI and launch dimensions',
      'valid aligned race-free global memory and global-space pointer values only',
      'no floating point, shared memory, atomics, synchronization, calls, or SASS recovery',
      'emitted source requires independent compilation and workload validation; no equivalence proof',
    ],
  };
  if (parsed.status === 'invalid') { result.diagnostics = [...parsed.warnings]; return result; }
  try {
    if (parsed.status !== 'complete') fail('structural parser reported unsupported constructs');
    if (parsed.addressSize !== 64) fail('only 64-bit addressing is supported');
    const recovered = parsed.functions.map((fn, i) => new FunctionRecovery(fn, i));
    if (recovered.reduce((n, fn) => n + fn.regs.size, 0) > MAX_MODULE_REGISTERS) fail(`module register count exceeds ${MAX_MODULE_REGISTERS}`);
    const code = PRELUDE + recovered.map(fn => fn.emit()).join('\n\n') + '\n';
    if (Buffer.byteLength(code, 'utf8') > MAX_PTX_RECOVERY_CODE_BYTES) fail(`generated code exceeds ${MAX_PTX_RECOVERY_CODE_BYTES} bytes`);
    result.code = code;
    result.functions = recovered.map(fn => fn.meta);
    result.status = 'emitted';
  } catch (error) {
    result.status = 'unsupported';
    result.diagnostics.push(error instanceof Error ? error.message : 'recovery failed');
  }
  return result;
}
