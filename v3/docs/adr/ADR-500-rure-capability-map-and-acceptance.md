# ADR 500: ruRE capability map, trust rules and the acceptance test

Status: Accepted (documentation of what ships in ruflo 3.61.1; the acceptance run below was made against the published package)

Date: 2026-10-24

Builds on: the plugin ADRs 0001 to 0006 (ruflo-rure) and ADR-494 to ADR-499 (the console page, the link check, DETECT, the CUDA row, the mod offer, outside folders).

## 1. Context

ruRE grew over seven releases through eleven ADRs. Each one says what its own step does; nothing says in one place what ruRE can read now, through which doors, under which rules, and how anyone checks it. Summaries written from the outside (a launch note, a changelog line) drift from the code. This ADR is the single reference, written from the source and checked by a run, and it names the acceptance test that guards the part people lean on most: the CUDA numbers.

## 2. What ruRE reads

Seven read-only MCP tools in `@claude-flow/cli`, all in `v3/@claude-flow/cli/src/mcp-tools/rure-tools.ts` (ADR-501 adds an eighth, `rure_cuda_launch_plan`, which plans measurements from the CUDA reader's output). Each parses a file and returns an inventory. None runs, loads, compiles or writes what it reads (the one exception is stated in the next section).

| Tool | Reads | Returns |
| --- | --- | --- |
| `rure_analyze_js_app` | A folder of JavaScript or Electron source | Modules, imports, IPC, preload and webview boundaries |
| `rure_find_feature` | The same folder, plus a query | Where a named feature appears |
| `rure_extract_asar` | An Electron `.asar` | The unpacked files, to a new temp folder (the one tool that writes) |
| `rure_analyze_binary` | ELF, PE or Mach-O | Format, sections, libraries, imports, exports, strings |
| `rure_analyze_dotnet` | A .NET assembly | Runtime version, assembly and references, types, P/Invoke, string literals |
| `rure_analyze_evm` | EVM bytecode (hex or raw) | Function selectors, embedded addresses, event topics, hazardous opcodes, minimal-proxy signal, compiler metadata |
| `rure_analyze_cuda` | A CUDA host binary, `.fatbin`, `.cubin` or `.ptx` | Fatbin entries (PTX or cubin, architecture, compression), per kernel registers, code size, constant, shared and local memory, PTX version and target |

CUDA needs no toolkit and no driver. LZ4 entries (CUDA 12) are read on any Node; zstd entries (CUDA 13) need Node 22.15 or newer and are reported as unread otherwise.

## 3. The trust rules, in one place

1. **Parse, never run.** No tool executes, loads, compiles or shells out. `rure_extract_asar` writes the archive's files to a new temp folder and, in the console, asks first.
2. **File text is untrusted.** Every string taken from a file passes the AIDefence gate before it is returned; results carry `screened` and `redactedCount`, and say `screened: false` when the scanner is unavailable.
3. **The tools read any path the process can read.** The limit is the console's, not the tools': the ruRE page accepts a project-relative sample (ADR-494), refuses a link on the way (ADR-495), and reaches a folder outside the project only through a name the person defined in the option `rureFolders` (ADR-499). Changing that option is an install-class write that always asks.
4. **Offers are offers.** The opt-in mod option `rureOffer` (ADR-498) adds one line under an answer when the model touched a binary; it never runs ruRE.

## 4. The doors

- MCP tools, for an agent: `npx ruflo mcp exec -t rure_analyze_cuda -p '{"path":"…"}'`.
- The console's ruRE page (TOOLS, then ruRE): a row per reader, DETECT to choose one, results below, and a structured `rure` block in `console_state` for Claude (ADR-494, 496, 497).
- The ruflo-mods offer (ADR-498).

## 5. The acceptance test

A reader of compiled GPU code is only as good as its agreement with NVIDIA's own tool. The test is: compile a CUDA program, read it with ruRE, and compare each kernel's resource numbers with `cuobjdump --dump-resource-usage`, per architecture.

It exists in two forms, both already in the repository:

- `v3/@claude-flow/cli/__tests__/rure-cuda-live.test.ts`: compiles real programs with the local `nvcc`, runs the built CLI as an agent would, and diffs live against `cuobjdump`. It skips, saying so, without a toolkit (CI has none).
- `v3/@claude-flow/cli/__tests__/rure-cuda-parse.test.ts`: the same comparison against committed fixtures and recorded `cuobjdump` text, so it runs everywhere.

### 5.1 The run recorded here (2026-10-24)

A fresh program of four kernels (a streaming `saxpy`, a shared-memory reduction, a constant-memory polynomial and a register-heavy loop), built with CUDA 13.0 for `sm_80`, `sm_86`, `sm_89` and `sm_120` plus `compute_80` PTX, read by the **published** `ruflo@3.61.1` from a clean directory:

| Field, per kernel and architecture (16 rows) | Identical to `cuobjdump` |
| --- | --- |
| Registers | 16 of 16 |
| Constant memory (bank 0) | 16 of 16 |
| Static shared memory | 4 of 16 as reported; 16 of 16 reading "no section" as 0 |
| Local memory | 0 of 16 as reported; 16 of 16 reading "no section" as 0 |

The shared and local difference is one of representation: ruRE returns `null` for a kernel that has no static shared or local section, and `cuobjdump` prints `0`. The numbers never disagreed. The shared figure that exists (the reduction) matched on every architecture, including `sm_120`, where both tools report 5120 bytes against 4096 on the other architectures. That is not a disagreement: from `sm_90` the compiler adds the driver's 1 KiB per-block reservation to each kernel's shared size, and the driver reports the size without it. ADR-501 section 2.2 has the hardware evidence. Register counts differ by architecture for the same source (the register-heavy kernel used 16, 17, 17 and 15 registers on `sm_80`, `sm_86`, `sm_89` and `sm_120`), which is the reason the numbers are read per architecture. The in-repository live test also passed on the same day (7 of 7).

Run it from a clean directory: a leftover partial `.claude-flow/policy` store in the working directory makes every ruflo tool refuse with `policy-anchor-log-missing`, by design (tamper evidence), and it looks like a ruRE failure when it is not.

## 6. What this does not establish

- **No SASS decoding, no source reconstruction, no performance.** Register counts and memory sizes identify kernels worth a closer look; they cannot show a speedup. Instruction counts are estimates from code size.
- **Native, .NET and EVM readers were validated on built fixtures,** not against a second tool, in the way CUDA was against `cuobjdump`.
- **`rure_extract_asar` leaves its temp folder behind.**
- **Dynamic analysis is not part of ruRE** and would need its own consent and sandbox decision.
- **PTX to CUDA and SASS-text recovery** are not in this ADR; they are in review (draft #4448 and #4449) and will have their own records.

## 7. Next

ADR-501 takes the one step this ADR names as missing for CUDA: turning the static numbers into a plan for measurement, without ruRE running anything.
