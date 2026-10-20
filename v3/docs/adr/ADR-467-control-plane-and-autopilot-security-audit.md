# ADR 467: Security audit of the control plane, the bridge and the autopilot

Status: Accepted

Date: 2026-10-06

Builds on: ADR-465 (control plane and multi-model bridge), ADR-466 (mission autopilot), ADR-453 (Project Anatole)

## 1. Context

ADR-466 stores the autopilot's envelope, its journal and its kill flag under `.claude-flow/console/autopilot/` in the project. Every
step the autopilot starts runs as the session, with the session's file permissions, and can write there. The envelope's hash is not a
MAC (whoever can write the file recomputes it), and ADR-465's bridge sends text and a key to hosts named by an option string. An
adversarial pass over the merged tip found real defects, each proven by a test that fails without its fix:

- Envelope, journal, kill flag and Anatole's status were reachable by steps; a forged `start` line, an envelope rewritten with a
  matching hash, or a deleted `stop` line resurrected or widened a stopped loop.
- The envelope's `verify` argv ran through the host's process API, outside the engine's permission check (launders a deny), and could be
  a shell, `rm`, `curl` or `npm publish`.
- The kill flag was read once at the start of a tick; a verify run of minutes left the hand-over unguarded. Two sessions on one project
  could both hand over the same step. A step lost to a restart was retried automatically although it may have run.
- Task classification matched raw text: a zero-width character split `publish`; a second path, `~/`, `$HOME` or `..` bypassed the
  folder gate; `push`/`install`/`upload` ran under a milder class. Anatole counted as "on" from a stale or failed-open status file.
- A forged adaptation receipt tuned the loop (the chain was drawn but not enforced).
- Base URLs allowed link-local and metadata hosts and any `100.x`; a key variable could name any credential; the confirm card cut a
  payload at 700 characters while sending all of it; a relayed reply was framed so its own quote could pose as the person; credentials
  split by zero-width characters survived masking at parse time; a poll answer was parsed at any size; a pre-made archive name could
  make journal rotation discard the old journal.

## 2. Decision

1. **The approval pin (new invariant).** What the person confirmed is remembered outside the project folder: the envelope hash, the
   count of `start` lines and whether a stop was recorded (`data/ap-pin.ts`), in this process and in the host store (`$.store`, key
   `autopilot-pin:<cwd>`). Every tick compares the folded journal to the pin; a different hash, another start count, or a running
   journal after a recorded stop stops the loop. A readable store that holds no pin for a running journal also stops it.
2. **Steps cannot be pointed at the loop's own files.** `.claude-flow/console` and `.claude-flow/protector-mod` are protected: an
   envelope naming them is invalid, `pathAllowed` refuses them, and a task naming them (or the kill flag) is the `envelope-edit` hard
   deny, which "approve once" never lifts.
3. **Verify commands** may not be shells, wrappers, destructive or network tools, carry shell metacharacters or name a hard deny; each
   is asked of the engine as the Bash call it is and runs only on `allow`. The Start card lists every argv, repo and variable name.
4. **Hand-over re-check.** Immediately before a step is handed over: the kill flag, the in-memory phase, and the journal (read within
   its cap, regular file) holding exactly one start line for the step. A step lost to a restart parks its task with a question.
5. **Classification** runs on normalised text (NFKC, zero-width removed); every named path is checked, home/variable/parent paths are
   never inside a folder, and unplaced verbs park the task. Anatole is "on" only for a fresh, not-degraded status.
6. **Receipts** are applied only along their intact hash chain; adaptation stops when it is broken.
7. **Bridge**: base URLs refuse link-local, metadata, unspecified, multicast, IPv6-literal (but `::1`) and non-tailnet `100.x`; an
   endpoint is never given a cloud, source-host, registry or ssh credential variable; the card shows the whole payload or the send is
   refused; a relayed reply is one JSON string named as untrusted data; polls over 1,000,000 characters are not parsed.
8. **Masking** removes zero-width and format characters before it masks, at parse, wash and clean.

## 3. Consequences

- A step can still do what the session's permissions let it do: the pin makes the loop's own state tamper-evident, not the project
  safe from the session. The recommended companion is permission rules denying `.claude-flow/console/**` and `protector-mod/**`.
- Two consoles on one project each hold their own pin; a Start or rotation in one stops the other (fail closed).
- A first run after this change with a readable but empty store stops a running journal; the person confirms Start again.

## 4. Test and benchmark plan

`tests/security-audit.spec.ts` (pure), `tests/security-audit-live.spec.ts` (in-memory disk and fake host). Each
fix was mutation-checked: removing it fails its test. Cost: one `stat`, one bounded read and string checks per tick; no benchmark is
needed, the tick runs once a minute.

## 5. Rollback

Revert the commit. The pin is one store key (`autopilot-pin:<cwd>`); deleting it with the code in place makes an unreadable store adopt
the journal, and a readable one require a confirmed Start.
