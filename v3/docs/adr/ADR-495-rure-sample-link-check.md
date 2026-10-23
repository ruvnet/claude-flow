# ADR 495: ruRE refuses a sample that is a link

Status: Accepted (built and tested; ships in ruflo-console 0.45.2)

Date: 2026-10-23

Builds on: ADR-494 (the ruRE page). Closes the first limit in its section 4 and the "resolving symlinks before a sample is accepted" item of its section 7.

## 1. Context

ADR-494 keeps the ruRE page to files inside the project with a text rule on the `sample` field: relative, a plain character set, no `..`
segment. The `rure_*` tools open the top-level file they are given and follow a link there, so a link inside the project that points
outside it (`app/tool -> /etc/shadow`, or a folder `app -> /home/other`) passes the text rule and is read. ADR-494 stated this as a known
limit. Nothing about the page or Claude's `console_run` changed what is reachable; the gap is that "inside the project" was a claim about
the text of a path, not about where it lands.

## 2. Decision

Walk the sample on disk before any ruRE row runs, and refuse when any part of it is a link.

- **Where.** A general `preflight` on `ActionSpec` (hooks/actions.ts): an async check the runner awaits before it launches anything, for a
  read that runs at once and for a confirmed action alike. A reason becomes the result panel and the one-line outcome; nothing is spawned.
  `devSpec` sets it on every row of the ruRE groups once a sample is present.
- **What it checks.** `sampleLinkCheck` (hooks/data/rure-guard.ts) takes the sample's parts from the project folder down and calls the
  host's `stat` on each prefix. A part that is a link (`isLink`, or a `symlink`/`link` kind) refuses with that part named and the way out:
  copy the file into the project and name the copy.
- **A part that is not there is fine.** The tool answers "not found" itself, and the page's text for that is already readable.
- **A host that cannot stat answers like a missing part.** This is the convention `checkNoLinks` uses for writes. The check narrows what
  runs; it does not widen it, and it is not the only layer (the text rule and the confirm gate stay).
- **Same path for Claude.** `/ruflo run dt-re-*` and `console_run` build the same spec, so they get the same refusal.

## 3. Limits, stated plainly

- It depends on the engine's `stat` reporting a link as a link (`isLink`). That is what `checkNoLinks` already relies on for the write
  paths; if a host's `stat` follows links silently, this check cannot see them and the text rule is all there is.
- It is check-then-open. A link swapped in between the check and the tool's open is not caught. This needs a second writer inside the
  project inside that window.
- It covers the top-level file and the folders on the way. The tools skip links inside a directory walk themselves (ADR-494 section 4).
- It does not make a path outside the project reachable; that is a separate, wider decision.

## 4. Verification

`tests/rure-symlink.spec.ts`: a regular file and a missing path pass; a link as the sample, a link as a folder on the way (the walk
stops at it), `symlink` and `link` kinds, and `.`/empty parts; a host whose `stat` rejects; every ruRE row carries the preflight and no
other row does; and the runner on a link spawns nothing and shows the reason (the test fails with the runner change removed).
