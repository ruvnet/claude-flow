import { createHash } from "node:crypto";
const MAX_SASS_RECOVERY_BYTES = 256 * 1024;
const MAX_SASS_RECOVERY_INSTRUCTIONS = 4096;
const MAX_SASS_RECOVERY_CODE_BYTES = 512 * 1024;
class Invalid extends Error {
}
class Unsupported extends Error {
}
const invalid = (message) => {
  throw new Invalid(message);
};
const unsupported = (message) => {
  throw new Unsupported(message);
};
const sha = (text) => createHash("sha256").update(text).digest("hex");
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const hexNumber = (value) => {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) return invalid("expected a hexadecimal integer");
  const n = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(n)) return invalid("integer metadata exceeds safe range");
  return n;
};
function readSass(text) {
  const lines = text.split(/\r?\n/);
  let sm, name, format, target = false, header = false, ended = false;
  const instructions = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const architecture = /^code for sm_(\d+)$/.exec(line);
    if (architecture) {
      if (sm !== void 0 || name || header || instructions.length) invalid("expected exactly one ordered SASS architecture");
      if (!["86", "89"].includes(architecture[1])) unsupported("only SM86/SM89 text is supported");
      sm = Number(architecture[1]);
      continue;
    }
    const targetLine = /^\.target\s+sm_(86|89)$/.exec(line);
    if (targetLine) {
      if (!sm || Number(targetLine[1]) !== sm || target || name || header) invalid("invalid or conflicting .target");
      target = true;
      continue;
    }
    const fn = /^Function\s*:\s*(\S+)$/.exec(line);
    if (fn) {
      if (!sm || name || header || instructions.length || !identifier.test(fn[1])) invalid("expected exactly one valid kernel name");
      name = fn[1];
      continue;
    }
    const flags = /^\.headerflags\s+@"(EF_CUDA_TEXMODE_UNIFIED EF_CUDA_64BIT_ADDRESS )?EF_CUDA_SM(86|89) EF_CUDA_VIRTUAL_SM\(EF_CUDA_SM[0-9]+\)"$/.exec(line);
    if (flags) {
      if (!name || header || Number(flags[2]) !== sm || instructions.length) invalid("SASS header architecture mismatch");
      format = flags[1] ? 12 : 13;
      if (target !== (format === 13)) invalid("SASS export format and target directive disagree");
      header = true;
      continue;
    }
    if (/^\.{10}$/.test(line)) {
      if (!instructions.length || ended) invalid("unexpected SASS terminator");
      ended = true;
      continue;
    }
    if (!sm || !name || !header || ended) invalid("unexpected SASS content");
    const ins = /^\/\*([0-9a-fA-F]{4,8})\*\/\s*(?:@(!?(?:P[0-6]|PT))\s+)?([A-Z][A-Z0-9_.]*)\s*(.*?)\s*;\s*\/\*\s*0x([0-9a-fA-F]{16})\s*\*\/$/.exec(line);
    if (!ins) invalid("unrecognized instruction text; no lines are discarded");
    const high = /^\s*\/\*\s*0x([0-9a-fA-F]{16})\s*\*\/\s*$/.exec(lines[++i] ?? "");
    if (!high) invalid("missing instruction encoding continuation");
    const offset = Number.parseInt(ins[1], 16);
    if (offset !== instructions.length * 16) invalid("instruction offsets must start at zero and be contiguous");
    if (instructions.length >= MAX_SASS_RECOVERY_INSTRUCTIONS) unsupported("instruction limit exceeded");
    const lo = ins[5].toLowerCase(), hi = high[1].toLowerCase();
    instructions.push({
      offset,
      opcode: ins[3],
      predicate: ins[2] ?? null,
      args: ins[4].trim() ? ins[4].split(",").map((a) => a.trim()) : [],
      words: [lo.slice(8), lo.slice(0, 8), hi.slice(8), hi.slice(0, 8)]
    });
  }
  if (!sm || !name || !header || !ended || !instructions.length) invalid("incomplete SASS export");
  return { sm, name, format, instructions };
}
function section(text, name) {
  const lines = text.split(/\r?\n/), positions = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].trim() === name) positions.push(i);
  if (positions.length !== 1) invalid(`expected one ${name} section`);
  let end = positions[0] + 1;
  while (end < lines.length && !/^\.(?:nv\.|text\.|section\b)/.test(lines[end])) end++;
  return lines.slice(positions[0] + 1, end).join("\n");
}
function attributes(text) {
  const result = [];
  const records = text.split(/^\s*<0x[0-9a-fA-F]+>\s*$/m);
  if (records.shift().trim()) invalid("malformed attribute records");
  for (const record of records) {
    const match = /^\s*Attribute:\s*(EIATTR_[A-Z0-9_]+)\s+Format:\s*(EIFMT_[A-Z]+)\s*(?:Value:\s*([\s\S]*))?$/.exec(record);
    if (!match) invalid("malformed ELF attribute");
    result.push({ name: match[1], format: match[2], value: (match[3] ?? "").trim() });
  }
  return result;
}
function only(attrs, name, format) {
  const found = attrs.filter((a) => a.name === name);
  if (found.length !== 1 || found[0].format !== format) invalid(`expected exactly one ${name}/${format}`);
  return found[0].value;
}
function readElf(text, sass) {
  const headers = text.split(/\r?\n/).filter((line) => /^64(?:bit elf|-bit ELF):/.test(line));
  const old = /^64bit elf: type=2, abi=7, sm=(86|89), toolkit=128, flags = 0x[0-9a-fA-F]+\s*$/.exec(headers[0] ?? "");
  const modern = /^64-bit ELF: type=ET_EXEC, ABI=8, sm=(86|89), toolkit=13\.0, flags=0x[0-9a-fA-F]+\s*$/.exec(headers[0] ?? "");
  const architecture = old?.[1] ?? modern?.[1];
  if (headers.length !== 1 || !architecture || Number(architecture) !== sass.sm || sass.format !== (old ? 12 : 13)) invalid("ELF architecture/type/ABI/toolkit does not match supported SASS export format");
  for (const match of text.matchAll(/^\.(?:section\s+)?(\.?(?:rel|rela)\.[^\s]+).*$/gm)) {
    if (match[1].replace(/^\./, "") !== "rel.debug_frame") unsupported("code or constant-bank relocation section is outside recovery scope");
  }
  const names = [...text.matchAll(/^\.text\.([^\s]+)\s*$/gm)].map((m) => m[1]);
  if (names.length !== 1 || names[0] !== sass.name) invalid("ELF must contain exactly the matching kernel text section");
  const globals = attributes(section(text, ".nv.info"));
  if (globals.some((a) => !["EIATTR_REGCOUNT", "EIATTR_FRAME_SIZE", "EIATTR_MIN_STACK_SIZE"].includes(a.name))) unsupported("unsupported global ELF attributes");
  const globalValue = (name, label) => {
    const value = only(globals, name, "EIFMT_SVAL");
    const match = /^function:\s*([A-Za-z_$][A-Za-z0-9_$]*)\(0x[0-9a-fA-F]+\)\s+([a-z ]+):\s*(0x[0-9a-fA-F]+|[0-9]+)$/.exec(value);
    if (!match || match[1] !== sass.name || match[2] !== label) invalid(`invalid ${name} binding`);
    return Number(match[3]);
  };
  const registers = globalValue("EIATTR_REGCOUNT", "register count");
  if (!Number.isSafeInteger(registers) || registers < 1 || registers > 255) invalid("invalid register count");
  if (globalValue("EIATTR_FRAME_SIZE", "frame size") !== 0 || globalValue("EIATTR_MIN_STACK_SIZE", "min stack size") !== 0) unsupported("stack/local-memory kernels are outside scope");
  const attrs = attributes(section(text, `.nv.info.${sass.name}`));
  const allowed = ["EIATTR_CUDA_API_VERSION", "EIATTR_SW2861232_WAR", "EIATTR_PARAM_CBANK", "EIATTR_CBANK_PARAM_SIZE", "EIATTR_KPARAM_INFO", "EIATTR_MAXREG_COUNT", "EIATTR_EXIT_INSTR_OFFSETS", ...sass.format === 13 ? ["EIATTR_MERCURY_ISA_VERSION"] : []];
  if (attrs.some((a) => !allowed.includes(a.name))) unsupported("unsupported kernel ELF attributes");
  if (only(attrs, "EIATTR_CUDA_API_VERSION", "EIFMT_SVAL") !== (sass.format === 12 ? "0x80" : "0x82")) unsupported("unsupported CUDA API metadata version");
  if (sass.format === 13 && only(attrs, "EIATTR_MERCURY_ISA_VERSION", "EIFMT_HVAL") !== "0.0") unsupported("unsupported Mercury ISA version");
  const bank = /^(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)$/.exec(only(attrs, "EIATTR_PARAM_CBANK", "EIFMT_SVAL"));
  if (!bank) invalid("invalid PARAM_CBANK");
  const packed = hexNumber(bank[2]);
  if (packed > 4294967295) invalid("PARAM_CBANK exceeds 32 bits");
  const base = packed & 65535, byteCount = packed >>> 16;
  if (base !== 352 || byteCount < 4 || byteCount > 256) unsupported("only canonical SM86/89 scalar parameter bank is supported");
  if (hexNumber(only(attrs, "EIATTR_CBANK_PARAM_SIZE", "EIFMT_HVAL")) !== byteCount) invalid("parameter bank size mismatch");
  const symbol = bank[1].toLowerCase();
  const symbolLines = section(text, ".section .symtab").split(/\r?\n/).filter((line) => line.trim().startsWith(`${symbol} `));
  const symbolFields = symbolLines[0]?.trim().split(/\s+/);
  if (symbolLines.length !== 1 || symbolFields?.length !== 7 || symbolFields[6] !== `.nv.constant0.${sass.name}`) invalid("PARAM_CBANK symbol does not identify matching constant bank");
  if (symbolFields[1] !== "0" || symbolFields[2] !== "0" || symbolFields[3] !== "0x3" || symbolFields[4] !== "0") invalid("PARAM_CBANK must reference a zero-valued local section symbol");
  const table = text.split(/Sections:\r?\n/);
  if (table.length !== 2) invalid("expected one ELF sections table");
  const rows = table[1].split(/^\.section\b/m)[0].split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((row) => row.length === 10 && /^[0-9a-fA-F]+$/.test(row[0]));
  for (const row of rows) {
    for (const column of [0, 1, 2, 3, 4, 6, 7, 8]) {
      if (!/^[0-9a-fA-F]+$/.test(row[column]) || !Number.isSafeInteger(Number.parseInt(row[column], 16))) invalid("invalid section numeric field");
    }
    if (row[5] === "REL" || row[5] === "RELA" || /^\.rela?\./.test(row[9])) {
      const target = rows.find((candidate) => Number.parseInt(candidate[0], 16) === Number.parseInt(row[8], 16));
      if (row[5] !== "REL" || row[9] !== ".rel.debug_frame" || target?.[9] !== ".debug_frame") unsupported("code or constant-bank relocation is outside recovery scope");
    }
  }
  if (new Set(rows.map((row) => Number.parseInt(row[0], 16))).size !== rows.length || new Set(rows.map((row) => row[9])).size !== rows.length) invalid("duplicate section identity");
  if (section(text, ".nv.rel.action").trim().replace(/\r\n/g, "\n") !== "Header : Base Relocation : R_CUDA_CONST_FIELD22_37\nReloc type : Symbol Kind,Addend Shift,Source Position1,length1,Destination Position1,Source Position2,length2,Destination Position2\nR_CUDA_CONST_FIELD22_37 : EIVALUE_SYM_KIND_ADDR,0,0,17,37,0,5,54") unsupported("unrecognized CUDA relocation action");
  const constantRows = rows.filter((row) => row[9] === `.nv.constant0.${sass.name}`), textRows = rows.filter((row) => row[9] === `.text.${sass.name}`);
  if (constantRows.length !== 1 || textRows.length !== 1) invalid("missing or ambiguous constant/text section table entries");
  if (constantRows[0][5] !== "PROGBITS" || textRows[0][5] !== "PROGBITS") invalid("constant/text sections must be PROGBITS");
  const constantSize = Number.parseInt(constantRows[0][2], 16);
  if (Number.parseInt(constantRows[0][0], 16) !== hexNumber(symbolFields[5]) || constantSize < base + byteCount) invalid("constant bank section binding or extent mismatch");
  const constantWords = section(text, `.nv.constant0.${sass.name}`).trim().split(/\s+/);
  if (constantWords.some((word) => !/^0x[0-9a-fA-F]{8}$/.test(word)) || constantWords.length * 4 !== constantSize) invalid("constant bank dump extent differs from section size");
  const parameters = [];
  for (const attr of attrs.filter((a) => a.name === "EIATTR_KPARAM_INFO")) {
    const match = /^Index\s*:\s*(0x[0-9a-fA-F]+)\s+Ordinal\s*:\s*(0x[0-9a-fA-F]+)\s+Offset\s*:\s*(0x[0-9a-fA-F]+)\s+Size\s*:\s*(0x[0-9a-fA-F]+)\s+Pointee's logAlignment\s*:\s*0x0\s+Space\s*:\s*0x0\s+cbank\s*:\s*0x1f\s+Parameter Space\s*:\s*CBANK$/.exec(attr.value);
    if (attr.format !== "EIFMT_SVAL" || !match || hexNumber(match[1]) !== 0) invalid("unsupported KPARAM_INFO");
    const ordinal = hexNumber(match[2]), offset = hexNumber(match[3]), size = hexNumber(match[4]);
    if (ordinal > 31 || ![4, 8].includes(size)) unsupported("only at most 32 scalar uint32/uint64 parameters are supported");
    parameters.push({ ordinal, offset, size, type: size === 4 ? "uint32_t" : "uint64_t", emittedName: `rure_arg_${ordinal}` });
  }
  parameters.sort((a, b) => a.ordinal - b.ordinal);
  let end = 0;
  for (let i = 0; i < parameters.length; i++) {
    const p = parameters[i];
    const expected = Math.ceil(end / p.size) * p.size;
    if (p.ordinal !== i || p.offset !== expected) invalid("parameter ordinals/offsets do not match natural CUDA scalar ABI");
    end = p.offset + p.size;
  }
  if (!parameters.length || end !== byteCount) invalid("parameter extent differs from bank size");
  const body = section(text, `.text.${sass.name}`).trim().split(/\r?\n/);
  const resource = body.shift().trim();
  const layout = /^bar = 0\s+reg = ([0-9]+)\s+lmem=0\s+smem=0$/.exec(resource);
  if (sass.format === 12 ? !layout || Number(layout[1]) !== registers : !/^lmem=0\s+smem=0$/.test(resource)) invalid("ELF text resource metadata mismatch");
  const words = body.filter((line) => line.trim()).map((line) => {
    if (!/^\s*(?:0x[0-9a-fA-F]{8}\s+){3}0x[0-9a-fA-F]{8}\s*$/.test(line)) invalid("invalid text encoding row");
    return line.trim().split(/\s+/).map((word) => word.slice(2).toLowerCase());
  });
  if (words.length !== sass.instructions.length || words.length * 16 !== Number.parseInt(textRows[0][2], 16) || words.some((row, i) => row.join("") !== sass.instructions[i].words.join(""))) invalid("SASS encoding comments and ELF text words/extents differ");
  const exits = only(attrs, "EIATTR_EXIT_INSTR_OFFSETS", "EIFMT_SVAL").split(/\s+/).map(hexNumber);
  const actualExits = sass.instructions.filter((i) => i.opcode === "EXIT").map((i) => i.offset);
  if (exits.length !== actualExits.length || exits.some((n, i) => n !== actualExits[i])) invalid("ELF EXIT offsets differ from SASS");
  return { parameters, base, registers };
}
const descriptorBit = 1n << 263n;
class Emitter {
  constructor(sass, abi) {
    this.sass = sass;
    this.abi = abi;
  }
  sass;
  abi;
  reads = 0n;
  defines = 0n;
  kills = 0n;
  elisions = [];
  reg(value, write = false) {
    if (value === "RZ") {
      if (write) return unsupported("discard register destinations are unsupported");
      return "0U";
    }
    const match = /^R([0-9]+)(\.reuse)?$/.exec(value);
    if (!match || write && match[2]) return unsupported(`unsupported register ${value}`);
    const n = Number(match[1]);
    if (n >= this.abi.registers || n >= 255) return invalid(`register ${value} exceeds declared range`);
    if (write) this.defines |= 1n << BigInt(n);
    else this.reads |= 1n << BigInt(n);
    return `rure_r${n}`;
  }
  pair(value, write = false) {
    if (value === "RZ" && !write) return ["0U", "0U"];
    const match = /^R([0-9]+)$/.exec(value);
    if (!match || Number(match[1]) % 2 || Number(match[1]) >= 254) return unsupported("64-bit pairs must start at an even general-purpose register below R254");
    const n = Number(match[1]);
    return [this.reg(`R${n}`, write), this.reg(`R${n + 1}`, write)];
  }
  predicate(value, write = false) {
    const negated = value.startsWith("!");
    if (negated && write) return unsupported("negated predicate destination");
    const name = negated ? value.slice(1) : value;
    if (name === "PT") {
      if (write) return unsupported("discard predicate destination");
      return negated ? "false" : "true";
    }
    const match = /^P([0-6])$/.exec(name);
    if (!match) return unsupported("unsupported predicate");
    const n = Number(match[1]);
    if (write) this.defines |= 1n << BigInt(256 + n);
    else this.reads |= 1n << BigInt(256 + n);
    return `${negated ? "!" : ""}rure_p${n}`;
  }
  value(arg, width) {
    if (/^R/.test(arg)) {
      if (width === 32) return this.reg(arg);
      const [lo, hi] = this.pair(arg);
      return `rure_sass_detail::join(${lo}, ${hi})`;
    }
    const bank = /^c\[0x0\]\[(0x[0-9a-fA-F]+)\]$/.exec(arg);
    if (bank) {
      const offset = hexNumber(bank[1]);
      if (offset === 0 && width === 32) return "static_cast<uint32_t>(blockDim.x)";
      const p = this.abi.parameters.find((p2) => offset >= this.abi.base + p2.offset && offset + width / 8 <= this.abi.base + p2.offset + p2.size);
      if (!p || (offset - this.abi.base - p.offset) % 4 || width === 64 && (p.size !== 8 || offset !== this.abi.base + p.offset)) return unsupported("constant read is outside a complete parameter word or supported launch field");
      if (width === 64) return p.emittedName;
      return `static_cast<uint32_t>(${p.emittedName}${offset === this.abi.base + p.offset ? "" : " >> 32"})`;
    }
    if (width === 64) return unsupported("64-bit immediate extension semantics are outside the validated subset");
    if (!/^-?0x[0-9a-fA-F]+$/.test(arg)) return unsupported(`unsupported value ${arg}`);
    const value = arg.startsWith("-") ? -BigInt(arg.slice(1)) : BigInt(arg);
    const mask = (1n << BigInt(width)) - 1n;
    if (value < -(1n << BigInt(width - 1)) || value > mask) return unsupported("integer immediate exceeds operation width");
    return `static_cast<uint${width}_t>(0x${(value & mask).toString(16)}ULL)`;
  }
  address(arg) {
    const match = /^\[(R[0-9]+)\.64(?:\s*([+-])\s*(0x[0-9a-fA-F]+))?\]$/.exec(arg);
    if (!match) return unsupported("only validated hidden-descriptor 64-bit global address syntax is supported");
    this.reads |= descriptorBit;
    const value = this.value(match[1], 64);
    if (!match[2]) return value;
    const offset = hexNumber(match[3]);
    if (offset > 2147483647) return unsupported("global address offset exceeds conservative bound");
    return `(${value} ${match[2]} 0x${offset.toString(16)}ULL)`;
  }
  writePair(dst, expression, index) {
    const [lo, hi] = this.pair(dst, true);
    return `{ const uint64_t rure_tmp_${index} = ${expression}; ${lo} = static_cast<uint32_t>(rure_tmp_${index}); ${hi} = static_cast<uint32_t>(rure_tmp_${index} >> 32); }`;
  }
  lower(ins, index) {
    this.reads = 0n;
    this.defines = 0n;
    this.kills = 0n;
    const a = ins.args, op = ins.opcode;
    let code;
    let successors = index + 1 < this.sass.instructions.length ? [index + 1] : [];
    const arity = (n) => {
      if (a.length !== n) invalid(`invalid ${op} operand count`);
    };
    switch (op) {
      case "MOV":
        arity(2);
        if (a[0] === "R1" && a[1] === "c[0x0][0x28]" && ins.predicate === null) {
          this.kills |= 1n << 1n;
          code = ";";
          this.elisions.push({ offset: ins.offset, reason: "Dead stack setup; dataflow must prove no use before replacement, including pair reads." });
        } else code = `${this.reg(a[0], true)} = ${this.value(a[1], 32)};`;
        break;
      case "S2R": {
        arity(2);
        const sr = /^SR_(TID|CTAID)\.([XYZ])$/.exec(a[1]);
        if (!sr) unsupported("unsupported special register");
        code = `${this.reg(a[0], true)} = static_cast<uint32_t>(${sr[1] === "TID" ? "threadIdx" : "blockIdx"}.${sr[2].toLowerCase()});`;
        break;
      }
      case "ULDC.64":
        arity(2);
        if (a[0] !== "UR4" || a[1] !== "c[0x0][0x118]" || ins.predicate !== null) unsupported("only unconditional canonical global descriptor setup is supported");
        this.defines |= descriptorBit;
        code = ";";
        this.elisions.push({ offset: ins.offset, reason: "Canonical CUDA runtime global descriptor setup handled by CUDA C++; descriptor contents are not synthesized." });
        break;
      case "IMAD":
        arity(4);
        code = `${this.reg(a[0], true)} = static_cast<uint32_t>(static_cast<uint64_t>(${this.value(a[1], 32)}) * static_cast<uint64_t>(${this.value(a[2], 32)}) + static_cast<uint64_t>(${this.value(a[3], 32)}));`;
        break;
      case "IMAD.WIDE":
      case "IMAD.WIDE.U32": {
        arity(4);
        const left = this.value(a[1], 32), right = this.value(a[2], 32), addend = this.value(a[3], 64);
        const product = op.endsWith(".U32") ? `static_cast<uint64_t>(${left}) * static_cast<uint64_t>(${right})` : `static_cast<uint64_t>(rure_sass_detail::signed32(${left}) * rure_sass_detail::signed32(${right}))`;
        code = this.writePair(a[0], `(${product}) + ${addend}`, index);
        break;
      }
      case "IADD3":
        arity(4);
        code = `${this.reg(a[0], true)} = static_cast<uint32_t>(static_cast<uint64_t>(${this.value(a[1], 32)}) + static_cast<uint64_t>(${this.value(a[2], 32)}) + static_cast<uint64_t>(${this.value(a[3], 32)}));`;
        break;
      case "ISETP.GE.U32.AND":
        arity(5);
        if (a[1] !== "PT" || a[4] !== "PT") unsupported("only canonical single predicate unsigned comparison is supported");
        code = `${this.predicate(a[0], true)} = (${this.value(a[2], 32)}) >= (${this.value(a[3], 32)});`;
        break;
      case "LDG.E":
      case "LDG.E.64": {
        arity(2);
        const address = this.address(a[1]);
        code = op.endsWith(".64") ? this.writePair(a[0], `rure_sass_detail::load64(${address})`, index) : `${this.reg(a[0], true)} = rure_sass_detail::load32(${address});`;
        break;
      }
      case "STG.E":
      case "STG.E.64":
        arity(2);
        code = `rure_sass_detail::store${op.endsWith(".64") ? 64 : 32}(${this.address(a[0])}, ${this.value(a[1], op.endsWith(".64") ? 64 : 32)});`;
        break;
      case "EXIT":
        arity(0);
        code = "return;";
        if (ins.predicate === null) successors = [];
        break;
      case "BRA": {
        arity(1);
        const target = hexNumber(a[0]);
        if (target % 16 || target / 16 >= this.sass.instructions.length) invalid("branch destination is not an instruction");
        code = `goto rure_label_${target / 16};`;
        successors = ins.predicate === null ? [target / 16] : [.../* @__PURE__ */ new Set([target / 16, ...successors])];
        break;
      }
      case "NOP":
        arity(0);
        code = ";";
        break;
      default:
        return unsupported(`unsupported SASS opcode ${op}`);
    }
    if (ins.predicate !== null) {
      code = `if (${this.predicate(ins.predicate)}) { ${code} }`;
      this.defines = 0n;
    }
    return { code, reads: this.reads, defines: this.defines, kills: this.kills, successors };
  }
  emit() {
    const instructions = this.sass.instructions.map((ins, i) => this.lower(ins, i));
    const reachable = /* @__PURE__ */ new Set(), pending = [0];
    while (pending.length) {
      const i = pending.pop();
      if (reachable.has(i)) continue;
      reachable.add(i);
      pending.push(...instructions[i].successors);
    }
    const predecessors = instructions.map(() => []);
    for (const i of reachable) for (const next of instructions[i].successors) predecessors[next].push(i);
    const all = (1n << 264n) - 1n;
    const incoming = instructions.map(() => all), outgoing = instructions.map(() => all);
    const queue = [...reachable], queued = new Set(queue);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      if (cursor >= 1e5) unsupported("dataflow budget exceeded");
      const i = queue[cursor];
      queued.delete(i);
      let input = i === 0 ? 0n : all;
      for (const p of predecessors[i]) input &= outgoing[p];
      incoming[i] = input;
      const output = input & ~instructions[i].kills | instructions[i].defines;
      if (output === outgoing[i]) continue;
      outgoing[i] = output;
      for (const s of instructions[i].successors) if (!queued.has(s)) {
        queue.push(s);
        queued.add(s);
      }
    }
    for (const i of reachable) {
      if (instructions[i].reads & ~incoming[i]) unsupported(`undefined register/pair/predicate or unestablished global descriptor at instruction 0x${this.sass.instructions[i].offset.toString(16)}`);
      if (i === instructions.length - 1 && (this.sass.instructions[i].opcode !== "EXIT" && this.sass.instructions[i].opcode !== "BRA" || this.sass.instructions[i].predicate !== null)) unsupported("reachable fallthrough past kernel end");
    }
    const out = [PRELUDE, `extern "C" __global__ void rure_sass_kernel_0(${this.abi.parameters.map((p) => `${p.type} ${p.emittedName}`).join(", ")}) {`];
    for (let r = 0; r < this.abi.registers; r++) out.push(`  uint32_t rure_r${r};`);
    for (let p = 0; p < 7; p++) out.push(`  bool rure_p${p};`);
    const targets = new Set(this.sass.instructions.filter((i) => i.opcode === "BRA").map((i) => hexNumber(i.args[0]) / 16));
    for (const i of [...reachable].sort((a, b) => a - b)) {
      if (targets.has(i)) out.push(`rure_label_${i}:`);
      out.push(`  ${instructions[i].code}`);
    }
    out.push("}");
    return out.join("\n") + "\n";
  }
}
const PRELUDE = `// Recovered from cuobjdump text under explicit CUDA ABI assumptions. Not a binary decoder or proof.
#include <stdint.h>
static_assert(sizeof(uintptr_t) == 8, "64-bit CUDA pointers required");
namespace rure_sass_detail {
static __device__ inline uint64_t join(uint32_t lo, uint32_t hi) { return static_cast<uint64_t>(lo) | (static_cast<uint64_t>(hi) << 32); }
static __device__ inline int64_t signed32(uint32_t n) { return static_cast<int64_t>(n) - static_cast<int64_t>(n >> 31) * 4294967296LL; }
static __device__ inline uint32_t load32(uint64_t a) { const unsigned char* p = reinterpret_cast<const unsigned char*>(static_cast<uintptr_t>(a)); uint32_t v=0; for(unsigned i=0;i<4;i++) v |= static_cast<uint32_t>(p[i]) << (i*8); return v; }
static __device__ inline uint64_t load64(uint64_t a) { const unsigned char* p = reinterpret_cast<const unsigned char*>(static_cast<uintptr_t>(a)); uint64_t v=0; for(unsigned i=0;i<8;i++) v |= static_cast<uint64_t>(p[i]) << (i*8); return v; }
static __device__ inline void store32(uint64_t a,uint32_t v) { unsigned char* p=reinterpret_cast<unsigned char*>(static_cast<uintptr_t>(a)); for(unsigned i=0;i<4;i++) p[i]=static_cast<unsigned char>(v >> (i*8)); }
static __device__ inline void store64(uint64_t a,uint64_t v) { unsigned char* p=reinterpret_cast<unsigned char*>(static_cast<uintptr_t>(a)); for(unsigned i=0;i<8;i++) p[i]=static_cast<unsigned char>(v >> (i*8)); }
}
`;
function recoverSass(sassText, elfText) {
  const result = {
    schemaVersion: 1,
    sourceSha256: sha(sassText),
    elfSha256: sha(elfText),
    status: "invalid",
    language: "cuda-cpp",
    code: null,
    architecture: null,
    binaryDecoder: false,
    proofStatus: "not-proven",
    diagnostics: [],
    functions: [],
    elisions: [],
    semanticScope: ["Single SM86/SM89 scalar integer kernel from cuobjdump SASS and ELF text.", "Explicit 32-bit physical registers and 64-bit even register pairs.", "Conservative initialization and control-flow admission; unsupported constructs produce no code.", "No floating point, local/shared memory, atomics, synchronization, calls, or performance guarantee."],
    assumptions: ["Inputs must be authentic matching cuobjdump exports from the exact same cubin; encoding-comment crosschecks do not validate mnemonic decoding.", "Standard 64-bit CUDA 12.8/ABI7 or 13.0/ABI8: parameter bank base 0x160, c[0x0][0x0] is blockDim.x, canonical UR4/UR5 global descriptor comes from c[0x0][0x118].", "Original scalar argument order/bit widths and launch dimensions are retained.", "Global accesses require valid aligned race-free memory. Runtime descriptor contents and stack pointers are never synthesized.", "Generated source requires independent compiler and GPU validation; proofStatus remains not-proven."]
  };
  try {
    for (const text of [sassText, elfText]) {
      if (Buffer.byteLength(text, "utf8") > MAX_SASS_RECOVERY_BYTES) invalid("input exceeds bounded dump size");
      if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) invalid("only printable ASCII and tab/newline exports are supported");
      if (text.split("\n").some((line) => line.length > 2048)) invalid("dump line exceeds 2048 characters");
    }
    const sass = readSass(sassText), abi = readElf(elfText, sass);
    const emitter = new Emitter(sass, abi), code = emitter.emit();
    if (Buffer.byteLength(code, "utf8") > MAX_SASS_RECOVERY_CODE_BYTES) unsupported("output size limit exceeded");
    result.status = "emitted";
    result.code = code;
    result.architecture = `sm_${sass.sm}`;
    result.functions = [{ name: sass.name, emittedName: "rure_sass_kernel_0", parameters: abi.parameters }];
    result.elisions = emitter.elisions;
  } catch (error) {
    result.status = error instanceof Unsupported ? "unsupported" : "invalid";
    result.diagnostics.push(error instanceof Error ? error.message : "recovery failed");
  }
  return result;
}
export {
  MAX_SASS_RECOVERY_BYTES,
  MAX_SASS_RECOVERY_CODE_BYTES,
  MAX_SASS_RECOVERY_INSTRUCTIONS,
  recoverSass
};
