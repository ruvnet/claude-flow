/**
 * Second, hash-chained copy of the policy ledger anchor (#3602, ADR-475).
 *
 * The primary anchor (`ledgerLength` / `ledgerHead`) lives inside state.json,
 * the same file it protects, so deleting it together with receipts used to
 * make `verify` bless the truncated chain. This module keeps an append-only
 * chain of anchor entries in a SEPARATE file plus a mirror of the newest entry
 * outside the project directory (~/.config/ruflo/policy-trust/<project>/).
 *
 * Threat model: this detects any tampering confined to state.json, and any
 * tampering confined to the project directory. It does NOT stop an attacker
 * who can rewrite both the project directory and the user's home directory.
 *
 * Archive coverage (#3892): once receipts have been pruned, the default
 * (non-`--full`) verify path checks the archive's TIP only — it confirms
 * the archive's newest entry still matches what the anchor recorded, in
 * bounded time, catching deletion, truncation, and tampering of that tip
 * entry. It does NOT walk `previousReceiptHash` back through the rest of
 * the archive, so a surgical edit to an INTERIOR archived receipt that
 * leaves the tip entry (and everything chained after it) byte-for-byte
 * untouched is NOT detected by default verify. Only
 * `verifyPolicyLedger({ full: true })` (`ruflo policy verify --full`),
 * which replays the entire archive, closes that gap. This is the inherent
 * trade-off of a cheap tip check versus an O(total-history) replay, not an
 * oversight — closing it fully on the default path would reintroduce the
 * unbounded per-transaction cost #3164 removed.
 */
import { createHash } from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync, existsSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { AgenticPolicyEngine, canonicalizePolicy, type PolicyState } from '@claude-flow/security';

export type AnchorEvent = 'append' | 'migrated-from-state' | 'establish-anchor';

export interface AnchorEntry {
  seq: number;
  length: number;
  headHash: string | null;
  prevAnchorHash: string | null;
  ts: number;
  event: AnchorEvent;
  by?: string;
  /**
   * How much of the archive this anchor claims (`state.retainedFrom` at
   * anchor time) and the hash of its newest archived receipt (#3892 Blocker
   * 1). Absent on anchors written before this field existed, or for a
   * ledger that has never been pruned — both resolve to a vacuous pass so
   * the unpruned baseline stays byte-for-byte identical (see `entryHash`).
   */
  archivedThrough?: number;
  archiveHeadHash?: string | null;
  hash: string;
}

export type AnchorAssessment =
  | { kind: 'absent' }
  | { kind: 'ok'; last: AnchorEntry; behind: boolean }
  | { kind: 'fail'; error: string };

export type AnchorWriter = (file: string, value: unknown) => Promise<void>;

const LOG_FILE = 'ledger-anchors.json';
const MIRROR_FILE = 'ledger-anchor-head.json';

export const anchorLogPath = (projectRoot: string): string => join(resolve(projectRoot), '.claude-flow', 'policy', LOG_FILE);

/**
 * The home directory trust material lives under: $HOME when it is an absolute path, else the account's home. An empty or relative
 * $HOME (an unset variable in a wrapper script, `HOME=. cmd`) would make join() yield a path relative to the working directory and
 * drop the HMAC key and anchor mirror into the project; that is never wanted, so it falls back to the account home or refuses.
 */
function trustHome(): string {
  const home = homedir();
  if (home && isAbsolute(home)) return home;
  let account = '';
  try { account = userInfo().homedir; } catch { /* no account entry for this uid */ }
  if (account && isAbsolute(account)) return account;
  throw new Error('policy-trust-home-unresolved: $HOME is empty or relative and this account has no home directory; set HOME to an absolute path');
}

/**
 * Directory holding per-project trust material (anchor mirror, HMAC key).
 * Resolved from the environment at call time (#3919): $XDG_CONFIG_HOME when it
 * is absolute, else $HOME/.config (os.homedir() honours $HOME), so a scratch
 * HOME keeps tests and sandboxed runs out of the developer's real home. An XDG
 * user who already has trust state under the legacy ~/.config keeps using it.
 */
