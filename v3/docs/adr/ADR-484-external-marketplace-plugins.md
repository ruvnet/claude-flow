# ADR 484: External plugins in the ruflo marketplace (first: Agentic QE)

Status: Accepted

Date: 2026-10-09

Builds on: ADR-446 (the plugin fleet as mods), ADR-434 (the Plugins page detects the marketplace), ADR-411 (the plugin map)

## 1. Context

Every entry in `.claude-plugin/marketplace.json` has been a local folder, `./plugins/ruflo-*`. Agentic QE (`agentic-qe` on npm) ships a
Claude Code plugin, `agentic-qe-fleet`, from its own repository and its own marketplace: 11 QE agents, 9 skills, 9 commands, an `.mcp.json`
that runs `npx -y agentic-qe@<plugin version> mcp`, and an ADR-446-style mod (`aqe-mod`: a status file at `.claude-flow/aqe-mod/status.json`,
`/aqe-mod`, and a tighten-only `tool.call` guard that refuses destructive operations on `.agentic-qe/*.db` and `*.rvf`). Ruflo users should
be able to install it from the ruflo marketplace and see it in the console.

Two ways to list it:

1. **An external entry**: the marketplace points at the plugin's folder in its own repository, pinned to a commit.
2. **A local wrapper**: a `plugins/ruflo-agentic-qe` folder with its own `plugin.json` and a pinned `.mcp.json`.

The wrapper would carry only what it copies: the agents, skills, commands and the mod would either be copied (two sources of truth, drifting
on every AQE release) or left out (a plugin that is mostly an MCP line).

## 2. Decision

**List external plugins by a `git-subdir` source pinned to a full commit sha**, and teach the ruflo tooling that an entry may have no folder
here. The first entry:

```json
{ "name": "agentic-qe-fleet",
  "source": { "source": "git-subdir", "url": "https://github.com/proffesor-for-testing/agentic-qe.git",
              "path": "plugins/agentic-qe-fleet", "ref": "v3.15.8", "sha": "d9ce98f79a0d83db957e2e4f479ae0342bc9cf94" } }
```

Rules for an external entry:

- **Pinned.** `sha` is the full 40-character commit; `ref` names the release tag for people. Moving to a new release is a reviewed change to
  this file. `validate-marketplace.yml`, which failed on any non-string source (`Missing plugin dir: [object Object]`), now checks an
  external entry instead: a `git-subdir` with an https url, a path without `..`, a full sha and a description.
- **Smoked at the pin.** `scripts/smoke-all-plugins.mjs` checks out each external entry at its sha (shallow, blobless, into a temporary
  folder), requires its `plugin.json` to carry the listed name, and runs the plugin's own `scripts/smoke.sh` when it ships one. The step needs
  network access; `--skip-external` turns it off. `all-plugins-smoke.yml` also runs when `marketplace.json` changes.
- **Third-party code in CI is fenced** (`scripts/external-plugins.mjs`, `tests/external-plugins.test.mjs`). Only
  `https://github.com/<owner>/<repo>` sources are accepted, in both validators. The plugin folder and its `smoke.sh` must stay inside
  the checkout after links are resolved. The smoke runs with only PATH, LANG, TERM and CI from the job's environment (no GITHUB_TOKEN,
  ACTIONS_*, *_TOKEN, *_KEY or *SECRET*), a temporary HOME, and the checkout, in a temporary folder outside the workspace, as its working
  directory. `all-plugins-smoke.yml` runs with `permissions: contents: read` and checks out with `persist-credentials: false`, so no
  token sits in the workspace's git config. This is not a sandbox: the script can still read absolute paths and use the network.
  So every pin bump needs a human review of the pinned commit's `scripts/smoke.sh` (and anything it runs) before merge: a hosted
  runner cannot contain it, only keep secrets away from it.
- **Mapped in the console.** `hooks/plugin-map.ts` has a line for it like any plugin (Agentic QE: Dev Tools, beside `ruflo-testgen`), and
  `tests/plugin-coverage.spec.ts` requires a line for every external marketplace entry as well as every `plugins/` folder.
