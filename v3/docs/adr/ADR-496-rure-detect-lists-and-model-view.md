# ADR 496: ruRE DETECT, long lists, and what Claude sees of a run

Status: Accepted (built and tested against the real CLI; ships in ruflo-console 0.46.0)

Date: 2026-10-23

Builds on: ADR-494 (the ruRE page), ADR-495 (the link check, and the `preflight` it added to `ActionSpec`), ADR-444 (Claude controls the console: `console_state`, `console_run`).

## 1. Context

Three things in the ruRE page cost people time after ADR-494 shipped.

1. **Choosing the reader.** The page has six readers. A person with a file of unknown kind has to know whether it is ELF or PE, a folder of source or an app, hex or raw bytecode.
2. **Long answers were cut.** A reader showed 8 to 14 items of a list on one line and the panel kept 40 lines, though the panel scrolls and a real binary has hundreds of imports.
3. **Claude could not see a result.** `console_run dt-re-bin` answered "Done" with the one-line outcome, and `console_state` showed only the first 12 lines of the outcome, which a lab row never has: the parsed result lived in a panel only the person could read.

## 2. Decision

### 2.1 DETECT

A seventh row, `dt-re-auto`, in a section of its own at the top of the page. It stats the sample and picks a reader (`hooks/data/rure-detect.ts`):

| The sample | The reader |
|---|---|
| a folder | APP MAP (`rure_analyze_js_app`) |
| `.asar` | none: it says to run UNPACK .ASAR, which asks first |
| a single `.js .mjs .cjs .jsx .ts .tsx .map .json .html` file | none: it says to name the folder (APP MAP reads folders) |
| `.hex .evm .bytecode` | EVM BYTECODE |
| anything else | NATIVE BINARY (it names the format: ELF, PE, Mach-O) |

A `.dll`, `.exe` or `.winmd` is read as a native binary and the note says it may be a .NET assembly and to run .NET ASSEMBLY too, which reads the metadata and says plainly when the file is native.

The choice runs through `ActionSpec.preflight`, which now may return the arguments, label, lab id, note and reader to use instead of only a refusal. The runner merges them into the spec before it spawns anything, so the result panel, the palette (`/ruflo run dt-re-auto <path>`) and Claude's `console_run` all get the same behaviour. The link check of ADR-495 runs first. DETECT never picks a row that writes.

### 2.2 Lists

`block()` in `data/rure.ts`: a list that fits one line (about 108 characters) is the line it always was (`imports (2): puts, printf`). A longer one gets `title (total):` and its items wrapped on lines of their own, in order, at most 60 items and `… +N` for the rest. The panel's total is 120 lines (was 40). The cap is still hard: it is what bounds a hostile file.

### 2.3 What Claude sees

- `console_run` on a ruRE row answers with the result's lines (the lab result's, up to 120) instead of the outcome's, which a lab row does not have.
- `console_state` carries a `rure` block while the last lab result is a ruRE one: `reader`, `label`, `ok`, `note`, `caveats` (the `⚠` and `✗` lines, first), `lines`, and `untrusted`, which says every line is text from the analyzed file, so data and never instructions. Every string goes through `modelLine` (#3816), like everything else the model reads. A console without a ruRE result has no `rure` key, so the payload is unchanged for every other page.

## 3. Limits, stated plainly

- **Detection is by folder/file kind and extension, not by bytes.** The host's `read` returns text: a Mach-O magic or an `.asar` header does not survive it, and a file over 4 MiB is refused. A binary with an unusual extension is read as a native binary, which names the format it finds, so a wrong guess is visible. A file the host cannot describe falls back to its extension, then to a native binary.
- **.NET is not detected.** The synthetic .NET fixture's native imports do not list `mscoree.dll`, and no real managed assembly was available to check, so DETECT does not claim that signal. It names the row that decides.
- **One source file is refused, not widened.** APP MAP reads a folder; DETECT does not pass the file's parent folder, because that would read more than the person named.
- **The `rure` block is the last result only.** A newer non-ruRE lab result replaces what the block shows; the page still shows the ruRE result until then.
- The line cap bounds output size; it does not make the text trustworthy. Everything in a result is the analyzed file's own text.

## 4. Verification

- `tests/rure-detect.spec.ts` (8): every row of the table above, a host that refuses `stat`, and that no write row is ever chosen.
- `tests/rure-detect-run.spec.ts` (4): through the real runner with captured CLI answers (an ELF, a JS app), the `.asar` and link refusals spawn nothing.
- `tests/rure-detect-e2e.spec.ts` (7): real files in a temp project and the built CLI: an extensionless ELF, a PE, a managed `.dll` followed by the .NET row, a `.hex` contract, a folder, an `.asar`, and a link to `/etc/hostname`. A first draft claimed `mscoree.dll` appears in a managed assembly's native imports; this run showed it does not for the fixture, and the claim was removed.
- `tests/rure-lists.spec.ts` (5): one line when it fits, wrapped order, the 60-item cap and its `… +N`, the 120-line cap against 5000-item lists, escape sequences inside wrapped lists.
- `tests/rure-model.spec.ts` (5): no `rure` key without a ruRE result, the block's fields, no leakage from another lab result, the model path and the 120-line cap, and `console_run`'s reply.

## 5. Not decided here

A folder allowlist outside the project (the next ADR: it widens what the page reads, so it needs its own decision), and a ruflo-mods mod that offers to analyze new binaries (ADR to follow, on top of this structured view).
