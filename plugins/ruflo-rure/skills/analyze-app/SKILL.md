---
name: analyze-app
description: Statically inspects a local JavaScript or Electron application you're authorized to study, explains how a feature works with file+line evidence, and helps build an equivalent for your own project. Use when the user wants to understand or reimplement a feature from an app whose source they have (their own app, a licensed target, or an explicit research/CTF context). Parses only — never executes the target.
allowed-tools: Read
---

# Analyze App (ruRE — JS/Electron and native-binary and .NET static analysis)

Uses the ruRE tools (server `ruflo-rure`): `rure_extract_asar`, `rure_analyze_js_app`, `rure_find_feature`, `rure_analyze_binary`, `rure_analyze_dotnet`, `rure_analyze_evm`.

**Authorization check — do first, every time.** This skill is for understanding and reimplementing functionality you're authorized to study: your own application, a target you've properly licensed, or an explicit CTF/security-research context. If that isn't clearly the case, say so and stop before calling any tool. Refuse requests aimed at circumventing DRM, license checks, anti-tamper mechanisms, or paid-feature gates — reframe or decline those, don't attempt a workaround.

1. If the target is a packaged `.asar` file, call `rure_extract_asar` first and use its `unpackedPath` for the next step. If `truncated: true` came back, the archive exceeded the size/file-count cap — tell the user and stop; do not attempt a partial analysis.
2. Call `rure_analyze_js_app` on the directory. This returns modules, an import/export graph, and Electron process-boundary findings (main vs. renderer, `ipcMain`/`ipcRenderer`/`contextBridge` usage) — every finding carries a file + line-range evidence pointer.
3. If the user described a specific feature, call `rure_find_feature` with that description to narrow down where it likely lives, rather than reading the whole analysis.
4. When explaining a feature, always cite the evidence (file + line range) the tools returned — never assert how something works without a source pointer.
5. If a snippet in the tool output says `redacted` or is the literal string `[content redacted by AIDefence — threat or PII detected]`, say explicitly that part of the analysis was withheld; do not guess at what it might have said.
6. When asked to "build a version for my project," propose an original implementation informed by the understanding gained — not a copy of the analyzed code — and say so.
7. For a native ELF/PE/Mach-O file (for example a `.node` addon or helper executable bundled with the app), call `rure_analyze_binary` for its format, architecture, sections, linked libraries and imported/exported symbols. It inspects the container only: it does not disassemble, and it never runs the file. A non-empty `warnings` array means part of the file was malformed or out of range; report that rather than filling the gap.
8. For a managed .NET assembly (`.dll`/`.exe` with a CLR header), call `rure_analyze_dotnet` for its assembly references, types, P/Invoke native imports and string literals. It reads metadata only: no IL disassembly, nothing is loaded or run. `isManaged: false` means the file is native; use `rure_analyze_binary` instead.
9. For EVM contract bytecode (inline hex or a file), call `rure_analyze_evm` for the exposed selectors, hazardous opcodes, embedded addresses and topics, proxy status and revert strings. Report hazardous opcodes as inventory, not as vulnerabilities, and say when selector names are missing because the selector is not in the small built-in table. It cannot tell you whether anything is exploitable.
