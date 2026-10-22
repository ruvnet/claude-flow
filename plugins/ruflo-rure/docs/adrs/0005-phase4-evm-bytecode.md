# ADR-0005: ruRE Phase 4 — EVM bytecode static inventory

Status: Proposed

## Context

ADR-0001 listed EVM bytecode analysis as a deferred domain. Deployed contract bytecode is public by nature, and the useful first questions are mechanical: what functions does the dispatcher expose, does the code contain `SELFDESTRUCT`, `DELEGATECALL`, `CREATE2` or `ORIGIN`, which addresses and event topics are embedded, which compiler produced it, and is it a minimal proxy. A trustworthy symbolic executor or decompiler is a much larger engine; none of these questions need one.

## Decision

Add a **static inventory of EVM bytecode** as an original pure-TypeScript disassembler and pattern scanner, exposed as one read-only tool `rure_analyze_evm`.

- **Input:** hex bytecode (inline, `0x` optional) or a file holding hex text or raw bytes. Exactly one source per call. Hard cap 256 KiB of bytecode (EIP-170 deployed code is 24 KiB; initcode up to 48 KiB).
- **Returns:** instruction and `JUMPDEST` counts; function selectors recognized from dispatcher shape (`PUSH4 <sel> [DUP2] EQ`), with names only for a small built-in table of well-known ERC-20/721/Ownable/Proxy selectors; counts and first offsets of hazardous opcodes; embedded `PUSH20` addresses; event topics found before `LOG1`-`LOG4`; EIP-1167 minimal-proxy detection with the implementation address; compiler metadata trailer (solc version, IPFS/Swarm hash); printable strings embedded in `PUSH` data (typically revert reasons).
- **Disassembly is aligned:** `PUSH` immediates are skipped as data, so operand bytes are never misread as opcodes.
- **Never executes.** There is no EVM interpreter, no RPC, no network access, and nothing is signed or sent. The tool reasons only about bytes it was given.
- **Honest limits:** selector detection covers the standard dispatcher shape and will miss hand-written or heavily optimized dispatch; a hazardous opcode being present is an inventory fact, not a finding of vulnerability; selector names are a small curated table, not a signature database.
- **AIDefence gate:** embedded strings are untrusted text and pass through the gate; flagged values are redacted and counted. Hex-only outputs (selectors, addresses, topics) are not free text.
- **Out of scope:** symbolic execution, decompilation, storage-layout recovery, on-chain fetching.

## Consequences

Users get a fast, dependency-free first look at a contract's exposed surface and risky capabilities. Anything deeper (reachability, exploitability) remains for a dedicated engine in a later phase.
