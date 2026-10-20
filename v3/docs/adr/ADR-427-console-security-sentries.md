# ADR 427: Security sentries: scheduled and real-time finders, and one that fixes in its own branch

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/loops.ts` (six presets, `sentry`, `MAX_TASK`), `hooks/views/sentries.ts` (new), `hooks/views/secure.ts` (`sendFindingsRow`, `FINDINGS_QUESTION`), `tests/sentries.spec.ts` (new).

Extends: ADR 414 (the loop manager), ADR 411 (the Claude UI bridge), ADR 426 (the self-check and visible runs).

## 1. Context

The Security page ran scans on a press and showed counts, and that was the end of it. A page showing "235 high" gave no way to hand those findings to the session that could triage them, and nothing watched the tree between presses. The loop manager (ADR 414) already starts a recurring `/loop` in the main Claude session from a preset, with the exact text shown and a confirm first, so the console needs no scheduler of its own.

## 2. Decision

### 2.1 Findings go to Claude
Under the findings meter, `✦ send findings to Claude` calls the ADR 411 bridge (quoted data, secrets removed, asks first). The page text carries only the severity counts and is capped at 4,000 characters, so the question tells Claude to read the newest report in `.claude/security-scans/` itself, group the findings by root cause, separate real defects from false positives, propose a fix for each real one, and edit nothing until the person approves.

### 2.2 Six sentries, as loop presets
A `sentry` field on a loop preset marks it; the Security page lists those as a **Sentries** section, and the Automation page's loop manager lists them with the rest. Start picks the preset and calls the loop launcher, so the person sees the exact `/loop` text and the cost before anything runs.

| Sentry | When | Does |
|---|---|---|
| live, on change | self-paced, with the Monitor tool | watches `git status` and scans on a change; reports new findings; edits nothing |
| quick scan | every 30 min | a quick code scan; new findings only |
| secrets and PII | every 4 h | `security secrets`, the last 20 commits and the tree; file and type only, never a value |
| nightly deep scan | every day | a deep scan and STRIDE threats, grouped by root cause, with what changed |
| dependencies | every day | `security cve --list`; the fixing version and what an upgrade could break; no file changed, no pull request |
| **find and fix** | every hour | the top real finding, fixed in a new `git worktree` branch `sentry/<date>-<id>`, tests run, committed there |

### 2.3 What "fix" is allowed to do
The fix sentry never pushes or merges and never edits the current checkout. Its confirm note says it edits files only in a new worktree branch and commits there, and that **the guard is the instruction, not a sandbox**: the loop runs in the main session under the person's own permission mode, so the console does not enforce it, and the text says so rather than implying otherwise. The five that only find begin `Read-only.` and end `Edit nothing.` (or `open no pull request.`).

### 2.4 Guard first, within the limit
The loop launcher cuts a task at 400 characters. A guard at the end would be the first thing lost, so each task leads with its guard, and `MAX_TASK` is exported so the spec fails on any sentry that would be cut.

### 2.5 Real time is events, not polling turns
"Real time" is a Monitor on `git status` with a turn only when files change, not a billed turn every minute. A tick every minute would be near real time at the price of a turn per tick; the cost line on the confirm row says which one a sentry is.

## 3. Alternatives considered

- **A scheduler in the console.** Rejected: ADR 414 already schedules, shows the exact text and asks. A second one would disagree with it.
- **A sentry that fixes in the working tree.** Rejected: an unattended edit of the checkout the person is using. The isolated branch costs one worktree and a `git branch -D`.
- **Durable schedules (survive the session).** Not here: `/loop` expires after seven days and lives in the session. The `ruflo-loop-workers` audit worker and `ruflo-schedule` (a cron) are the durable options and are in the loop manager already.
- **A fixed push to a pull request.** Rejected for the same reason as pushing: a person reviews the branch first.

## 4. What this does not prove

The sentry text is a prompt. The spec proves it fits, leads with its guard, and names only commands the registries run with their own flags; it cannot prove that Claude follows it, that the Monitor tool is available in the session that starts it, or that a worktree fix passes its tests. None of that has been run live. The first live check should start the quick sentry, let it tick once, and read what it reports; the fix sentry should be tried on a throwaway branch before it is left running.

## 5. Tests

`tests/sentries.spec.ts` (6): at least five watch sentries and exactly one fix; real time plus at least four distinct cadences, each a valid loop interval; every task fits `MAX_TASK` and builds a `/loop` containing the whole task; the guard is first (`Read-only.`, or `Never push or merge, never edit this checkout.` with a worktree and a `sentry/` branch) and the cost line says `edits nothing` or `never pushes` and `not a sandbox`; every `npx ruflo ...` command in a sentry is one a registry runs, with its own flags (checked by changing a flag and watching it fail, then restoring it); the secrets sentry says it never prints a value.
