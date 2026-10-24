/**
 * Bounded PTX structural decompiler (ADR-0007). The output is evidence-backed,
 * C-like pseudocode, not executable CUDA and not a proof of equivalence.
 * Each intrinsic preserves the PTX opcode including width/rounding/address space.
 */
import { createHash } from 'node:crypto';

export const MAX_PTX_DECOMPILE_BYTES = 256 * 1024;
const MAX_TOKENS = 100_000;
const MAX_INSTRUCTIONS = 4096;
const MAX_BLOCKS = 2048;
const MAX_FUNCTIONS = 64;
const MAX_LABELS = 4096;
const MAX_TOKEN_LENGTH = 512;

export interface PtxInstruction {
  index: number;
  line: number;
  opcode: string;
  operands: string[];
  /** Includes ! for an inverted predicate, excludes @. */
  predicate: string | null;
  supported: boolean;
}
export interface PtxBlock {
  id: string;
  labels: string[];
  start: number;
  /** Exclusive instruction index. */
  end: number;
  successors: string[];
}
export interface PtxFunction {
  name: string;
  kind: 'entry' | 'func';
  params: string[];
  returnParams: string[];
  registers: string[];
  instructions: PtxInstruction[];
  blocks: PtxBlock[];
  labels: Record<string, number>;
  pseudocode: string;
  unsupported: { line: number; opcode: string; reason: string }[];
}
export interface PtxDecompilation {
  schemaVersion: 1;
  sourceSha256: string;
  language: 'ptx';
  ptxVersion: string | null;
  target: string | null;
  addressSize: number | null;
  /** 'complete' means supported syntax coverage, never semantic equivalence. */
  status: 'complete' | 'partial' | 'invalid';
  truncated: boolean;
  functions: PtxFunction[];
  warnings: string[];
  totalInstructionCount: number;
  supportedInstructionCount: number;
}

interface Token { text: string; line: number }
class InvalidPtx extends Error {}
class LimitPtx extends Error {}
const identifier = /^[A-Za-z_$%][A-Za-z0-9_$%.]*$/;
const labelName = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Linear scanner: comments are discarded but their newlines still count. */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) { if (c === '\n') line++; i++; continue; }
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i + 2);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new InvalidPtx(`unterminated comment at line ${line}`);
      while (i < end + 2) { if (text[i++] === '\n') line++; }
      continue;
    }
    const start = i;
    const startLine = line;
    if (c === '"') {
      i++;
      let closed = false;
      while (i < text.length) {
        if (text[i] === '\n' || text[i] === '\r') throw new InvalidPtx(`newline in string at line ${line}`);
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i++] === '"') { closed = true; break; }
      }
      if (!closed) throw new InvalidPtx(`unterminated string at line ${line}`);
    } else if ('{}()[],:;@!<>|=+-'.includes(c)) i++;
    else {
      while (i < text.length && !/\s/.test(text[i]!) && !'{}()[],:;@!<>|=+-"'.includes(text[i]!) && !text.startsWith('//', i) && !text.startsWith('/*', i)) i++;
    }
    if (i - start > MAX_TOKEN_LENGTH) throw new LimitPtx(`token length exceeds ${MAX_TOKEN_LENGTH} at line ${line}`);
    out.push({ text: text.slice(start, i), line: startLine });
    if (out.length > MAX_TOKENS) throw new LimitPtx(`token count exceeds ${MAX_TOKENS}`);
  }
  return out;
}

function joined(tokens: Token[]): string { return tokens.map(t => t.text).join(' '); }
function operandsOf(tokens: Token[]): string[] {
  const parts: string[] = [];
  let start = 0;
  const stack: string[] = [];
  const pair: Record<string, string> = { ']': '[', '}': '{', ')': '(' };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!.text;
    if ('[{('.includes(t)) stack.push(t);
    else if (Object.hasOwn(pair, t)) { if (stack.pop() !== pair[t]) throw new InvalidPtx('unbalanced operand delimiters'); }
    else if (t === ',' && stack.length === 0) {
      if (i === start) throw new InvalidPtx('empty operand');
      parts.push(joined(tokens.slice(start, i))); start = i + 1;
    }
  }
  if (stack.length) throw new InvalidPtx('unclosed operand delimiter');
  if (start < tokens.length) parts.push(joined(tokens.slice(start)));
  else if (tokens.length) throw new InvalidPtx('trailing operand comma');
  return parts;
}

