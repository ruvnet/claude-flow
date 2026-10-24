# ADR 501: from static findings to a plan for measuring (rure_cuda_launch_plan)

Status: Accepted (built; checked against NVIDIA's reference calculator on 1.77 million combinations and against the CUDA driver on real GPUs of five architectures; ships in ruflo 3.62.0 and ruflo-rure 0.6.0)

Date: 2026-10-24

Builds on: ADR-500 (the capability map and its stated limit), plugin ADR-0006 (the CUDA reader), ADR-495 to ADR-499 (the console page and its folder rules).

## 1. Context

`rure_analyze_cuda` says what a CUDA program contains: per kernel, registers, static shared, local and constant memory, code size, architecture. ADR-500 section 6 states what it cannot say: whether any of that matters. Nine registers or ninety is only interesting once you know what the GPU does with it, and the next question an engineer asks, "which kernels and block sizes are worth benchmarking?", has an answer that can be worked out from those same numbers without running anything: how many blocks and warps fit on a multiprocessor, and which resource says no to the next one.

The obstacle is ruRE's central promise: it parses and never runs. A tool that benchmarks has to run code. This ADR connects the two without breaking the promise: ruRE produces a **plan**; measuring stays a separate step that the person takes.

## 2. Decision

A new read-only MCP tool, `rure_cuda_launch_plan` (a minor release, ruflo 3.62.0; ruflo-rure 0.6.0). It takes what `rure_analyze_cuda` takes (an absolute path to a CUDA host binary, `.fatbin` or `.cubin`) and returns, per architecture that has compiled code in the file and per launchable kernel:

- **Resources**, as the driver counts them: registers, static shared bytes, local bytes, plus the raw `.nv.shared` section size so the number can be reconciled with `cuobjdump`.
- **Theoretical occupancy** at a list of block sizes (default 32 to 1024 in ten steps; at most 24 caller-supplied sizes, integers from 1 to 1024): blocks and warps resident per multiprocessor, the occupancy fraction, and every resource that sets the limit (`registers`, `sharedMemory`, `warps`, `blocks`, and, where NVIDIA reports it, `barriers`).
- **The best block sizes** (all that tie for the highest occupancy), and flags: `local-memory`, `register-limited`, `shared-memory-limited`.
- **Optionally the harness**: `includeHarness: true` returns the text of a small CUDA driver-API program (section 5).
- The assumptions, stated in the result.

`dynamicSharedBytes` (0 to 1 MiB) is a parameter, because dynamic shared memory is chosen at launch and is not in the file. Kernel and identifier names from the file are untrusted text and pass the AIDefence gate like every other ruRE string.

### 2.1 The occupancy model

It is the CUDA occupancy calculator's model: a block needs warps, registers (allocated per warp in 256-register units, with the register file split across four sub-partitions), shared memory (rounded to the architecture's granularity, with the driver's per-block reservation, against the multiprocessor's carveout configurations), and a block slot; the resident block count is the smallest of the four limits. It was written here from that model, not copied from NVIDIA's header, and verified against it (section 4). Eight architectures have a table: `sm_70`, `75`, `80`, `86`, `87`, `89`, `90`, `120`. Any other architecture gets `supported: false` and no figure, not a guess.

### 2.2 The shared-memory convention from `sm_90`

Found by running the plan on real hardware, not by reading documentation. From `sm_90`, the compiler folds the 1 KiB the driver reserves per block into the `.nv.shared.<kernel>` section of every kernel that has one. The driver reports the size without it, and the occupancy calculation then adds the reservation back. A model fed the raw section size counts it twice and says a kernel with 48 KiB of static shared memory cannot launch when it can. The tool therefore uses `max(0, section - reservation)` as the static figure on those architectures (`cubinSharedIncludesReserve`), and reports both numbers. With the correction switched off, the live test on an RTX 5080 fails on exactly this kernel (checked).

### 2.3 What the best block size shows

A property worth stating because it is not obvious: with static shared memory at most 48 KiB, shared memory alone never caps the best block size, because a larger block amortises the per-block cost. It can tie with registers (the flag is then raised alongside `register-limited`), and it dominates small block sizes in the table, but a kernel that is genuinely held by shared memory at its best size is held by something else too. The tests state this, and the result's per-size `limitedBy` is where shared memory shows.

## 3. The harness, and why this does not break "parse, never run"

`includeHarness` returns text. ruRE does not write it, compile it, load it or run it, and nothing from the analyzed file is in it: the file and the kernel name are arguments to the program. Built plainly, it loads the file's code onto device 0 through the driver and asks the driver how many blocks fit per multiprocessor at each block size, which is a check of the plan on the person's own GPU; it launches nothing. Built with `-DRURE_BENCH` and a `rure_bench.h` of the person's own that sets up the kernel's arguments, it launches the kernel and reports median times. That mode runs the analyzed code; the text says so at the top, and the skill tells agents to say so. Automating that step (an agent building and running the harness itself) is not decided here: it would need its own consent and sandbox decision, as running anything does for ruRE.

## 4. How it was verified

