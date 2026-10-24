# SM86 / CUDA 12.8 recovery execution

This immutable public synthetic observation uses the unchanged frozen input
archive in the parent directory. `executed-worker.py` is the exact disposable
GPU worker used for this attempt, retained for source inspection. It expects
an isolated CUDA rental layout and was launched with a sanitized environment.
It is not an MCP tool, cloud allocator or trusted promotion policy.

`gpu-raw.json` holds raw timing samples, compilation commands, mutation and
memcheck output. `gpu-results.json` is the sanitized host transfer wrapper.
`receipt.json` adds the scoped verdict, quote estimates and observed cleanup.
The private executor identifier was removed only from this derived summary;
its original digest is recorded. Public hashes bind bytes, not executor identity.

The retained baseline archive contains SASS and ELF **text dumps**. It does not
contain the compiled cubin or recovered PTX bytes; their recorded hashes are
worker observations. See the parent README for a CPU-only receipt replay.

Correctness passed on this synthetic scope; the speed threshold failed.
Neither this script nor the receipt authorizes GPU allocation, promotion,
package publication or deployment.