/** Deliberately small exact opcode set; unknown modifiers never inherit support. */
const opcodeArity = new Map<string, number>([
  ['ret', 0], ['exit', 0], ['bra', 1], ['bra.uni', 1],
  ...['u32', 'u64', 's32', 's64', 'b32', 'b64', 'f32', 'f64'].flatMap(t => [
    [`mov.${t}`, 2], [`ld.param.${t}`, 2], [`ld.global.${t}`, 2], [`st.global.${t}`, 2],
  ] as [string, number][]),
  ...['u32', 'u64', 's32', 's64'].flatMap(t => [
    [`add.${t}`, 3], [`sub.${t}`, 3], [`mul.lo.${t}`, 3], [`mad.lo.${t}`, 4],
    ...['eq', 'ne', 'lt', 'le', 'gt', 'ge'].map(c => [`setp.${c}.${t}`, 3] as [string, number]),
  ] as [string, number][]),
  ['mul.wide.s32', 3], ['mul.wide.u32', 3],
  ['cvta.to.global.u64', 2], ['cvta.to.global.u32', 2],
  ...['f32', 'f64'].flatMap(t => [
    [`add.${t}`, 3], [`sub.${t}`, 3], [`mul.${t}`, 3],
    ...['rn', 'rz', 'rm', 'rp'].flatMap(r => [
      [`fma.${r}.${t}`, 4], [`add.${r}.${t}`, 3], [`sub.${r}.${t}`, 3], [`mul.${r}.${t}`, 3],
    ] as [string, number][]),
  ] as [string, number][]),
]);

function support(ins: PtxInstruction): boolean {
  const arity = opcodeArity.get(ins.opcode);
  if (arity === undefined || ins.operands.length !== arity) return false;
  if (ins.opcode.startsWith('bra')) return labelName.test(ins.operands[0]!);
  if (arity === 0) return true;
  const memory = /^\[ [A-Za-z_$%][A-Za-z0-9_$%.]*(?: [+-] (?:[0-9]+|0[xX][0-9a-fA-F]+))? \]$/;
  if (ins.opcode.startsWith('st.')) return memory.test(ins.operands[0]!) && simpleOperand(ins.operands[1]!);
  if (!/^%[A-Za-z][A-Za-z0-9_]*$/.test(ins.operands[0]!)) return false;
  if (ins.opcode.startsWith('ld.')) return memory.test(ins.operands[1]!);
  return ins.operands.slice(1).every(simpleOperand);
}
function simpleOperand(s: string): boolean {
  return /^%[A-Za-z][A-Za-z0-9_.]*$/.test(s) || /^-? ?(?:[0-9]+|0[xX][0-9a-fA-F]+|0[fFdD][0-9a-fA-F]+)(?:\.[0-9]+)?$/.test(s);
}

function buildBlocks(fn: PtxFunction): void {
  const count = fn.instructions.length;
  const leaders = new Set<number>([0]);
  for (const at of Object.values(fn.labels)) leaders.add(at);
  for (const ins of fn.instructions) {
    if (ins.opcode === 'bra' || ins.opcode === 'bra.uni') {
      const dest = ins.operands[0];
      if (dest === undefined || !Object.hasOwn(fn.labels, dest)) throw new InvalidPtx(`unresolved branch target at line ${ins.line}`);
      leaders.add(fn.labels[dest]!);
      if (ins.index + 1 < count) leaders.add(ins.index + 1);
    } else if (ins.opcode === 'ret' || ins.opcode === 'exit') {
      if (ins.index + 1 < count) leaders.add(ins.index + 1);
    }
  }
  const starts = [...leaders].filter(i => i < count).sort((a, b) => a - b);
  if (starts.length > MAX_BLOCKS) throw new LimitPtx(`block count exceeds ${MAX_BLOCKS}`);
  const idAt = new Map(starts.map(i => [i, `b${i}`]));
  const labelsAt = new Map<number, string[]>();
  for (const [label, at] of Object.entries(fn.labels)) {
    const labels = labelsAt.get(at);
    if (labels) labels.push(label); else labelsAt.set(at, [label]);
  }
  fn.blocks = starts.map((start, n) => {
    const end = starts[n + 1] ?? count;
    const tail = fn.instructions[end - 1]!;
    const successors: string[] = [];
    const branch = tail.opcode === 'bra' || tail.opcode === 'bra.uni';
    if (branch) {
      const at = fn.labels[tail.operands[0]!]!;
      if (at === count) throw new InvalidPtx(`branch target has no instruction at line ${tail.line}`);
      successors.push(idAt.get(at)!);
    }
    const terminator = branch || tail.opcode === 'ret' || tail.opcode === 'exit';
    if ((!terminator || tail.predicate !== null) && end < count) successors.push(idAt.get(end)!);
    return { id: `b${start}`, labels: labelsAt.get(start) ?? [], start, end, successors: [...new Set(successors)] };
  });
}

