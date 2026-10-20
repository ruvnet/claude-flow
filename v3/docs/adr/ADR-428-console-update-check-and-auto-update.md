# ADR 428: The console offers a newly published version at load, and can keep itself up to date

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/updates.ts` (new, pure), `hooks/update-flow.ts` (new), `hooks/host.ts` (`fetchText`, `askChoice`, `toast`), `hooks/register.ts`, `hooks/bindings.ts` (`updates`, `checkUpdates`), `hooks/views/settings.ts` (an Updates row), `hooks/state.ts` (`updates`, `updateNote`, `updateAvailable`), `.claude-plugin/plugin.json` (the description), `tests/updates.spec.ts` (new).

Extends: ADR 407 (the cockpit), ADR 426 (the build id: a development checkout is recognised by it).

## 1. Context

The console ships through the `ruflo` marketplace (GitHub `ruvnet/ruflo`). A person gets a new version only by remembering `claude plugin marketplace update` and `claude plugin update`, then restarting, and nothing says a version has been published. The result is people on stale builds reporting things already fixed. The owner asked for the console to say so at load, with a yes, and for an "always auto-update".

## 2. Decision

### 2.1 What it checks, and when
At session start, a couple of seconds after the screen has settled and once the build is known, the console reads the published `plugins/ruflo-console/.claude-plugin/plugin.json` on `main` (one small request through the host's `$.http.fetch`, so an administrator's policy can refuse it) and compares its `version` with the one running. It does so at most once a day (the time is kept in the plugin's store, shared by sessions), and never in a non-interactive `-p` run (nobody to ask), nor in a development checkout (a session loaded from a git worktree updates with git; the build id of ADR 426 says which).

It accepts the manifest only if its `name` is `ruflo-console` and its `version` is a plain `major.minor.patch`, and offers only a **strictly newer** one: never the same, an older one, or a pre-release.

### 2.2 The offer
Claude Code's own choice dialog (`$.ui.ask`): **Update now**, **Always auto-update**, **Not now**. The question says what it will run (`claude plugin marketplace update`, then `claude plugin update`), that it takes effect after a restart or `/reload-plugins`, and what "Always" means: every new minor or patch version published to `github.com/ruvnet/ruflo`, installed without asking, a new major version still asking, and where to turn it off. A new **major** version is offered without an Always choice. Dismissing the dialog, or typing under Other, installs nothing.

### 2.3 "Always auto-update"
A mode, `ask` (the default), `auto` or `off`, kept in the plugin's store and set in **Settings → Updates**, where a **check for an update now** button also lives (it ignores the daily limit and an off setting, because the person asked, but it still asks before installing, and still skips a development checkout). In `auto`, a minor or patch version is installed without a question, with a toast before and after; a major version asks.

This departs from a rule the console keeps elsewhere: an action that reaches the network never offers "Always allow" (as the Settings page says of its remembered actions). It is a deliberate, requested exception, kept narrow: strictly newer only; never across a major version; only from the marketplace the plugin was installed from; installed by Claude Code, not by this code; one setting turns it off.

### 2.4 The install is Claude Code's
The console never downloads or runs the new code. It runs `claude plugin list --json` (to find the scope the plugin is installed in), `claude plugin marketplace update ruflo`, then `claude plugin update ruflo-console@ruflo --scope <that scope>`, and then lists again. It **never passes `-y` or `--accept-command`**: if a marketplace declares a command, Claude Code refuses to run it unattended and asks a person; the console reports that and gives the command to run by hand. It does not call the update installed unless the list afterwards shows the new version; otherwise it says what the list shows and to check `/plugin`.

### 2.5 Several sessions
A person runs many sessions. The check time is shared, so a second session starting soon after the first does not ask again; a session that begins installing records the time, and others hold off for ten minutes; a version that has been installed and is waiting for a restart is not offered again. The store is not atomic, so this narrows a race, it does not remove one.

## 3. Alternatives considered

- **Check by running `claude plugin marketplace update` first.** Rejected: it pulls the whole `ruvnet/ruflo` repository to learn a version number, every day, in every session. One small file is the same information.
- **Fetch with `curl`.** Rejected: not on every machine, and it would be the plugin's own network, outside the host's policy.
- **Install by fetching and unpacking the new files ourselves.** Rejected outright: it would bypass Claude Code's trust model for plugin code, which is the thing a marketplace install gives.
- **`auto` as the default.** Rejected: the person chooses it, once, with the words that say what it does.
- **Check off by default.** The owner asked for the offer at load, so the default is `ask`. This changes what the plugin's description used to say ("no network by default"); the description now names the one request and where to turn it off.

## 4. What this does not prove

The pure rules and the whole flow are tested with fakes (no host, no network): when it looks, what it asks, what it runs, what it refuses. Not tested, because it cannot be here:

- **Whether the choice dialog can be shown a couple of seconds after session start.** If the host refuses it, the call rejects and the console treats that as "not now": no update, no error. The first live run should confirm the question appears.
- **Whether `claude plugin update` accepts `--scope` as written and whether `claude plugin list --json` carries the version for a plugin installed from this marketplace on every version of Claude Code.** The flow reads the list back and says so when it does not match, rather than assuming.
- **A light theme.** Not related to updates; see ADR 429.

## 5. Tests

`tests/updates.spec.ts` (33):

- **Rules:** a version is only `major.minor.patch`; a bump is patch, minor or major and never a downgrade, a pre-release or garbage; the manifest is ours or null; the daily gate, including a stored time in the future; another session updating holds off for ten minutes and no longer; `off` does nothing, `auto` installs minor and patch but asks for a major, and anything not exactly `auto` or `off` is `ask`; the question ends in a question mark, names the repository and what Always means, and has no Always for a major version; the installed list prefers the user scope, then an enabled entry, and ignores other plugins.
- **Flow:** does not even look when off, non-interactive, or a development checkout; at most once a day; skips a version already installed; fails quietly, and tries again next time, when GitHub cannot be reached, hangs (on the host's clock, not `setTimeout`), or sends something that is not our manifest; never throws, even when the store does; Not now, a dismissed dialog and typed text install nothing; Update now runs exactly the list, the marketplace update, the plugin update in the installed scope, and the list; Always turns auto on and installs; auto installs without asking and toasts; auto still asks for a major version, and "Always" cannot be taken for one; "check now" ignores the gate and off but asks and skips a development checkout.
- **What it will not do:** no `-y`, `--yes` or `--accept-command` in any run (checked by adding `-y` and watching two tests fail, then restoring it); Claude Code's own confirmation is reported with the command to run; it does not say installed when the list still shows the old version; it has nothing to update, and says why, when the plugin is not installed from the marketplace (a `--plugin-dir` session); it stops, saying why, when the marketplace will not update; and it always releases the other sessions, whether the install worked or not.

## Update 2026-10-07: what the code does now, and who reads its state

Checked against `plugins/ruflo-console/hooks/{updates,update-flow,register,state}.ts`. The decision above stands. Four things in the
text are behind the code, and one new reader of the state exists.

**Drift from sections 2.1 to 2.4**

- **A long session re-checks.** `register.ts` starts a timer every `RECHECK_EVERY_MS` (6 hours, `updates.ts`) that runs the check in
  `quiet` mode. A quiet check never opens the dialog in the middle of someone's work: when the answer would be "ask", it only notes the
  newer version, once per version (the store key `ruflo-console/update-notified`), as an `info` toast and as the band link to Settings, and
  it leaves the daily gate open so the next session start asks properly. In `auto` mode the quiet check installs as before. The daily
  gate in 2.1 applies to the re-check too (it returns `checked in the last day` when the gate is closed). Because a quiet note leaves the
  gate open, a session that has a newer version pending and unanswered fetches the manifest again on each 6-hour tick until the person
  installs, declines for good (`off`) or the version is installed; when nothing newer exists the gate closes and the ticks do no network work.
- **Every install that is behind is updated, not one scope.** Section 2.4 says one `claude plugin update ... --scope <that scope>`.
  `applyUpdate` now lists every install that applies to the session (the user one and the project's, `installedEntries` in `updates.ts`),
  and runs `claude plugin update ruflo-console@ruflo --scope <s>` for each scope whose version is behind; one already at the new version is
  left alone. The rest of 2.4 is unchanged: still no `-y` or `--accept-command`, still not "installed" until the list afterwards shows the
  new version in every scope (otherwise the result is `unverified` and says what the list shows).
- **Where the setting lives.** "Settings → Updates" in sections 2.3 and 2.4, and in the toast text, is the Updates row, which is now inside
  the section **Interface & updates** (ADR-407, update of 2026-10-07). The toast still says "Settings → Updates".
- **The toasts go through ADR-477.** The toasts in 2.3 and in the flow are no longer direct `$.ui.toast` calls: `host.toast` runs them
  through the shared policy, so they obey the person's Toasts setting and are recorded on the Events page whether drawn or not. Levels:
  "is available" and "Updating" are `info`, "installed" is `ok`, any other result is `warn`. With toasts set to `off` or the console muted,
  the quiet note is therefore silent, but the band link and `state.updateAvailable` still show it.

**The state, and its readers.** A check leaves these in the console's state (`state.ts`, set in `runUpdateCheck`):

- `updates`: the mode (`ask`, `auto`, `off`);
- `updateNote`: the one line Settings shows for the last result (`result.detail`);
- `updateAvailable`: the version a declined or quiet-noted check found, or `''`. It is set when the outcome is `declined` and cleared
  when the outcome is `installed`, `current` or `unverified`; a `skipped` or `failed` check leaves it as it was.

The store (shared by sessions) keeps `update-checked-at`, `update-applying-at`, `update-installed` and the notified version.

The What's new page (ADR-478) reads this state to say whether a newer version is published, and adds no request of its own: the
only network call in the update flow is the one `fetchText(MANIFEST_URL)` in `update-flow.ts`, a small file that holds `name` and
`version` and nothing else (`versionFromManifest` accepts nothing more), so the page cannot get release notes from this check and does not
try to. That the page makes no call of its own is ADR-478's side of the contract: its code holds no `fetchText`, `httpSend`, `run` or `spawn`
(`plugins/ruflo-console/scripts/smoke.sh` step 18), and the page's "check for an update now" button is `act.checkUpdates`, this flow's own forced
check. The band's `⬆ version available` link still goes to Settings, not to What's new.
