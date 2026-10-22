# ADR-0004: ruRE Phase 3 — .NET assembly metadata inspection

Status: Proposed

## Context

ADR-0001 deferred .NET decompilation because a trustworthy decompiler is its own engine and domain. But the first questions about a managed assembly are answered by its ECMA-335 metadata alone, with no IL decoding: which assemblies it references, which types and how many methods it defines, which native DLL functions it calls through P/Invoke, what string literals it carries, and what its entry point is. Phase 2's PE reader already handles the container; managed assemblies are PE files with a CLR header.

## Decision

Add **metadata-level inspection of managed assemblies**, as an original pure-TypeScript reader (no dependency, no decompiler, no IL decoding), exposed as one read-only tool `rure_analyze_dotnet`.

- **Reads:** CLR header, metadata root and stream directory, the `#~`/`#-` table stream (row counts and row layouts for all 45 ECMA-335 tables, needed to locate the tables we read), `#Strings`, and `#US`.
- **Returns:** runtime and metadata version, assembly identity, assembly references, type names (capped), method count, P/Invoke imports (native module + function), user-string literals (capped), entry-point token.
- **Parses, never executes.** The assembly is never loaded into a runtime; nothing is JIT-compiled or run.
- **Hostile input:** every offset is bounds-checked, table extents are validated against the stream size before any row is read, list outputs are capped, and a malformed structure becomes a warning rather than an error. Not-managed PE files return `isManaged: false`.
- **AIDefence gate:** names, P/Invoke strings and user strings are screened; flagged values are redacted and counted.
- **Out of scope:** IL disassembly, decompilation to C#, resource extraction, signature-blob decoding (parameter and return types), and obfuscation handling.

## Consequences

Users can see a managed assembly's dependency surface and native-call surface without a runtime or a licensed decompiler. IL-level understanding remains a later phase with its own ADR.