/** Escape identifiers in comments and operands without inventing source-level names. */
function renderOperand(value: string): string {
  return value.replace(/%[A-Za-z][A-Za-z0-9_.]*/g, s => `registers[${JSON.stringify(s)}]`);
}
function render(fn: PtxFunction): string {
  const returns = fn.returnParams.length ? ` -> (${fn.returnParams.join(', ')})` : '';
  const out = ['// C-like pseudocode; PTX intrinsics preserve exact opcode modifiers.', '// Not compilable CUDA; complete syntax coverage is not an equivalence proof.', `${fn.kind} ${fn.name}(${fn.params.join(', ')})${returns} {`];
  const labelsAt = new Map<number, string[]>();
  for (const [name, at] of Object.entries(fn.labels)) {
    const labels = labelsAt.get(at);
    if (labels) labels.push(name); else labelsAt.set(at, [name]);
  }
  for (const ins of fn.instructions) {
    for (const label of labelsAt.get(ins.index) ?? []) out.push(`${label}:`);
    let expr: string;
    const op = `ptx_${ins.opcode.replaceAll('.', '_')}`;
    const args = ins.operands.map(renderOperand);
    if (!ins.supported) expr = `unsupported_ptx(${JSON.stringify(ins.opcode)}, ${JSON.stringify(ins.operands)});`;
    else if (ins.opcode === 'ret' || ins.opcode === 'exit') expr = `${op}();`;
    else if (ins.opcode === 'bra' || ins.opcode === 'bra.uni') expr = `goto ${ins.operands[0]};`;
    else if (ins.opcode.startsWith('st.')) expr = `${op}(${args.join(', ')});`;
    else expr = `${args[0]} = ${op}(${args.slice(1).join(', ')});`;
    if (ins.predicate !== null) expr = `if (${renderOperand(ins.predicate)}) { ${expr} }`;
    out.push(`  ${expr} // PTX line ${ins.line}`);
  }
  out.push('}');
  return out.join('\n');
}

