# ADR 463: Workflows page: worktree manager, workflow templates, Anatole per agent

Status: Accepted

Date: 2026-10-05

Builds on: ADR-458 (the page), ADR-464 (its slot seams), ADR-453 (Project Anatole), ADR-450 (bounded reads, confirm-gated verbs)

## 1. Context

Workflow runs create git worktrees (one writer per worktree is the repository's rule), and nothing on the Workflows page says which
exist, which are finished with, or who made them: on the development machine there are over a hundred. Reusable workflow shapes
(review, migrate, research, build-tune-review) are retyped as prompts each time. Project Anatole's protector writes alerts, and the
console's Security page shows them, but not against the run and agent that were running when they fired.

## 2. Decision

Three features, each a module that plugs into the page through the ADR-464 slots and edits no shared file.

**Worktree manager** (`data/wf-worktrees.ts`, `views/wf-worktrees.ts`).

- Reads are `git -C <dir> ...` with a fixed argv, byte-capped and never through a shell: `worktree list --porcelain`, `status --porcelain=v1`,
  `rev-list --left-right --count origin/main...HEAD`, `log -1 --format=%ct origin/main`. Age is the mtime of the worktree's `.git` link
  (a fresh worktree has an old HEAD commit, so the commit date would lie). Nothing is fetched: the page says how old the local
  `origin/main` is. Which run and agent made a worktree comes from the agent's recorded worktree path, else from a directory or branch
  named `agent-<id>`; otherwise it says "not attributed".
- A probe that fails or answers nothing is an unknown, and an unknown can never make a worktree removable.
- One confirm-gated action, "remove merged-and-clean worktrees". A worktree qualifies only if all hold: not the main worktree; not the one
  the session works in; not locked, bare or prunable; under the main worktree's `.claude/worktrees/` or `.git-worktrees/`; zero changed or
  untracked files; zero commits outside `origin/main`; at least a day old; no agent of a read run still running in it; and no live process
  with the path as cwd, exe or an open file descriptor. The process check is `find /proc -maxdepth 3 ... -lname '/*' -printf '%p\t%l\n'`
  (read-only, own processes only, said on the page). It fails closed: if it sees fewer than three working directories it is treated as blind,
  and a blind check plans nothing. (The nightly cleanup once fell from 88 detected roots to 1 inside a mount namespace while every other
  guard still passed; the floor is that lesson.) The check must be under two minutes old to plan a removal.
- The confirm card lists exactly the commands: `git -C <main> worktree remove <path>`, at most ten per confirm, declared `delete`, never
  `--force`. After the confirm, each target is read again from scratch (list, status, ahead, age, processes, the session's own directory)
  and removed one at a time only if it still qualifies; git itself refuses a dirty or locked one. Branches are never deleted. The outcome
  panel names what was removed and what was kept and why, and `verified` says whether the list no longer holds the path.
- The timer read (at most one a minute, while the page is open, never while it is closed) skips the process listing; the read button
  and the removal do it.

**Templates** (`data/wf-templates.ts`, `views/wf-templates.ts`). Four templates as data: phases (each with an agent count, fixed or taken from
an int parameter), parameters (text, int in a range, choice), and rules every prompt carries (a worktree per writer, never push, report real
results only). The dry run counts agents and phases, the widest phase, and a ceiling of 40 agents; it states that tokens, time and cost are
not estimated, because nothing measured them. Launching builds a prompt (the person's text as quoted data, control characters stripped,
credential-shaped text masked) and sends it through the console's existing path: a visible prompt, or the prompt box mid-turn. The confirm
card shows the whole prompt, declares `spend`, and says the agents it spawns cost money.

**Anatole per agent** (`data/wf-anatole.ts`, `views/wf-anatole.ts`). The console's alert parser drops the `session` the mod writes, so the
log is read again through the same bounded, regular-file-only reader and the same per-line validation, keeping the session (and an agent id,
should a later mod version add one). A run's directory names its session. An alert is matched in steps and each row says which matched:
the mod named the agent; the alert is from the run's session and time span and exactly one agent was running then; or only the run. An
alert with no session, another session, no time, or a time outside every run of its session is "not attributed", and a run with no known
start never matches. The board shows per agent the blocked and notified counts, the rules that fired with their mode now (the person's
override, else the default), and an inspector tab lists one agent's alerts, masked and stripped. Everything is labelled as reported by the
mod and unauthenticated.

**The console cannot stop or message a running workflow.** (Amended by ADR-465: the control tab can, through the engine's own TaskStop and SendMessage.) None of the three adds such a button; the page's own line saying so (ADR-464)
stays, and a worktree whose agent is running is kept with that reason instead of a disabled button.

## 3. Consequences

- Worktree clean-up becomes a listed, reviewable, per-target-verified action instead of a shell loop. The cost is up to 3 git calls per
  worktree per read (at most 40 probed, six at a time) and one 0.5 s `/proc` listing on the read button and on removal.
- The check sees only the user's own processes; a worktree used by another user's process is not seen. The page says "your own processes only".
- A squash-merged branch has commits outside `origin/main`, so it is kept: "merged" here means HEAD is inside `origin/main`, which errs
  toward keeping.
- The three features reach the page through notice slots as their refresh trigger (the seam that runs after each read while the page is open).
  That works, but a first-class refresh seam would be cleaner; see Gaps.
- Anatole matching is time-and-session based because the alert schema has no agent: most alerts will land at "during this run", and that is
  what the page says.

## 4. Test and benchmark plan

- `tests/wf-worktrees.spec.ts` (parser, process check, rules, plan, probes), `tests/wf-worktrees-view.spec.ts` (board, confirm card, the
  removal's per-target re-check, slots), `tests/wf-templates.spec.ts`, `tests/wf-anatole.spec.ts`, `tests/wf-extras-page.spec.ts` (all three
  on the real page). Run each with `npx vitest run plugins/ruflo-console/tests/<name> --testTimeout=30000`.
- Mutation checks: the one-day age boundary, the two-minute freshness boundary, the blind-process floor, the current-worktree guard, the
  ahead threshold, the re-check before removal, the exactly-one-agent window, the run time span, the int clamp, the agent ceiling, the
  credential mask in the alert tab.
- Benchmark: the `/proc` probe on the development machine prints 11.8k lines (0.8 MB) in about 0.55 s; the list of 160 worktrees takes
  8 ms. Re-measure if the probe's filter changes.

## 5. Rollback

Remove the three `import` lines from `views/wf-register.ts` and the three `wireWf*` calls: the page returns to the board alone. The modules
write nothing at import except registering slots; the one write they can make (`git worktree remove`) happens only after a confirm. A removed
worktree's branch is intact, so `git worktree add <path> <branch>` restores it (a worktree with any changed or untracked file is never removed, but files git
ignores, such as build output, go with the directory).