export function policyTrustRoot(): string {
  const legacy = join(trustHome(), '.config', 'ruflo', 'policy-trust');
  const xdg = process.env.XDG_CONFIG_HOME;
  if (!xdg || !isAbsolute(xdg)) return legacy;
  const preferred = join(xdg, 'ruflo', 'policy-trust');
  return !existsSync(preferred) && existsSync(legacy) ? legacy : preferred;
}

function mirrorPath(projectRoot: string): string {
  const id = createHash('sha256').update(realpathSync(projectRoot)).digest('hex');
  return join(policyTrustRoot(), id, MIRROR_FILE);
}

// Duplicated from policy-runtime.ts's RECEIPT_ARCHIVE_FILE rather than
// imported, to avoid a circular dependency (policy-runtime.ts imports this
// module) — same pattern already used by anchorLogPath above.
const ARCHIVE_FILE = 'receipts.ledger.jsonl';
function archiveLedgerPath(projectRoot: string): string {
  return join(resolve(projectRoot), '.claude-flow', 'policy', ARCHIVE_FILE);
}

const TAIL_READ_INITIAL_BYTES = 64 * 1024;

/**
 * Whether the archive still contains a self-consistent copy of the receipt
 * at `expectedSequence` whose own stored `hash` is `expectedHash` (#3892
 * Blocker 1) — i.e. the archive's TIP, nothing more. Scans a trailing
 * window of the file, growing it by doubling until a match is found or the
 * whole file has been read — NOT just the physical last line: a harmless
 * crash-duplicate (#3164) can legitimately land after the true tail, so
 * truncation/tampering is "the matching receipt is nowhere in the file",
 * not "it isn't the very last line". "Self-consistent" means
 * `policyHash(payload) === hash` — a tamper that edits a receipt's content
 * but leaves its stale `hash` field untouched must not read back as a
 * match.
 *
 * Coverage boundary (disclosed at the top of this file): this checks only
 * the tip record itself, never `previousReceiptHash` back through the rest
 * of the archive. An interior receipt tampered with its OWN hash
 * recomputed to stay self-consistent, while the tip and everything after
 * it are left untouched, passes this check — only `--full` catches that.
 *
 * Cost: bounded on the common (untampered) path, where the match is almost
 * always inside the first 64KB window; a truncation/deletion attack (where
 * no match exists anywhere) degrades toward O(archive size) before
 * reporting tampering — an acceptable cost on that rare failure path. On
 * the healthy path this runs on every `withPolicyTransaction` call once
 * `retainedFrom > 0` (via `checkArchiveClaim` → `assessAnchors` →
 * `reconcileLedger`), not only on explicit verify calls.
 * This PR originally measured its un-synced tip reader separately; those
 * timings do not describe the durable writer protocol added here.
 * Crash catch-up checks only the newly archived extension from a trusted
 * head; this rare path costs O(extension plus the trailing archive window).
 */
function archiveHasTailReceipt(filePath: string, expectedSequence: number, expectedHash: string, from?: { sequence: number; hash: string }): boolean {
  if (!existsSync(filePath)) return false;
  let fd: number;
  try { fd = openSync(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)); } catch { return false; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size === 0) return false;
    const size = stat.size;
    const verifier = new AgenticPolicyEngine({ signingKey: process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY, keyId: process.env.CLAUDE_FLOW_POLICY_KEY_ID });
    let windowSize = Math.min(TAIL_READ_INITIAL_BYTES, size);
    for (;;) {
      const start = size - windowSize;
      const buffer = Buffer.alloc(windowSize);
      if (readSync(fd, buffer, 0, windowSize, start) !== windowSize) return false;
      const text = buffer.toString('utf8');
      // A window that doesn't start at byte 0 may begin mid-line; drop that
      // possibly-truncated leading fragment rather than risk parsing junk.
      const firstNewline = text.indexOf('\n');
      const usable = start === 0 ? text : (firstNewline === -1 ? '' : text.slice(firstNewline + 1));
      let found: string | undefined;
      const extension = new Map<number, any>();
      const lines = usable.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        let parsed: any;
        try { parsed = JSON.parse(line); }
        catch {
          // An interrupted, unterminated append may follow the committed
          // tip. A writer can recover it only against verified retry bytes.
          if (i === lines.length - 1 && !usable.endsWith('\n')) continue;
          continue;
        }
        const sequence = parsed?.payload?.sequence;
        if (sequence === expectedSequence) {
          if (verifier.verifyReceipt(parsed) || parsed.hash !== expectedHash) return false;
          const canonical = canonicalizePolicy(parsed);
          if (found !== undefined && found !== canonical) return false;
          found = canonical;
        }
        if (from && Number.isSafeInteger(sequence) && sequence > from.sequence && sequence <= expectedSequence) {
          if (verifier.verifyReceipt(parsed)) return false;
          const previous = extension.get(sequence);
          if (previous && canonicalizePolicy(previous) !== canonicalizePolicy(parsed)) return false;
          extension.set(sequence, parsed);
        }
      }
      if (found !== undefined && !from) return true;
      if (found !== undefined && from && extension.size === expectedSequence - from.sequence) {
        let previous = from.hash;
        for (let sequence = from.sequence + 1; sequence <= expectedSequence; sequence++) {
          const receipt = extension.get(sequence);
          if (!receipt || receipt.payload.previousReceiptHash !== previous) return false;
          previous = receipt.hash;
        }
        return previous === expectedHash;
      }
      if (windowSize >= size) return false;
      windowSize = Math.min(windowSize * 2, size);
    }
  } finally {
    closeSync(fd);
  }
}

