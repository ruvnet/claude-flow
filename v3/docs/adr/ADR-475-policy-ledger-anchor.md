# ADR 475: Policy ledger anchor cannot be deleted and silently re-established

Status: Accepted

Date: 2026-10-07

Builds on: ADR-324 (agentic policy engine), #3568 (ledger truncation anchor)

## 1. Context

#3568 added an anchor (`ledgerLength`, `ledgerHead`) so that a truncated ledger no longer verified. The anchor lived in
`state.json`, the file it protects, and `verify` re-created it whenever it was absent while receipts existed ("established-now").
So an attacker who truncated receipts and also deleted the two anchor fields got `{"valid":true,"anchor":"established-now"}`
(#3602, reproduced on 3.54.1). Appending a receipt to an unanchored ledger re-anchored it the same way.

## 2. Decision

1. **Never re-anchor silently.** With receipts present and no anchor, `verify` reports `anchor-missing` (invalid), and
   `appendReceipt` / any policy transaction refuse (`policy-ledger-anchor-missing`). Only an empty ledger (genesis) anchors on its first receipt.
2. **A second anchor outside the file the attacker edits.** `.claude-flow/policy/ledger-anchors.json` is an append-only,
   hash-chained list `{seq, length, headHash, prevAnchorHash, ts, event, by?, hash}`, written after each state write that changes the chain.
   The newest entry is mirrored to `~/.config/ruflo/policy-trust/<project>/ledger-anchor-head.json`. `verify` checks the
   state against the primary anchor, the newest log entry and the mirror. The mirror must appear in the log (an older copy of the log is a rollback).
   The log is written after `state.json`, so a crash leaves the state ahead of the log; that is caught up, never read as truncation.
3. **Explicit repair.** `ruflo policy verify --establish-anchor` (interactive terminal only, not exposed over MCP) anchors a ledger
   that has receipts and no usable anchor (a corrupt log or mirror is rebuilt; a readable one must still agree with the chain), and records `event: establish-anchor`, the OS user and the time in the log. It cannot override a
   truncation or mismatch that the remaining anchors still prove.
4. **Migration.** A state.json anchor from an older version is accepted; the second anchor is then written (`migrated-from-state`).
   A ledger with no anchor at all (pre-#3568) gets `anchor-missing` and the one-step repair above, not a crash. A deleted primary with an
   intact second anchor is restored from it (`restored-primary`) when the chain agrees.

## 3. Threat model (stated in `verify` output as `scope`)

Detected: edits confined to `state.json`; edits confined to the project directory (the mirror remembers the newest anchor); a rolled-back or deleted anchor log while the mirror exists; a
corrupted log.

NOT detected: an attacker who can rewrite both the project directory and the user's `~/.config/ruflo`. They can also delete the anchors,
the mirror and the receipts, leaving a ledger that is either `anchor-missing` (which a naive operator may then "repair" with `--establish-anchor`) or, if they also forge a coherent log and mirror, valid.
No local, unkeyed scheme defends against full local write access; stronger evidence needs an external witness (signed receipts via
`CLAUDE_FLOW_POLICY_SIGNING_KEY`, or shipping the head hash off-host). A truncation back to a point where a *previous* anchor
entry exists while that entry and everything after it is also removed from log and mirror is likewise undetectable. The mirror is best-effort (a read-only home logs a warning and continues).

In `enforce` mode `state.json` was already HMAC-authenticated through `state.anchor.json` in the home directory, so the #3602 repro only bit in `legacy` and `observe`, where no HMAC exists; the second anchor extends the same kind of coverage to those modes.

## 4. Consequences

- A pre-#3568 ledger (receipts, no anchor of any kind) makes every policy transaction fail with `policy-ledger-anchor-missing: ... run ruflo policy verify --establish-anchor` until an operator repairs it; `authorizeMcpTool` rethrows, so MCP calls fail with that text (CLI startup migration swallows it). A truncation already failed the same way (`policy-ledger-truncated`).
- `verifyPolicyLedger` gains `{ establishAnchor }` and results may carry `secondaryAnchor`. `LedgerVerification.anchor` is only set by an explicit establish.
- `AgenticPolicyEngine.verifyLedger({ establishAnchor })` is the only engine path that anchors existing receipts.
- Touches `@claude-flow/security` (bundled) and `@claude-flow/cli`.

## Update 2026-10-07: checked against the merged code

Read against `v3/@claude-flow/cli/src/services/policy-ledger-anchor.ts` (the log, mirror and `assessAnchors`),
`v3/@claude-flow/cli/src/services/policy-runtime.ts` (`reconcileLedger`, `verifyPolicyLedger`, `withPolicyTransaction`,
`writePolicyState`), `v3/@claude-flow/cli/src/commands/policy.ts`, `v3/@claude-flow/cli/src/mcp-tools/policy-tools.ts`,
`v3/@claude-flow/security/src/policy/engine.ts` and `types.ts`. The decision and the threat model hold. The sections above are
correct in what they decide; these are the places where the code is more specific than the text, or uses different names.

**Confirmed, no drift**

- Receipts present and no anchor: `engine.verifyLedger()` returns `anchor-missing` and `appendReceipt` throws `policy-ledger-anchor-missing`
  (`engine.ts`); only an empty ledger (`state: 'empty'`) anchors on its first receipt.
- `--establish-anchor` calls `requireInteractiveAdministrator()` (a TTY on stdin and stdout) in `commands/policy.ts`. The MCP verify tool
  (`mcp-tools/policy-tools.ts`) calls `verifyPolicyLedger(root)` with no options, so it cannot establish.
- The log is `.claude-flow/policy/ledger-anchors.json`, `{version: 1, entries: [...]}`, each entry `{seq, length, headHash, prevAnchorHash, ts,
  event, by?, hash}` with a SHA-256 over `[seq, length, headHash, prevAnchorHash, ts, event, by]`; the log is written after `state.json`
  (`writePolicyState`), and a state ahead of the log is caught up (`behind`), not read as truncation. `by` is set only for
  `establish-anchor`, from the OS user name.
- A readable mirror must appear in the log, else `policy-anchor-log-rolled-back`. A read-only home logs `[policy] anchor mirror not written`
  and continues.
- `LedgerVerification.anchor` is only ever `'established-now'` (`types.ts`), set by the explicit establish.
- Bundled in `@claude-flow/security` 3.0.2 and the CLI.

**Where the code is more specific than the text**

1. **The mirror's directory is a hash, not a project name.** It is
   `~/.config/ruflo/policy-trust/<sha256 of the project's real path>/ledger-anchor-head.json`, under the home directory from
   `os.userInfo()`, created 0700. Moving or re-linking the project to a different real path starts a new mirror.
2. **Two vocabularies.** The log's `event` field has three values: `append`, `migrated-from-state` and `establish-anchor`. What
   `verify` prints in `secondaryAnchor` is a different set: `recorded-from-state` (written to the log as `migrated-from-state`),
   `restored-primary` (written as `append`) and `established-explicitly` (written as `establish-anchor`). Section 2.4's
   "(`migrated-from-state`)" and "(`restored-primary`)" name one of each.
3. **More failure codes than the one the text names.** Besides `anchor-missing`, `verify` and every policy transaction can fail with
   `policy-anchor-log-corrupt`, `policy-anchor-mirror-corrupt`, `policy-anchor-log-missing` (a mirror exists but the log is gone),
   `policy-anchor-log-rolled-back`, `policy-ledger-truncated` and `policy-ledger-anchor-mismatch`. In a transaction only `anchor-missing`
   gets the long "run `ruflo policy verify --establish-anchor`, otherwise treat it as tampering" message; the others surface as the bare
   code. With `--establish-anchor` a corrupt log or mirror is treated as absent, and a readable remaining anchor must still agree with the
   chain (`policy-ledger-truncated` or `policy-ledger-anchor-mismatch` otherwise), as 2.3 says.
4. **Migration and restore need no operator.** Section 2.4's migration is not an explicit step: any `verify`, including the MCP one, and
   any policy transaction writes the second anchor for a ledger that has a primary anchor and no log (`migrated-from-state`), and
   restores a deleted primary from an authentic log (`restored-primary`), when the chain agrees. This is intended (only
   `--establish-anchor` is gated), but it means a read-only-looking `verify` call can write files.
5. **A mirror-only state is a failure, not a restore.** If the log is missing and only the mirror remains, a plain `verify` fails with
   `policy-anchor-log-missing`; only `--establish-anchor` rebuilds the log, and only when the receipts still agree with the mirror.

Nothing in the threat model (section 3) is contradicted: the mirror and log are under the same user's control, so the stated limit stands.

## Update 2026-10-14: format 2 writer fence and bounded full audit

Policy state format 2 prevents older format-1 writers from silently rewriting a
retained ledger using obsolete archive/durability rules. The current loader accepts
existing format-1 state, including pruned history. The engine preserves its rules,
approvals, budgets, usage, receipt payloads/signatures and anchors, and writes format
2 on the next state publication. Unknown future versions fail closed. This is a
state-format migration, not receipt re-signing or signing-key rotation.

Before rolling out a format-2 writer, stop older MCP servers and other policy
writers for the project. Older released CLI loaders reject format 2 with
`unsupported-policy-state-version:2`; do not restart them against migrated state.
A binary rollback by restoring an exact pre-migration backup is supported only
when an operator verifies that no receipts, approval uses, budget consumption or
other acknowledged semantic changes occurred after that backup, and all writers
are stopped. The state, archive and project/external trust anchors must be restored
as the exact matching set. Restoring an older snapshot after acknowledged changes
would discard authority history and could permit replay; that rollback is not
supported. Keep a compatible writer and fix forward, or require an operator-approved
data-preserving migration plan. There is no automatic downgrade, history rewrite
or deletion path. These instructions do not authorize live backups, restores or
filesystem changes.

`policy verify --full` captures a checked, nofollow regular archive descriptor,
its byte boundary, the hot state and signing configuration under the writer lock.
It releases the lock before reading the historical prefix in 64 KiB chunks. Later
appends are outside that audit snapshot; replacing its pathname does not replace
the pinned descriptor. Truncation, short reads, invalid UTF-8, unterminated records
and authentication/canonical duplicate conflicts fail verification explicitly.

Memory scales with one bounded record and its parsed/canonical representations
plus the retained hot state; canonical finite-number formatting can expand beyond
the raw JSON input length. This is not a fixed RSS ceiling for every record. A private 0700
scratch directory holds a 0600 disk index; it addresses only the snapshot's claimed
sequences and is removed after success or failure. Every physical record is
authenticated before deduplication. Duplicate checks reread and compare the entire
canonical receipt, including signature and key ID. A receipt digest in the index
detects changes to that observed canonical record; it does not replace exact
canonical duplicate comparison. Unclaimed staging extras are authenticated and
compared in separate numeric scratch files, never enormous sparse offsets.

The default audit record limit is 16 MiB. Set
`CLAUDE_FLOW_POLICY_AUDIT_MAX_RECORD_BYTES` to an integer from 1024 through 67108864
to change the bound; invalid configuration and larger records fail with an explicit
error, without skipping or truncating ledger bytes. This is a new full-audit
compatibility limit and also bounds the archive-tip preflight. The audit byte
limit and `CLAUDE_FLOW_POLICY_LEDGER_RETENTION` are operator process-level settings
shared by CLI and long-lived MCP writers, not per-request flags. The retention
window defaults to 2,000 receipts; pruning preserves the authenticated archive.
Neither setting changes policy rules, budgets, approvals or receipt verification.
Complete records
use strict UTF-8. An incomplete EOF fragment is preserved by preflight so the
writer can recover only its exact verified-state byte prefix; full audit rejects
that incomplete snapshot. Legacy anchor JSON is streamed without changing its
version-1 format or historical hash/mirror checks; each bounded JSON value is
limited to 16 MiB of encoded UTF-8. Temporary-disk or descriptor failures also fail
the audit. Anchor verification CPU and atomic log-rewrite I/O still scale with the
number of anchors under the writer lock; bounded memory does not eliminate that
separate mature-ledger contention limit.
The default hot-path check remains tip-based, with the existing disclosed historical
interior coverage limit. This protocol requires neither a full historical array nor
a history-sized in-memory map, and makes no new guarantee against full local write
access or platforms lacking directory fsync.


### Local synthetic measurement, 2026-10-14

The final bounded candidate was compared with the integrated pre-streaming
source on the same shared Linux host using Node 24.21.0, 170,000 synthetic
unsigned receipts, 2,000 retained receipts, a 209,900,711-byte archive and
170,000 authenticated anchor entries. These are local measurements, not
production capacity guarantees. The first write starts from an 84,632,655-byte
pretty legacy anchor log. A priming transaction produces each writer's own
format: the baseline remains pretty (84,633,165 bytes), while the candidate
writes compact JSON (70,895,073 bytes). All prior entries remain authenticated.

| Actual transaction | Baseline | Bounded candidate |
| --- | --- | --- |
| First legacy-log write, elapsed | 2.488 s | 3.341 s |
| First write, process peak RSS | 636.5 MiB | 124.1 MiB |
| Subsequent single write, elapsed | 1.795 s | 1.812 s |
| Subsequent write, process peak RSS | 637.9 MiB | 141.2 MiB |
| First-write simultaneous clients 1 / 4 / 16, successful returns | 1 / 3 / 2 | 1 / 3 / 2 |
| Primed simultaneous clients 1 / 4 / 16, successful returns | 1 / 3 / 2 | 1 / 3 / 3 |

The remaining clients failed with the existing policy-state lock timeout.
Anchor validation CPU and complete atomic anchor-log rewrites remain
O(anchor count) under the writer lock. This inherited mature-ledger contention
issue remains unresolved under #3164; bounded full-audit memory does not make
sixteen concurrent writers reliable. Shared-host load affects these timings;
an earlier loaded run measured a 7.170-second first candidate write and
4.399-second primed write. Its process RSS was additionally affected by the
benchmark controller's inherited JSON-generation allocation, so that run is
not used for the memory comparison above.