| Check | Result |
| --- | --- |
| **Against NVIDIA's `cuda_occupancy.h`**, 221,277 combinations per architecture (registers 1 to 257, 41 block sizes, 7 static and 3 dynamic shared sizes), for all eight tables | Every answer equal, the limiting set included. 1,770,216 comparisons. SHA-256 of NVIDIA's answers committed, so CI repeats the check without a toolkit |
| **Against the CUDA driver on real GPUs**: five kernels built for the GPU (a streaming kernel, 48 KiB static shared, dynamic shared, a 128-register kernel, a C++-mangled kernel), the plan taken from the built CLI, the harness built with nvcc and run | See section 4.1: 90 comparisons per GPU (the device's own limits, each kernel's registers, static shared and local memory, and the resident blocks and warps at ten block sizes) |
| **Timing path** | The harness built with `-DRURE_BENCH` and an argument file for `saxpy` launched and timed every launchable block size on the RTX 5080 |
| **Mutation** | Turning off the `sm_90`-and-later shared-memory correction makes the live test fail |
| **Hostile and odd input** | Traversal and missing paths, every malformed option, a flagged kernel name redacted, a file with no compiled code, a kernel with no register count, an architecture without a table |

### 4.1 Real devices

| GPU | Architecture | Where | Comparisons | Different |
| --- | --- | --- | --- | --- |
| GeForce RTX 5080 | `sm_120` | this machine, CUDA 13.0, driver 580 (`rure-cuda-plan-live.test.ts`) | 5 kernels at 10 block sizes, resources, device limits | 0 |
| GeForce RTX 3090 | `sm_86` | rented, CUDA 13.0 | 90 | 0 |
| GeForce RTX 4090 | `sm_89` | rented, CUDA 13.0 | 90 | 0 |
| A100 SXM4 | `sm_80` | rented, CUDA 13.0 | 90 | 0 |
| H100 SXM | `sm_90` | rented, CUDA 13.0 | 90 | 0 |

On each, the device's own limits (threads, blocks, registers and shared memory per multiprocessor, the per-block reservation) equal the table's row, which is what lets those five rows be marked `device-checked` in the source. `sm_90` is the one that confirms the shared-memory convention of section 2.2 on hardware: the driver reported 49152 static bytes for the 48 KiB kernel where the section holds 50176.

**Not checked on a device:** `sm_70`, `sm_75` and `sm_87`. Their rows rest on NVIDIA's documentation and on the reference calculator (section 4, first row), which is strong for the arithmetic and weaker for the device numbers themselves. A V100 and a Turing GPU were rented for this and never became reachable (the hosts stayed in image pull for 18 minutes), so they were destroyed. Their `provenance` field says `documentation` and the result carries it.

The four rented GPUs were used for a few minutes each (vast.ai). The whole effort cost $1.03: of eleven rentals, four reached a usable GPU, five stayed unreachable or in image pull and were destroyed unused, and two were cancelled by hand when the defect of section 5 appeared. For each architecture the bundle (the cubin, the plan from the real CLI, and the harness text) was built locally, then the harness was built and run on the rented machine, and only its output came back.

## 5. A defect this found, in the released reader

Running the plan for `sm_70` and `sm_75` showed `sm_5`. The SM number in a cubin's `e_flags` sits in the low byte for cubins written with ELF OS ABI 51 (everything CUDA 12.8 writes for `sm_70` to `sm_90`: `sm_70` is `0x460546`) and in the second byte for OS ABI 65 (CUDA 13, and CUDA 12.8 for `sm_120`: `sm_80` is `0x06005004`). The reader took the second byte always, so a standalone `.cubin` built with CUDA 12 reported the wrong architecture and no instruction estimate. Cubins inside a fatbin or host binary were unaffected, because they take the architecture from the entry header, which is why the existing fixtures (all CUDA 12 files were host binaries) missed it. Fixed in `cuda-cubin.ts` (`smOfFlags`), with three real CUDA 12.8 cubins (`sm_70`, `sm_75`, `sm_90`) and `cuobjdump`'s answers added as fixtures. The tests fail without the fix.

## 6. Limits, stated plainly

- **Occupancy is a bound, not a prediction.** High occupancy does not make a kernel fast and low occupancy does not make it slow. The plan says which configurations are worth measuring; only measuring says which is faster.
- **Assumptions** (in the result): the default shared-memory carveout and cache configuration, one block barrier per block, no cluster launch, no opt-in to more than 48 KiB of shared memory per block, and the same dynamic shared size for every kernel.
- **Registers come from the compiled code in the file.** PTX the driver compiles at load time can use different numbers; a file with only PTX has nothing to plan from, and the result says so.
- **Tabulated architectures only.** `sm_72`, `sm_100`, `sm_101`, `sm_103`, `sm_110`, `sm_120`'s siblings and anything newer have no table here. Adding one is a table row plus a run of the oracle test and, ideally, a device.
- **Not every table row was checked on a device.** Which were is in section 4.1; the others rest on NVIDIA's documentation and the reference calculator.
- **The harness is a template for one kernel at a time** with a fixed list of ten block sizes; the plan's own list can be longer.

## 7. Not in this ADR

A console row for the plan, a skill-driven way to build and run the harness, and any attempt to predict performance. Each is a separate decision.
