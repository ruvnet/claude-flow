# ADR 499: ruRE in the console can read a folder outside the project that you allow

Status: Accepted (built and tested, including against the real CLI; ships in ruflo-console 0.48.0)

Date: 2026-10-24

Builds on: ADR-494 (the ruRE page), ADR-495 (the sample link check), ADR-496 (DETECT), ADR-497 (CUDA row). Settings model: ADR-450.

## 1. Context

The ruRE page analyzes only what is inside the project: the `sample` field takes a relative path with no `..`. A person who wants to look at a binary that lives elsewhere (a vendor drop, a download folder, a samples disk) had to copy it into the project first. The tools themselves read any path the process can read, so the limit is this page's. Loosening it must not let a typo, a link, or Claude's tool calls widen what is reachable.

## 2. Decision

- **A named allowlist, set by the person.** New plugin option `rureFolders`: `name=/absolute/folder` pairs separated by `;` or new lines. Each pair is checked whole and dropped, never repaired, if it breaks a rule: the name is 1-32 letters, digits, `_`, `-`; the folder is absolute (POSIX, or a drive with forward slashes), plain characters only (no spaces, `~`, `$`, `..`), at most 200, not a filesystem root or a single top-level folder (`/`, `/home`, `C:/`), at most 16 folders, first of a repeated name wins. The map has a null prototype, so `__proto__` is just a name.
- **A sample reaches a folder as `@name` or `@name/sub/file`.** The field rule gains exactly that shape and nothing else: an absolute path, `..`, an empty part, a long name or odd characters in a sample are refused as before. The rule stays pure: it knows nothing of the option.
- **The preflight resolves it.** `ActionSpec.preflight` now also receives the console's options (a same-line change in the runner, which sits at its 500-line cap). An `@name` unknown to the option is refused with the names that are allowed, or with how to allow one. Otherwise the folder itself must exist, be a folder and not be a link, and no part below it down to the sample may be a link (ADR-495's rule, rooted at the allowed folder). Then the resolved absolute path replaces the `@name` text in the one `-p` JSON argument every ruRE call carries; the rest of the row is unchanged. DETECT picks its reader from the resolved path and says `(in @name)`.
- **Who can allow a folder.** Changing a plugin option is the console's existing install-class write: `claude plugin configure … --values-stdin` with a card that shows the exact folders and always waits for the person's Yes. Claude's console tools can only propose it at the full control level (ADR-450), and `console_set` has no field for the sample or the option. Claude can therefore reach an outside folder only through a name the person already defined, and only with the rows it already has (`console_run dt-re-bin @lab/tool`).

## 3. Limits, stated plainly

- **Reading is time-of-check.** The link check and the tool's read are separate steps; a path swapped for a link in between is not caught. The same was true of ADR-495 inside the project. The tools parse and never run what they read, which bounds the harm to disclosure of what the analysis prints.
- **An allowed folder is trusted as a whole.** Everything under it that is not a link can be analyzed, by the person or by Claude's rows. Choose folders that hold only what you are willing to show Claude.
- **Windows:** folders are given with forward slashes (`C:/Users/me/samples`); a backslash form is converted. Paths with spaces are not accepted.
- **Unpacking an `.asar`** still writes to a temp folder and asks first; that row works on an allowed folder like the others.
- The option takes effect after plugins reload (`/reload-plugins`), like every plugin option.

## 4. Verification

- `tests/rure-folders.spec.ts` (22): parsing (accepted forms, 17 refusals, repeated names, count cap, prototype names, non-strings), the field rule (accepts `@name/...`, refuses an absolute path, `..`, empty parts, over-long names), resolution, the link check (missing, not a folder, folder is a link, link below, a host that cannot stat), the preflight for all seven reader rows (argv equal except the `path` value, `query` and `includeStrings` kept), DETECT, the runner (runs with the absolute path when allowed; spawns nothing when not), a real disk with a real symlink, and the install-class contract for the option write.
- `tests/rure-folders-e2e.spec.ts` (5): a real folder outside a real project, the preflight with a node-fs `stat` on absolute paths, then the chosen argv through the built CLI: an ELF read there, DETECT on a CUDA host binary, a link out refused, an unknown name and a linked allowed folder refused, an absolute sample reaching nothing.
- Console suite 3529 passed; `scripts/smoke.sh` 20/20.
