---
name: analyze-app
description: Statically inspects a local JavaScript or Electron application you're authorized to study, explains how a feature works with file+line evidence, and helps build an equivalent for your own project. Use when the user wants to understand or reimplement a feature from an app whose source they have (their own app, a licensed target, or an explicit research/CTF context). Parses only — never executes the target.
allowed-tools: Read
---

# Analyze App (ruRE Phase 1 — JS/Electron static analysis)

Uses the ruRE tools (server `ruflo-rure`): `rure_extract_asar`, `rure_analyze_js_app`, `rure_find_feature`.

**Authorization check — do first, every time.** This skill is for understanding and reimplementing functionality you're authorized to study: your own application, a target you've properly licensed, or an explicit CTF/security-research context. If that isn't clearly the case, say so and stop before calling any tool. Refuse requests aimed at circumventing DRM, license checks, anti-tamper mechanisms, or paid-feature gates — reframe or decline those, don't attempt a workaround.

1. If the target is a packaged `.asar` file, call `rure_extract_asar` first and use its `unpackedPath` for the next step. If `truncated: true` came back, the archive exceeded the size/file-count cap — tell the user and stop; do not attempt a partial analysis.
2. Call `rure_analyze_js_app` on the directory. This returns modules, an import/export graph, and Electron process-boundary findings (main vs. renderer, `ipcMain`/`ipcRenderer`/`contextBridge` usage) — every finding carries a file + line-range evidence pointer.
3. If the user described a specific feature, call `rure_find_feature` with that description to narrow down where it likely lives, rather than reading the whole analysis.
4. When explaining a feature, always cite the evidence (file + line range) the tools returned — never assert how something works without a source pointer.
5. If a snippet in the tool output says `redacted` or is the literal string `[content redacted by AIDefence — threat or PII detected]`, say explicitly that part of the analysis was withheld; do not guess at what it might have said.
6. When asked to "build a version for my project," propose an original implementation informed by the understanding gained — not a copy of the analyzed code — and say so.
