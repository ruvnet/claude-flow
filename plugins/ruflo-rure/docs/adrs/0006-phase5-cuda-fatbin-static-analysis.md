# ADR-0006: ruRE Phase 5 — CUDA fatbin and cubin static analysis

Status: Proposed

## Context

ADR-0003 gave ruRE container-level inspection of ELF, PE and Mach-O files. On a binary built by `nvcc` that inspection stops at the door: it names the sections `.nv_fatbin`, `__nv_module_id` and `.nvFatBinSegment` and nothing inside them. The GPU code, which is the interesting part of a CUDA program, is in those sections: one or more **cubins** (an ELF file for the GPU, `e_machine` 190) and optionally **PTX** (NVIDIA's virtual ISA, as text), packed in a **fatbin** container, often compressed.

A person studying a CUDA program they are authorized to study first needs the inventory: which GPU architectures it targets, whether it ships PTX that any newer GPU can compile, which kernels exist and how heavy each is (registers, shared and constant memory, code size). That inventory is a parsing job, not a disassembly job, and none of it is available from ruRE today. The kernel names are in the file as plain text (36 hits in the binary used to write this ADR), yet `rure_analyze_binary` returns only the first 200 strings and had none of them.

## Decision

Phase 5 adds one read-only tool, **`rure_analyze_cuda`**, an original pure-TypeScript reader. No new dependency, no `nvcc`, `cuobjdump` or `nvdisasm`, no disassembler.

It accepts one `path` and decides what the file is from its bytes, not its extension:

| The file | How it is read |
|---|---|
| a host ELF or PE that holds a `.nv_fatbin` (`.nv_fatb` on PE) section | the section is located with the existing `parseBinary`, then read as a fatbin |
| a standalone fatbin (`0xBA55ED50` at offset 0) | read as a fatbin |
| a standalone cubin (ELF, `e_machine` 190) | read as one cubin |
| a standalone PTX text file (a `.version` directive near the top) | read as PTX |

### The fatbin container, as read from real files

Layout verified against binaries built here with `nvcc` 12.8.93 and 13.0.88 and cross-checked with `cuobjdump -lelf -lptx`, `-symbols` and `-res-usage` (provenance and recorded ground truth are in `v3/@claude-flow/cli/__tests__/fixtures/cuda/`). It is a description of what was observed, not NVIDIA's specification, which is not published.

- A `.nv_fatbin` section is **several containers back to back**. A container is a 16-byte header (`magic 0xBA55ED50` u32, `version` u16 = 1, `headerSize` u16 = 16, `fatSize` u64: the bytes that follow) and its entries; the next container starts at `header + fatSize`.
- An **entry** has its own header, whose length is in the header: 64 bytes for a cubin, 80 for PTX in the files seen. The reader advances by the stated length and never assumes one. Fields (little endian): `kind` u16 (1 = PTX, 2 = cubin; others reported raw), a u16 that is 0x0101 in every file seen, `headerSize` u32, `paddedPayloadSize` u64, `compressedSize` u32 at +16, `version` u32 at +24 (reported raw), `arch` u32 at +28 (80 reads `sm_80`), `objNameOffset` u32 and `objNameLen` u32 at +32 and +36, `flags` u64 at +40, `decompressedSize` u64 at +56.
- **Flags.** `0x8000` marks a zstd payload (it starts `28 B5 2F FD`) and `0x2000` an LZ4 block payload. Both were seen: CUDA 13 compresses with zstd, CUDA 12.8 with LZ4. All other bits are reported as hex, not interpreted. A payload is trusted as compressed only when its flag and its first bytes agree; otherwise it is reported as unread, with the reason.
- **Decompressed size is checked.** The header's `decompressedSize` equals the decompressed length in every file tested (1464 bytes of PTX from a 489-byte payload). A payload whose output differs from the header is a warning and is not used.

### The cubin

An ELF64 for the GPU. The reader walks the section headers and the `SHT_SYMTAB` itself (`parseBinary` reads dynamic symbols only and returns none for a cubin).

- **Architecture** from the entry's `arch`; the ELF `e_flags` byte `(e_flags >> 8) & 0xFF` (0x50 for `0x6005004`) is the cross-check, and a disagreement is a warning.
- **Kernels** are `STT_FUNC` + `STB_GLOBAL` symbols whose `st_other` has `0x10` (`STO_CUDA_ENTRY`); the same symbols without that bit are device functions and are reported as such.
- **Per kernel**: the mangled name (and the plain identifier when the name is a simple `_Z<len><name>…`, with no attempt at full demangling), the code bytes of its `.text.<name>` section, `constantBytes` from `.nv.constant0.<name>`, `sharedBytes` from `.nv.shared.<name>`, `localBytes` from `.nv.local.<name>`, and `registers`.
- **Registers.** From the cubin's global `.nv.info` section, which is a list of records (format u8, attribute u8, size u16, payload). The record with attribute `0x2f` (`EIATTR_REGCOUNT`) and an 8-byte payload gives a symbol index and a register count; the kernel is the symbol with that index. Read this way the counts equal `cuobjdump -res-usage` on every file tested (sm_75, sm_80 and sm_90; 8 and 10 for the two test kernels). A kernel no record names reports `registers: null`, not a guess. (A first draft read the high byte of the `.text.<name>` section's `sh_info`, which happens to hold the count on sm_75 and sm_80 and is zero on sm_90; testing against `cuobjdump` on a multi-architecture binary is what showed that, and it is not used.)
- **Instruction estimate.** On SM 7.0 and later each SASS instruction is 16 bytes, so `codeBytes / 16`. It is labelled an estimate and is `null` below SM 7.0 (where the size differs and ruRE has not been checked).