class Parser {
  at = 0;
  instructionCount = 0;
  blockCount = 0;
  labelCount = 0;
  readonly tokens: Token[];
  readonly result: PtxDecompilation;
  constructor(tokens: Token[], result: PtxDecompilation) { this.tokens = tokens; this.result = result; }
  peek(): string | undefined { return this.tokens[this.at]?.text; }
  take(): Token { const t = this.tokens[this.at++]; if (!t) throw new InvalidPtx('unexpected end of input'); return t; }
  expect(s: string): void { if (this.take().text !== s) throw new InvalidPtx(`expected ${s}`); }
  /** Debug metadata has a grammar, not a line boundary. Never swallow code. */
  debugInteger(): void {
    const token = this.take();
    if (!/^(0|[1-9][0-9]*)$/.test(token.text) || BigInt(token.text) > 0xffffffffffffffffn) {
      throw new InvalidPtx(`unsupported debug integer at line ${token.line}`);
    }
  }
  fileDirective(): void {
    this.debugInteger();
    const filename = this.take();
    if (!/^"(?:[^"\\]|\\.)*"$/.test(filename.text)) throw new InvalidPtx(`expected debug filename at line ${filename.line}`);
    if (this.peek() === ',') {
      this.take(); this.debugInteger(); this.expect(','); this.debugInteger();
    }
  }
  locationDirective(): void {
    this.debugInteger(); this.debugInteger(); this.debugInteger();
    if (this.peek() === ',') throw new InvalidPtx('extended .loc attributes are not supported');
  }
  group(): Token[] {
    this.expect('(');
    const start = this.at;
    let depth = 1;
    while (this.at < this.tokens.length) {
      const t = this.take().text;
      if (t === '(') depth++;
      if (t === ')') { depth--; if (depth === 0) return this.tokens.slice(start, this.at - 1); }
      if (depth > 16) throw new LimitPtx('signature nesting limit');
    }
    throw new InvalidPtx('unclosed parameter list');
  }
  parse(): void {
    while (this.at < this.tokens.length) {
      const t = this.take();
      if (t.text === '.version') {
        if (this.result.ptxVersion !== null) throw new InvalidPtx('duplicate .version');
        this.result.ptxVersion = this.take().text; continue;
      }
      if (t.text === '.target') {
        if (this.result.target !== null) throw new InvalidPtx('duplicate .target');
        const values: string[] = [this.take().text];
        while (this.peek() === ',') { values.push(this.take().text, this.take().text); }
        this.result.target = values.join(' ');
        if (!/^sm_[0-9]+[a-z]?(?: , [A-Za-z_][A-Za-z0-9_]*)*$/.test(this.result.target)) throw new InvalidPtx('unsupported .target syntax');
        continue;
      }
      if (t.text === '.address_size') {
        if (this.result.addressSize !== null) throw new InvalidPtx('duplicate .address_size');
        this.result.addressSize = Number(this.take().text); continue;
      }
      if (['.visible', '.weak', '.extern'].includes(t.text)) continue;
      if (t.text === '.entry' || t.text === '.func') { this.function(t.text === '.entry' ? 'entry' : 'func'); continue; }
      if (t.text === '.file') { this.fileDirective(); continue; }
      throw new InvalidPtx(`unsupported module syntax ${JSON.stringify(t.text)} at line ${t.line}`);
    }
  }
  function(kind: PtxFunction['kind']): void {
    if (this.result.functions.length >= MAX_FUNCTIONS) throw new LimitPtx(`function count exceeds ${MAX_FUNCTIONS}`);
    const returns = this.peek() === '(' ? this.group() : [];
    const name = this.take();
    if (!identifier.test(name.text) || name.text.startsWith('%')) throw new InvalidPtx(`invalid function name at line ${name.line}`);
    if (this.result.functions.some(f => f.name === name.text)) throw new InvalidPtx(`duplicate function ${name.text}`);
    const signature = this.group();
    const fn: PtxFunction = { name: name.text, kind, params: operandsOf(signature), returnParams: operandsOf(returns), registers: [], instructions: [], blocks: [], labels: Object.create(null), pseudocode: '', unsupported: [] };
    const param = /^\.param (?:\.align [1-9][0-9]* )?\.(?:[busf](?:8|16|32|64)) [A-Za-z_$][A-Za-z0-9_$]*(?: \[ [1-9][0-9]* \])?$/;
    if ([...fn.params, ...fn.returnParams].some(p => !param.test(p))) throw new InvalidPtx(`unsupported parameter declaration at line ${name.line}`);
    if (kind === 'entry' && returns.length) throw new InvalidPtx('entry functions cannot have return parameters');
    if (returns.length) fn.unsupported.push({ line: name.line, opcode: '.func return', reason: 'return parameters are preserved but not lifted' });
    if (this.peek() === ';') { this.take(); fn.unsupported.push({ line: name.line, opcode: 'declaration', reason: 'function has no body' }); this.result.functions.push(fn); return; }
    this.expect('{');
    while (this.peek() !== '}') {
      const t = this.take();
      if (this.peek() === ':') {
        this.take();
        if (!labelName.test(t.text) || Object.hasOwn(fn.labels, t.text)) throw new InvalidPtx(`invalid or duplicate label at line ${t.line}`);
        if (++this.labelCount > MAX_LABELS) throw new LimitPtx(`label count exceeds ${MAX_LABELS}`);
        fn.labels[t.text] = fn.instructions.length;
        continue;
      }
      if (t.text === '.loc') { this.locationDirective(); continue; }
      if (t.text === '.reg') {
        const decl: Token[] = [];
        while (this.peek() !== ';') { const d = this.take(); if (d.text === '}') throw new InvalidPtx('unterminated register declaration'); decl.push(d); }
        this.take();
        const value = joined(decl);
        if (!/^\.(?:pred|[busf](?:8|16|32|64)) %[A-Za-z][A-Za-z0-9_]*(?: < [1-9][0-9]* >)?(?: , %[A-Za-z][A-Za-z0-9_]*(?: < [1-9][0-9]* >)?)*$/.test(value)) throw new InvalidPtx(`unsupported register declaration at line ${t.line}`);
        fn.registers.push(value); continue;
      }
      if (t.text === '{') throw new InvalidPtx(`nested PTX scopes are unsupported at line ${t.line}`);
      let predicate: string | null = null;
      let opcode = t;
      if (t.text === '@') {
        const negated = this.peek() === '!'; if (negated) this.take();
        const pred = this.take();
        if (!/^%[A-Za-z][A-Za-z0-9_]*$/.test(pred.text)) throw new InvalidPtx(`invalid predicate at line ${pred.line}`);
        predicate = `${negated ? '!' : ''}${pred.text}`; opcode = this.take();
      }
      if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(opcode.text)) throw new InvalidPtx(`invalid opcode at line ${opcode.line}`);
      const operands: Token[] = [];
      let vectorDepth = 0;
      while (this.peek() !== ';') {
        const o = this.take();
        if (o.text === '{') vectorDepth++;
        if (o.text === '}' && vectorDepth-- <= 0) throw new InvalidPtx(`missing instruction semicolon at line ${opcode.line}`);
        operands.push(o);
      }
      this.take();
      if (++this.instructionCount > MAX_INSTRUCTIONS) throw new LimitPtx(`instruction count exceeds ${MAX_INSTRUCTIONS}`);
      const ins: PtxInstruction = { index: fn.instructions.length, line: opcode.line, opcode: opcode.text, operands: operandsOf(operands), predicate, supported: false };
      ins.supported = support(ins);
      fn.instructions.push(ins);
      if (!ins.supported) fn.unsupported.push({ line: ins.line, opcode: ins.opcode, reason: 'opcode, operand form or arity is outside the supported subset' });
    }
    this.take();
    if (!fn.instructions.length) throw new InvalidPtx(`empty body for ${fn.name}`);
    buildBlocks(fn);
    this.blockCount += fn.blocks.length;
    if (this.blockCount > MAX_BLOCKS) throw new LimitPtx(`total block count exceeds ${MAX_BLOCKS}`);
    fn.pseudocode = render(fn);
    this.result.functions.push(fn);
  }
}