/** #3164: `state.receipts` is only the hot tail once pruning is in play — the
 * anchor log always speaks in terms of the full historical ledger length. */
function fullLength(state: PolicyState): number {
  return (state.retainedFrom ?? 0) + state.receipts.length;
}

/**
 * Hash of the receipt at absolute (historical) 1-based length
 * `absoluteLength`, or `undefined` if it is neither in the hot tail nor
 * exactly the boundary receipt this transaction just pruned (#3164).
 * `recordAnchor` runs every transaction, so the anchor it reads here is
 * always at most one transaction behind the current state — never further
 * back than the just-pruned boundary.
 */
function receiptHashAt(state: PolicyState, absoluteLength: number): string | undefined {
  const retainedFrom = state.retainedFrom ?? 0;
  const index = absoluteLength - 1;
  if (index === retainedFrom - 1) return state.prunedHead ?? undefined;
  if (index >= retainedFrom) return state.receipts[index - retainedFrom]?.hash;
  return undefined;
}

/**
 * The two archive fields are appended to the hashed array ONLY when at
 * least one of them is set on this entry (#3892 Blocker 1). An anchor
 * written before the fields existed, or for a ledger that was never
 * pruned, therefore hashes over the exact same array as before this
 * change — appending `null, null` unconditionally would change the
 * hashed byte string and break every anchor already on disk.
 */
function anchorHeadMatches(projectRoot: string, state: PolicyState, anchor: AnchorEntry): boolean {
  const hotHash = receiptHashAt(state, anchor.length);
  if (hotHash !== undefined) return hotHash === anchor.headHash;
  const retainedFrom = state.retainedFrom ?? 0;
  return anchor.length < retainedFrom && typeof anchor.headHash === 'string' && typeof state.prunedHead === 'string'
    && archiveHasTailReceipt(archiveLedgerPath(projectRoot), anchor.length - 1, anchor.headHash)
    && archiveHasTailReceipt(archiveLedgerPath(projectRoot), retainedFrom - 1, state.prunedHead,
      { sequence: anchor.length - 1, hash: anchor.headHash });
}

function entryHash(entry: Omit<AnchorEntry, 'hash'>): string {
  const fields: unknown[] = [
    entry.seq, entry.length, entry.headHash, entry.prevAnchorHash, entry.ts, entry.event, entry.by ?? null,
  ];
  if (entry.archivedThrough !== undefined || entry.archiveHeadHash !== undefined) {
    fields.push(entry.archivedThrough ?? null, entry.archiveHeadHash ?? null);
  }
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

function validEntry(value: unknown, seq: number, prev: string | null): value is AnchorEntry {
  const e = value as AnchorEntry;
  return !!e && typeof e === 'object'
    && e.seq === seq
    && Number.isInteger(e.length) && e.length >= 0
    && (e.headHash === null || typeof e.headHash === 'string')
    && e.prevAnchorHash === prev
    && typeof e.ts === 'number'
    && ['append', 'migrated-from-state', 'establish-anchor'].includes(e.event)
    && (e.archivedThrough === undefined || (Number.isInteger(e.archivedThrough) && e.archivedThrough >= 0))
    && (e.archiveHeadHash === undefined || e.archiveHeadHash === null || typeof e.archiveHeadHash === 'string')
    && typeof e.hash === 'string'
    && e.hash === entryHash({ ...e, hash: undefined } as never);
}

function readLog(projectRoot: string): AnchorEntry[] | 'corrupt' {
  const file = anchorLogPath(projectRoot);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: number; entries?: unknown[] };
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return 'corrupt';
    let prev: string | null = null;
    for (let i = 0; i < parsed.entries.length; i++) {
      if (!validEntry(parsed.entries[i], i, prev)) return 'corrupt';
      prev = (parsed.entries[i] as AnchorEntry).hash;
    }
    return parsed.entries as AnchorEntry[];
  } catch {
    return 'corrupt';
  }
}

