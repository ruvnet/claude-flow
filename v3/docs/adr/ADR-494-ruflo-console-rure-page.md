# ADR 494: ruRE in the ruflo console: a TOOLS page for static reverse engineering

Status: Accepted (built and tested against the real CLI; not yet released: the `rure_*` tools are in `main` after 3.59.17)

Date: 2026-10-23

Builds on: ADR-442 (the Sandbox page: a page whose rows are Dev Tools entries), ADR-480 (the ADRs page: a TOOLS page and its wiring), ADR-489 (`ruflo tui` parity table).
Related: ruflo-rure ADR-0001 (scope and dual-use policy), ADR-0002..0005 (the six tools), ADR-407 (the cockpit).
Number note: 492 and 493 are claimed by open drafts (#4253, #4264); this ADR takes 494.

## 1. Context

ruflo-rure (plugin 0.4.1) gives agents six read-only static-analysis tools: `rure_extract_asar`, `rure_analyze_js_app`,
`rure_find_feature`, `rure_analyze_binary` (ELF, PE, Mach-O), `rure_analyze_dotnet` and `rure_analyze_evm`. A person using `/ruflo` could
not reach any of them: the console only filed the plugin under Devtools in `hooks/plugin-map.ts`. Claude could call them as MCP tools,
the person could not look at the result without asking Claude.

The console already has the machinery for this. The Sandbox page (ADR-442) is a page of its own whose rows are Dev Tools entries: they
share the confirm gate, the palette ids (`/ruflo run dt-...`, so Claude reaches them through `console_run`), the self-check and the
result panel. The ADRs page (ADR-480) is the model for registering a TOOLS page.

## 2. Decision

Add a **ruRE** page to the TOOLS group, built the way the Sandbox page is.

- **Rows.** Six entries joined to the Dev Tools catalog (`DEV`), ids `dt-re-asar`, `dt-re-js`, `dt-re-find`, `dt-re-bin`, `dt-re-net`,
  `dt-re-evm`, each one `ruflo mcp exec -t rure_* -p {...}` with fixed argv. Two sections: JavaScript and Electron apps, and native
  binaries, .NET and EVM. The page draws them; Dev Tools does not (like the Sandbox groups).
- **Cost classes.** The five analysis rows are local `$0` reads and run at once. UNPACK .ASAR writes files to a new temp folder outside
  the project, so it is a `write`: it asks first and its note says where the files go.
- **The sample is a path inside the project.** A new `sample` field takes the same rule as the existing `path` field: relative, a plain
  character set, no `..` segment, no empty segment, at most 160 characters. An absolute path, a flag-like name, a control character or
  anything outside the project builds no argv. FIND FEATURE also takes the existing `query` field (the feature, in words).
- **Enter** in a ruRE field runs that page's row (APP MAP, FIND FEATURE, NATIVE BINARY) and not the row the same field runs elsewhere
  (`query` still runs the plugin search on its own page). This is a per-group submit table in `devtools.ts`.
- **Readers.** `hooks/data/rure.ts` turns each tool's answer into lines: format, entry, libraries, imports, exports, sections and
  strings for a native file; identity, references, types, P/Invoke and literals for .NET; selectors, hazards, events, proxy and compiler
  for EVM; boundaries and imports for a JS app; matches with their first line for a feature search; the unpack path for an .asar. The
  parser's own warnings, a cut walk and anything AIDefence held back or could not screen come first.
- **A CLI without the tools** says so: `mcp exec` answers "Tool not found", and the page prints `update ruflo` instead of the generic
  failure (the tools are in `main` after 3.59.17).
- **Terminal host.** `ruflo tui` lists the page as `partial` and read-only, like every page with actions (`tui/parity.ts`, ADR-489's table).
- **No new MCP tool, no new CLI command, no change to the six tools.** The page is a surface over what exists.

## 3. What the page treats as hostile, and how

Every value in an answer is the analyzed file's own text (section names, imports, type names, strings, a matched line).

1. **Terminal escapes.** The tools return such text intact (a section name holding `ESC[31m` and an OSC 52 clipboard sequence comes back
   JSON-escaped, and parsing the JSON makes the characters real). Every string passes `plain()` before it is a line: no escape, control,
   hidden or bidi-override character reaches the terminal. Numbers are shown only when they are plain measurements: a hostile `1e300` reads
   `n/a`, it is not clamped into a plausible count (#3822). The panel shows at most 40 lines.
2. **Reading outside the project.** The tools accept any path the process can read (a known gap, ruflo-rure changelog). The page does not
   widen it: the `sample` field refuses what is not a project-relative path, and Claude reaches the rows only through the same field.
3. **A row run by Claude.** `/ruflo run dt-re-bin <path>` goes through the same field rule and the same confirm gate; a read of an
   in-project file needs no confirm, as with every Dev Tools read; the unpack asks.
4. **The files are never run.** The tools parse. Dynamic analysis (attaching to or instrumenting a process) is out of scope and needs its
   own consent-and-sandbox ADR first (ruflo-rure ADR-0001).

## 4. Limits, stated plainly

- The path rule is **syntactic**. It stops an absolute path and `..`. A symlink inside the project that points outside is followed by
  the tool's open of the top-level file; the page does not resolve links. (Directory walks inside the tools skip symlinks.) Keep samples
  you do not trust in a folder of their own.
- The unpacked folder of an .asar is **outside the project**, so the page cannot read it: it says so and tells the person to copy it
  under the project. The tool does not clean that temp folder up; the page does not either.
- Only files inside the project can be analyzed from the page. A binary installed elsewhere has to be copied in (or analyzed by Claude
  through the MCP tools directly).
- EVM and P/Invoke handling in the tools were validated on built fixtures and not on compiled-from-source contracts or real P/Invoke
  assemblies (ruflo-rure changelog). A hazardous opcode is an inventory fact, not a finding.
- The standalone terminal host shows the page read-only; its actions are asked for by name.

## 5. Consequences

The console gets a real surface for ruRE with no new trust: the same field rules, confirm gate and result panel as Dev Tools. The cost is
one more page (33 areas in the boot log, a keyless TOOLS page) and a `sample` field in the shared field set.

## 6. Verification

- `tests/rure-page.spec.ts`: the catalog against the tools' real input schemas; what `sample` refuses; each reader against the
  **real captured CLI output** in `tests/fixtures/rure/` (ELF, PE, Mach-O, .NET, two EVM contracts, a JS app, a feature search, an
  unpacked and a failed .asar); a hostile answer in every reader; the page, its guide, its nav and menu entries; palette ids and Enter
  routing.
- `tests/rure-e2e.spec.ts`: builds real files (the ruflo-rure fixture builders, an .asar made with `@electron/asar`) in a temp project and
  runs every row's exact argv through the **built CLI**, then reads the output with the console's reader. It includes a binary whose
  section name carries terminal escapes, a missing file, a path outside the project (no argv), and a CLI without the tools. It skips with
  a message when the CLI is not built. With `plain()` removed from the reader, both the unit and the e2e hostile tests fail.
- `tests/devtools.spec.ts` gained the six tools' schemas, so the catalog invariants (a `mcp exec` call names a real tool and only declared
  parameters; reads run at once, everything else asks and says what it does) cover the new rows.

## 7. Not decided here

A "detect the type for me" row that picks the tool from the file's first bytes; an allowlist of folders outside the project; resolving
symlinks before a sample is accepted; showing the page in the terminal host with its buttons; calling the tools with inline EVM hex from
a field. Each is a change to the rule in section 3 and needs its own decision.