- **Read from the installed copy.** The Plugin Catalog reads a local plugin from the marketplace clone; an external one has no copy there, so
  its skills, agents, commands, `.mcp.json` and `hooks/register.ts` are read from its install path in Claude Code's
  `installed_plugins.json` (the same checked path the What's new page reads). Not installed, it is listed by its entry alone. Either way
  the row carries an `EXT` badge and the detail names where it is installed from. Ships in the next ruflo console release (version set at merge).

Nothing else needed a change: the health matrix lists installed plugins by marketplace (`agentic-qe-fleet@ruflo` is a ruflo plugin there),
the Mods section already reads any `.claude-flow/*-mod/status.json`, and the scripts that walk `plugins/*` (`audit-plugin-*`,
`check-plugin-manifests`, `mod-capability-matrix`, `probe-mod-guards`, the CLI command inventory) skip a non-string source or never read the
marketplace. They do not cover the external plugin; its own repository runs its manifest, mod and guard tests.

## 3. Evidence (Claude Code 2.1.295 on 2026-10-09; the install re-run on 2.1.296 at the v3.15.2 pin, 2026-10-10, at the v3.15.3 pin, 2026-10-11, at the v3.15.4 and v3.15.5 pins, 2026-10-12, at the v3.15.6 pin, 2026-10-13, on 2.1.300 at the v3.15.7 pin, 2026-10-15, and on 2.1.301 at the v3.15.8 pin, 2026-10-16)

- `claude plugin validate .claude-plugin/marketplace.json` passes with the entry; a `{"source":"bogus"}` source is refused.
  `claude plugin validate .` at the root fails exactly as it does on `main`, on the legacy root `.claude-plugin/plugin.json`
  (`repository` must be a string), and reports nothing about the new entry.
- In a throwaway `CLAUDE_CONFIG_DIR`: `claude plugin marketplace add <marketplace>` then `claude plugin install agentic-qe-fleet@<marketplace>`
  installs 3.15.8 into `plugins/cache/<marketplace>/agentic-qe-fleet/3.15.8` (`gitCommitSha` d9ce98f7 in `installed_plugins.json`; 7f2d091d at the v3.15.7 pin, 0fa34d24 at the v3.15.6 pin, d65ede14 at the v3.15.5 pin, bec02b13 at the v3.15.4 pin);
  `claude mcp list` shows `plugin:agentic-qe-fleet:agentic-qe: npx -y agentic-qe@3.15.8 mcp - ✔ Connected`; `claude plugin test` on the
  installed copy: 45 pass, 0 fail across 3 files (the same 45 as at v3.15.2 through v3.15.7; 11 at v3.15.0 and 22 at v3.15.1, as those releases added guard and status-file tests).
  At the v3.15.2 pin, `claude -p "/aqe-mod status"` answered from the mod, wrote `.claude-flow/aqe-mod/status.json` and reported the mod's
  version (3.15.2) and its totals across sessions; the v3.15.3 to v3.15.8 re-runs had no logged-in session, so that step was not repeated. From 3.15.2 to
  3.15.8 the plugin folder changed only its version (`plugin.json`, the mod's `hooks/version.ts`, CHANGELOG entries) and its MCP pin.

## 4. Consequences

- Ruflo does not review each AQE commit, only each pin. The pinned sha is the trust boundary: an AQE release reaches ruflo users when a PR here
  moves the pin and the external smoke passes on it.
- The AQE mod's guard is not in `probe-mod-guards` or the capability matrix, which read `plugins/` only. Covering external guards would mean
  bundling code from another repository in ruflo CI; left out on purpose.
- **Older Claude Code cannot read the marketplace at all.** Claude Code before 2.1.69 refuses the whole `marketplace.json` over this one entry
  (`plugins.N.source: Invalid input`), so `ruflo-*` plugins stop installing there too; found by bisecting `claude plugin marketplace add` across
  npm releases (2.1.68 refuses, 2.1.69 adds it). On such a client an existing `ruflo` marketplace stops refreshing (`Failed to refresh
  marketplace 'ruflo': Invalid schema … plugins.9.source`) and its installed plugins report "not found in marketplace". The line was already
  crossed on `main`: on 2.1.68, 37 of the 46 listed plugins refuse to install (`Unrecognized key: "userConfig"`), and `ruflo-testgen`, one that
  installs, fails to load (`Hook load failed`). The README requires Claude Code 2.1.287 (2026-10-01) or later; 2.1.69 is from 2026-03-04.
  A second marketplace file for external entries would avoid this, but the plugin would then be `agentic-qe-fleet@<other name>`, outside the
  console's `ruflo` health matrix, so it is not done.
- `--plugin-dir plugins/...` (the plugins README's quick start) does not load an external plugin; it installs from the marketplace only.