export function decompilePtx(text: string): PtxDecompilation {
  const result: PtxDecompilation = {
    schemaVersion: 1, sourceSha256: createHash('sha256').update(text).digest('hex'), language: 'ptx',
    ptxVersion: null, target: null, addressSize: null, status: 'invalid', truncated: false,
    functions: [], warnings: [], totalInstructionCount: 0, supportedInstructionCount: 0,
  };
  try {
    if (Buffer.byteLength(text, 'utf8') > MAX_PTX_DECOMPILE_BYTES) throw new LimitPtx(`input exceeds ${MAX_PTX_DECOMPILE_BYTES} bytes`);
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) throw new InvalidPtx('only printable ASCII PTX and tab/newline are supported');
    new Parser(tokenize(text), result).parse();
    if (!/^\d+\.\d+$/.test(result.ptxVersion ?? '') || !result.target || ![32, 64].includes(result.addressSize ?? 0)) throw new InvalidPtx('missing or invalid PTX version, target or address size');
    if (!result.functions.length) throw new InvalidPtx('no PTX functions found');
    result.status = result.functions.some(f => f.unsupported.length) ? 'partial' : 'complete';
    if (result.status === 'partial') result.warnings.push('Unsupported constructs are preserved but not lifted; CFG models supported control flow only and may be incomplete.');
  } catch (err) {
    result.status = 'invalid';
    result.truncated = err instanceof LimitPtx;
    result.warnings.push(err instanceof Error ? err.message : 'PTX parsing failed');
  }
  result.totalInstructionCount = result.functions.reduce((n, f) => n + f.instructions.length, 0);
  result.supportedInstructionCount = result.functions.reduce((n, f) => n + f.instructions.filter(i => i.supported).length, 0);
  return result;
}