function readMirror(projectRoot: string): AnchorEntry | null | 'corrupt' {
  const file = mirrorPath(projectRoot);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as AnchorEntry;
    return typeof parsed?.hash === 'string' && parsed.hash === entryHash({ ...parsed, hash: undefined } as never)
      ? parsed
      : 'corrupt';
  } catch {
    return 'corrupt';
  }
}

/**
 * Cross-checks one anchor's claim about the archive against current state
 * and, when that claim is self-consistent, against the live archive file
 * on disk (#3892 Blocker 1). `undefined` means no mismatch was found —
 * including the legitimate transitional case of an anchor written before
 * archive-anchoring existed, which `behind` catches up separately.
 *
 * Tip check only — see `archiveHasTailReceipt`'s doc comment and the
 * file-level comment for the coverage boundary (an interior-archive
 * tamper that leaves the tip untouched is not caught here) and the
 * measured per-transaction cost this adds once `retainedFrom > 0`.
 */
function checkArchiveClaim(projectRoot: string, state: PolicyState, anchor: AnchorEntry): string | undefined {
  const retainedFrom = state.retainedFrom ?? 0;
  if (retainedFrom === 0) return undefined;
  const archiveHeadHash = state.prunedHead ?? null;
  if (archiveHeadHash === null
    || !archiveHasTailReceipt(archiveLedgerPath(projectRoot), retainedFrom - 1, archiveHeadHash)) {
    return 'policy-ledger-archive-tampered';
  }
  if (anchor.archivedThrough === undefined) return undefined;
  if (anchor.archivedThrough > retainedFrom
    || (anchor.archivedThrough === retainedFrom && (anchor.archiveHeadHash ?? null) !== archiveHeadHash)) {
    return 'policy-ledger-anchor-mismatch';
  }
  // State is published before the secondary anchors. A crash can therefore
  // leave an older, durable archive claim. Preserve and authenticate that
  // older tip plus the state's current tip before catching anchors up.
  if (anchor.archivedThrough > 0 && (!anchor.archiveHeadHash
    || !archiveHasTailReceipt(archiveLedgerPath(projectRoot), anchor.archivedThrough - 1, anchor.archiveHeadHash))) {
    return 'policy-ledger-archive-tampered';
  }
  return undefined;
}

/**
 * How the stored anchors relate to `state`; read-only. `rebuild` is the
 * explicit-establish path: an unreadable log or mirror is treated as absent, but
 * whatever readable anchor remains must still agree with the chain, so it can
 * never bless a truncation the anchors still remember.
 */
