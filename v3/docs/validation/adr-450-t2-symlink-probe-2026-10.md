# ADR-450 T2: what the engine does with a link, FIFO or folder named status.json (2026-10-05)

Probe of the live Claude Code engine (the `$.fs` file API mods and the console use), run to settle the one open question in the [T2 triage](adr-450-open-items-triage-2026-10.md).

## Method

A throwaway plugin (outside the repo, in a private `mktemp` directory) registered a `/t2probe` command whose handler called `$.fs.stat`, `$.fs.read` and `$.fs.list` on `<project>/m/<case>/status.json` and returned what each gave. Run with `claude -p "/t2probe a b c d" --plugin-dir <plugin> --model haiku` from the scratch project. Every target was a scratch file; nothing under HOME or a system path was touched. Reads were raced against a 4 s timeout.

## Observed (exact)

| Case | `stat` | `read` | `list` of the folder |
|---|---|---|---|
| a. regular file | `{"kind":"file","size":28,"isLink":false}` | 28 chars | `{"kind":"file","size":28,"isLink":false}` |
| b. symlink to a file inside the project | `{"kind":"file","size":34,"isLink":true}` (the target's kind and size) | **34 chars, the target's content** | `{"kind":"other","size":0,"isLink":true}` |
| c. symlink to a scratch file **outside** the project | `{"kind":"file","size":30,"isLink":true}` | **30 chars, the outside file's content** | `{"kind":"other","size":0,"isLink":true}` |
| d. folder named status.json | `{"kind":"dir","size":4096,"isLink":false}` | rejected: `EISDIR` | `{"kind":"dir","isLink":false}` |
| e. FIFO named status.json | `{"kind":"other","size":0,"isLink":false}` | returned `""` at once, no block (4 s timeout not hit) | `{"kind":"other","size":0,"isLink":false}` |

## Proven

- `$.fs.read` follows a symlink, including one that points outside the project. The hole in T2 was real for links.
- `$.fs.stat` follows the link for `kind` and `size` but reports `isLink: true`; `$.fs.list` reports a link as `kind: "other"` with `isLink: true`.
- A folder is refused by `read` (EISDIR). A FIFO read did not hang in this run.
- The console's `ReaderFs.stat` type declared only `{ mtimeMs?, size? }`, so `kind` and `isLink` were present at runtime and dropped by the type. The triage's "no lstat" was right about the type, wrong about the engine.

## Fix (console 0.33.16)

The brief suggested the `fs.list` kind. `stat` is used instead because `readBounded` already calls it per file: no extra call per mod folder, and `isLink` states the thing directly. `readBounded(..., regularOnly)` returns `not-regular` (and drops any cached copy) when stat says `isLink === true` or a `kind` other than `file`; `readMods` passes it for `status.json` only, and such a row is counted as refused ("N status files not shown"). When the engine says nothing about the kind (older engine, test fakes) the file is read as before. Other console files are unchanged: they are ruflo's own state, and some may legitimately be links.

Console drive (seeded project: a regular `good-mod`, a `link-mod` linking to a file claiming calls 99 / blocked 7, a `fifo-mod`): the Room page showed `Mods … 1 reporting`, `[ ▸ good ] guard on · calls 3 · blocked 0`, and `2 status files not shown: an unknown shape, too large, or unreadable`. The linked file's numbers did not appear.

## Not proven

- Only one engine version and Linux were probed. macOS and Windows link semantics, and junctions, were not.
- The FIFO read returning `""` is one observation of a read with no writer; whether another engine version blocks is unknown. The guard no longer reaches `read` for a FIFO either way.
- A race (a file swapped for a link between `stat` and `read`) is not closed; the window is one poll and the content is still capped and shape-checked.
- Other mods' writers (`$.fs.write` to their own status path) were not probed for link behaviour.