### PTX

Text. A bounded scan of at most 4 MiB gives `.version`, `.target`, `.address_size`, and each `.entry` (kernel) and `.func` name with its parameter count. The full text is returned only with `includePtx: true` (at most 64 KiB, with `truncated`), as the EVM reader does with `includeDisassembly`.

### The trust model (ADR-0001 applied)

- **Parses, never executes.** Nothing is loaded, mapped, run or passed to a shell. No CUDA driver or toolkit is needed or touched.
- **Everything from the file is untrusted** and goes through the same AIDefence screening as the other tools before it is returned: kernel and function names, section names, object names, PTX identifiers and any PTX text. `redactedCount` and `screened` say what happened; a name that was held back is never silently dropped.
- **Decompression is the new risk, and is capped.** The header's claimed `decompressedSize` is refused before any decompression when it exceeds 16 MiB for an entry or 64 MiB for the file, and the 64 MiB is charged when an attempt starts, win or lose, so a file of 256 entries that each fail late cannot cost 4 GiB of decoding. The decompressor is also given that cap as its own output limit, so a header that lies cannot make it write more. The LZ4 block decoder is original (about 40 lines), reads only within the payload, rejects an offset that points before the output start, and stops at the output cap. Where this Node has no zstd (`zlib.zstdDecompressSync` exists from Node 22.15; Node 20 lacks it), a zstd entry is returned with `compressed: "zstd"` and a note that this runtime cannot read it, and everything else is still read.
- **Other caps.** The file is refused over 128 MiB (as in ADR-0003); at most 64 containers and 256 entries; an entry header length outside 16..4096 stops the walk with a warning; at most 2000 symbols and 500 kernels returned; every offset is bounds-checked. `truncated` says when a cap fired.
- **Dual-use.** The tool describes structure to help someone understand and interoperate with software they are authorized to study (for example, deciding whether a binary can be run on a different GPU, or planning a port). It does not extract kernels to a file, strip, patch or repack anything, and it carries ADR-0001's refusals: no help circumventing license checks, DRM or anti-tamper.

### Out of scope, said plainly

- **SASS decoding and disassembly.** The instruction encoding is not documented by NVIDIA and changes by architecture; ruRE does not decode it. The instruction count is an estimate from the code size, nothing more.
- **`.nv.info` attributes** other than the register count (launch bounds, parameter layouts, barriers).
- **Full C++ demangling.** Only simple names are given a plain identifier; the mangled name is always returned.
- **Dynamic analysis**, including running a kernel, profiling, and attaching to a process. These need their own ADR and a consent and sandbox model, per ADR-0001.
- **Other GPU programs.** HIP and ROCm code objects, OpenCL SPIR-V and Metal libraries are different formats.
- **Fatbin variants not seen.** Compression flags other than the two above, a container version other than 1, and entry kinds other than 1 and 2 are reported raw and not interpreted.

## Verification

Real files, built here and recorded: eight binaries in `__tests__/fixtures/cuda/` from `nvcc` 13.0 and 12.8 (default compression, a single architecture with PTX, multi-architecture, compressed cubins, a standalone cubin, PTX and fatbin) with the `cuobjdump` output kept beside them as ground truth. Tests assert against it: container and entry counts, kinds, `sm_NN`, compression, the two kernel names, the register and constant sizes equal to `-res-usage`, the PTX `.target`. Synthetic builders add the hostile cases: a `fatSize` past the buffer, a zero and an enormous entry header length, a header claiming a 1e9-byte decompressed size (refused, not attempted), a decompressor input that expands past its cap, an LZ4 offset before the start, a zstd entry on a Node without zstd, and a kernel name carrying terminal escapes. A live end-to-end test compiles with a local `nvcc` when there is one and compares the tool's answer with `cuobjdump`; it skips cleanly without one, as in CI.

## Consequences

Users get what a CUDA reverse engineer reads first (targets, PTX presence, kernels and their resource cost) with no toolkit installed. The tool is a new MCP tool, so it ships in the next minor release of `@claude-flow/cli`, and ruflo-console's ruRE page needs a follow-up change to offer it (until then the page does not list it). Disassembly-grade work remains a later phase with its own ADR; this phase deliberately produces the structured inventory such a phase would start from.