export function assessAnchors(projectRoot: string, state: PolicyState, rebuild = false): AnchorAssessment {
  let entries = readLog(projectRoot);
  if (entries === 'corrupt') {
    if (!rebuild) return { kind: 'fail', error: 'policy-anchor-log-corrupt' };
    entries = [];
  }
  let mirror = readMirror(projectRoot);
  if (mirror === 'corrupt') {
    if (!rebuild) return { kind: 'fail', error: 'policy-anchor-mirror-corrupt' };
    mirror = null;
  }
  const retainedFrom = state.retainedFrom ?? 0;
  if (entries.length === 0) {
    if (!mirror) return { kind: 'absent' };
    if (!rebuild) return { kind: 'fail', error: 'policy-anchor-log-missing' };
    if (fullLength(state) < mirror.length) return { kind: 'fail', error: 'policy-ledger-truncated' };
    if (mirror.length > 0 && !anchorHeadMatches(projectRoot, state, mirror)) {
      return { kind: 'fail', error: 'policy-ledger-anchor-mismatch' };
    }
    const archiveError = checkArchiveClaim(projectRoot, state, mirror);
    if (archiveError) return { kind: 'fail', error: archiveError };
    return { kind: 'absent' };
  }
  if (mirror && !entries.some((entry) => entry.hash === mirror.hash)) {
    return { kind: 'fail', error: 'policy-anchor-log-rolled-back' };
  }
  const last = entries[entries.length - 1]!;
  // A failed best-effort mirror write may leave a genuine earlier entry,
  // including an entry from before the first prune. Membership in the fully
  // validated log above plus the trusted-head/extension checks below grant
  // catch-up authority; asymmetric archive fields alone do not prove tampering.
  for (const anchor of mirror ? [last, mirror] : [last]) {
    if (fullLength(state) < anchor.length) return { kind: 'fail', error: 'policy-ledger-truncated' };
    if (anchor.length > 0 && !anchorHeadMatches(projectRoot, state, anchor)) {
      return { kind: 'fail', error: 'policy-ledger-anchor-mismatch' };
    }
    const archiveError = checkArchiveClaim(projectRoot, state, anchor);
    if (archiveError) return { kind: 'fail', error: archiveError };
  }
  const behind = fullLength(state) > last.length
    || (retainedFrom > 0 && last.archivedThrough === undefined);
  return { kind: 'ok', last, behind };
}

/**
 * Append an entry for the current state if the newest entry does not already
 * describe it. Must run under the policy lock. Throws if the log is corrupt:
 * only an explicit establish may replace a corrupt log.
 */
export async function recordAnchor(
  projectRoot: string,
  state: PolicyState,
  write: AnchorWriter,
  event: AnchorEvent = 'append',
  by?: string,
): Promise<void> {
  const length = fullLength(state);
  if (length === 0) return;
  const loaded = readLog(projectRoot);
  const entries = loaded === 'corrupt' ? [] : loaded;
  if (loaded === 'corrupt' && event !== 'establish-anchor') throw new Error('policy-anchor-log-corrupt');
  const last = entries[entries.length - 1];
  const headHash = receiptHashAt(state, length);
  if (headHash === undefined) throw new Error('policy-ledger-anchor-head-unresolvable');
  const retainedFrom = state.retainedFrom ?? 0;
  const archivedThrough = retainedFrom > 0 ? retainedFrom : undefined;
  const archiveHeadHash = retainedFrom > 0 ? (state.prunedHead ?? null) : undefined;
  let tip = last;
  // #3892 Blocker 1: a pure prune with no new receipt (operation() didn't
  // call evaluate()) cannot actually change length/headHash in practice —
  // pruneReceipts only fires when receipts.length already exceeds
  // retention, which every prior transaction already brought back down —
  // but checking archivedThrough/archiveHeadHash independently here is
  // defensive against that combination regardless.
  if (!last || last.length !== length || last.headHash !== headHash
    || last.archivedThrough !== archivedThrough || (last.archiveHeadHash ?? undefined) !== archiveHeadHash) {
    const base = {
      seq: entries.length,
      length,
      headHash,
      prevAnchorHash: last?.hash ?? null,
      ts: Date.now(),
      event,
      ...(by ? { by } : {}),
      ...(archivedThrough !== undefined ? { archivedThrough, archiveHeadHash } : {}),
    };
    tip = { ...base, hash: entryHash(base) };
    await write(anchorLogPath(projectRoot), { version: 1, entries: [...entries, tip] });
  }
  try {
    const mirror = mirrorPath(projectRoot);
    await write(mirror, tip);
  } catch (error) {
    // A read-only home must not stop the ledger; verify reports the weaker
    // posture (no mirror) rather than failing closed on every decision.
    process.stderr.write(`[policy] anchor mirror not written: ${(error as Error).message}\n`);
  }
}

export function anchorPosture(projectRoot: string): { log: boolean; mirror: boolean } {
  return { log: existsSync(anchorLogPath(projectRoot)), mirror: existsSync(mirrorPath(projectRoot)) };
}
