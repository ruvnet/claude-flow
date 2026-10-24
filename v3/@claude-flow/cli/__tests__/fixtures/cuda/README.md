# CUDA fixtures for ruRE Phase 5 (ADR-0006)

Real output of `nvcc`, not synthetic. All are built from `k.cu` (two kernels, `saxpy` and `scale_secret`). The host binaries are
stripped. Each `*.cuobjdump.txt` is `cuobjdump`'s own answer for that file (`-lelf -lptx`, `-res-usage`, `-symbols`), kept as the ground truth
the tests compare against. Built on Linux x86-64, 2026-10-23.

| File | Toolkit | Command (after `cd` to a scratch dir with `k.cu`) |
|---|---|---|
| `host-default` | nvcc 13.0.88 | `nvcc -cudart shared -gencode arch=compute_80,code=[sm_80,compute_80] -o host-default k.cu` (PTX is zstd-compressed) |
| `host-multiarch` | nvcc 13.0.88 | `nvcc -cudart shared -gencode arch=compute_75,code=sm_75 -gencode arch=compute_90,code=[sm_90,compute_90] -o host-multiarch k.cu` |
| `host-cubinonly` | nvcc 13.0.88 | `nvcc -cudart shared -gencode arch=compute_80,code=sm_80 -Xfatbin -compress-all -o host-cubinonly k.cu` (cubins zstd-compressed) |
| `host-cuda128` | nvcc 12.8.93 | `nvcc -cudart shared -gencode arch=compute_80,code=[sm_80,compute_80] -o host-cuda128 k.cu` (PTX is LZ4-compressed) |
| `host-cuda128-all` | nvcc 12.8.93 | the same with `-Xfatbin -compress-all` (cubins and PTX LZ4-compressed) |
| `k80.fatbin` | nvcc 13.0.88 | `nvcc -fatbin -arch=sm_80 -compress-mode=none -o k80.fatbin k.cu` |
| `k80.cubin` | nvcc 13.0.88 | `nvcc -cubin -arch=sm_80 -o k80.cubin k.cu` |
| `k80.ptx` | nvcc 13.0.88 | `nvcc -ptx -arch=compute_80 -o k80.ptx k.cu` |
| `k70-cuda128.cubin`, `k75-cuda128.cubin`, `k90-cuda128.cubin` | nvcc 12.8.93 | `nvcc -cubin -arch=sm_70 -Wno-deprecated-gpu-targets -o k70-cuda128.cubin k.cu` (and `sm_75`, `sm_90`). CUDA 12 writes these with ELF OS ABI 51, where the SM number is the low byte of `e_flags`; CUDA 13 uses OS ABI 65 and the second byte. Added when the launch plan (ruflo ADR-501) found the reader calling every such cubin `sm_5`. Ground truth is `cuobjdump -res-usage` and `-symbols`. |

Then `strip` the `host-*` files, and record the ground truth with `cuobjdump -lelf -lptx F; cuobjdump -res-usage F; cuobjdump -symbols F`.
CUDA 13 no longer accepts `compute_70`, hence sm_75 in the multi-architecture build.
