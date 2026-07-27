# ADR-322: Structurally Preventing Signing-Key Exposure in `sign-helpers.mjs`

- **Status**: Accepted
- **Date**: 2026-07-15
- **Deciders**: ruflo core
- **Issue**: [#2674](https://github.com/ruvnet/ruflo/issues/2674)
- **Related**: [ADR-174](ADR-174-memory-distillation-self-optimization.md) (the Ed25519 helper-signing mechanism `sign-helpers.mjs` produces manifests for), [ADR-177](ADR-177-signed-config-propagation-to-installs.md) (sibling signing channel — `rvfa-signing`; same "never rotate a baked pubkey silently" constraint)

> **Numbering note**: this ADR was drafted as ADR-320 on a branch cut from `main` before PR #2687 (issue #2630, ADR-320/ADR-321) merged, so a same-branch scan of `v3/docs/adr/` reported 319 as the highest number in use and 320 looked free. It collided with PR #2687's already-claimed ADR-320/321 and was renumbered to **ADR-322** once the collision was found. The local-file-tree check that determines "next ADR number" in this repo's tooling is necessary but not sufficient when sibling unmerged PRs also touch `v3/docs/adr/` — cross-checking open PRs (via the GitHub API/`gh pr list` + diff paths) before assigning a number would catch this class of collision earlier, though that check isn't always available to an agent without GitHub API access.

## Context

On 2026-07-14 the ruflo helpers-signing private key was exposed in a Claude Code session transcript and had to be rotated (GCP secret v1 destroyed, v2 issued — PR #2673, `RUFLO_HELPERS_PUBKEY` rotated in `v3/@claude-flow/cli/src/init/helper-signing.ts`). Root cause, reconstructed from `CLAUDE.md`'s "Handling the signing key without leaking it" postmortem and the current script:

`v3/@claude-flow/cli/scripts/sign-helpers.mjs` fetches the private key with:

```js
execFileSync('gcloud', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
```

On Windows, Node's `execFileSync` cannot resolve `gcloud` (it needs the `.cmd` suffix) unless `shell: true` is set, so the fetch throws and the script exits. The script's own handling of the secret is already safe — `stdio: ['ignore', 'pipe', 'pipe']` captures both streams into JS strings, none of it is inherited to the parent's terminal. **The exposure did not happen inside this script.** It happened because, when the script fails, the intuitive human workaround is to run the equivalent `gcloud` command directly at the shell:

```
gcloud secrets versions access latest --secret=ruflo-helpers-signing-key
```

That command prints the PEM to its own stdout by design. Run inside a Claude Code Bash tool call, that stdout becomes tool-call output, which lands in the session transcript. There is no code path inside `sign-helpers.mjs` to fix here — the vector is a documented fallback instruction that routes a human to a command whose entire purpose is to print secret material.

Three things are true simultaneously and all three need to hold for this class of incident to stop recurring:

1. The primary path (`execFileSync('gcloud', …)`) must stop failing on Windows, so nobody is ever forced toward the workaround.
2. If the primary path fails for some *other* reason (expired token, wrong project, missing `gcloud` entirely), the sanctioned fallback must be a shape that cannot print key material to a captured stream, even under a Claude-Code-in-the-loop workflow — not a documented discipline ("remember to redirect and grep") that depends on a human executing it perfectly under pressure.
3. Defense in depth inside the script itself, since (1) and (2) address the *documented* paths — a future code change (e.g., an added debug log) is a second way this could regress, cheaply guarded against.

**Blast radius while unaddressed**: every ruflo install ≤ 3.28.0 still trusts the old (compromised) pubkey. Anyone holding the leaked v1 key could sign a forged helpers manifest that such installs' auto-refresh (`autoRefreshHelpersIfStale`, ADR-174) would accept, until the install upgrades to ≥ 3.29.0. This ADR does not re-litigate the v1→v2 rotation (done, PR #2673) — it closes the gap that allowed the leak in the first place.

## Decision

Harden `sign-helpers.mjs`'s secret capture with three layered changes, all scoped to that one script (~90 lines) plus its `CLAUDE.md` runbook. No change to `helper-signing.ts`'s verification logic, the manifest format, or the pubkey — this is capture-time hardening only.

### 1. Fix the Windows spawn bug (removes the forcing function)

```js
const gcloudBin = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
return execFileSync(gcloudBin, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
```

This is the highest-leverage single change: it makes the primary, already-safe path work on the platform that was driving people to the workaround. Every other change in this ADR is defense for the cases this fix doesn't cover (expired token, `gcloud` not installed, wrong project — any failure unrelated to the Windows binary name).

### 2. Stdin-only fallback: `--stdin-key`

Add a `--stdin-key` flag that reads the PEM from fd 0 instead of invoking `gcloud` at all:

```js
if (process.argv.includes('--stdin-key')) {
  return readFileSync(0, 'utf-8'); // fd 0 = stdin
}
```

The sanctioned fallback shape becomes:

```
gcloud secrets versions access latest --secret=ruflo-helpers-signing-key \
  | node scripts/sign-helpers.mjs --stdin-key
```

This is safe under the exact conditions that caused the incident: in a shell pipeline, the left-hand command's stdout is connected to the right-hand command's stdin via an in-kernel pipe — it is never written to the pipeline's own combined stdout/stderr, so a harness capturing the Bash tool call's output never sees the PEM. This holds whether the pipeline runs interactively, in CI, or inside a Claude Code Bash tool call. It requires no human discipline (no "remember to redirect to a file and grep the log") — the shape itself is the guarantee.

This supersedes the `CLAUDE.md` "Handling the signing key without leaking it" guidance (`gcloud … > ~/.ruflo/helpers-signing.key 2>&1 | grep -v BEGIN`), which is a manual, error-prone pattern (a wrong flag order silently reintroduces the leak) that this ADR's fallback makes unnecessary. That section should be replaced with the pipe-to-`--stdin-key` invocation once implemented.

`RUFLO_HELPERS_SIGNING_KEY=<file>` (existing, file-based) and the `~/.ruflo/helpers-signing.key` dev default are unaffected — both already keep key material off any captured stream and remain fully supported, unchanged. `--stdin-key` is additive: a third resolution path, checked after the GCP-secret path and before the env-var-file path, documented as the recommended fallback when GCP fetch fails but a human still needs to run the signer locally.

### 3. TTY refusal gate (defense in depth, GCP path only)

Guard the GCP-secret branch specifically — not the whole script, since `--stdin-key` and `RUFLO_HELPERS_SIGNING_KEY` are already non-printing by construction and gating them too would just add friction with no safety benefit:

```js
if (secret && process.stdout.isTTY && !process.env.RUFLO_HELPERS_ALLOW_TTY) {
  console.error(
    '[sign-helpers] refusing to fetch from GCP Secret Manager in an interactive/logged ' +
    'terminal. Use `gcloud … | node scripts/sign-helpers.mjs --stdin-key`, or set ' +
    'RUFLO_HELPERS_SIGNING_KEY=<pem-file>. To override, set RUFLO_HELPERS_ALLOW_TTY=1.'
  );
  process.exit(1);
}
```

This does not by itself close the original vector (the leak happened in a raw `gcloud` invocation *outside* this script, which no gate inside `sign-helpers.mjs` can intercept). Its value is narrower and real: it stops a human from reflexively re-deriving the unsafe `gcloud secrets versions access` command as a "just run what the script would run" workaround when they hit this gate, by naming the safe alternative in the same breath it refuses. `RUFLO_HELPERS_ALLOW_TTY=1` is the explicit opt-in for a developer who has read the warning and is deliberately eyeballing the fetch (e.g., verifying `gcloud` auth interactively before scripting it).

### 4. Output-scanning safety net

After signing completes, scan the script's own accumulated stdout buffer (everything queued to `console.log` during the run) for `BEGIN PRIVATE KEY` / `BEGIN EC PRIVATE KEY` / `BEGIN OPENSSH PRIVATE KEY` before the process exits normally:

```js
const emitted = capturedStdoutLines.join('\n');
if (/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/.test(emitted)) {
  console.error('[sign-helpers] FATAL: private key material detected in script output. Aborting.');
  process.exit(1);
}
```

This is a last-resort check against a *future* code change in this file (e.g., a debug `console.log(privateKeyPem)` added during troubleshooting) — it does not need to run on the raw `gcloud` output as a general filter, because that path is being eliminated by (1) and gated by (3). Scope: only this script's own `console.log`/`console.error` calls; it is not a general-purpose secret-scanning layer for arbitrary tool output (that is a much larger scope, out of scope for this ADR).

## Alternatives considered

- **Redirect-and-grep as the documented fallback (status quo, `CLAUDE.md` today).** Rejected as the *sanctioned* pattern — it depends on a human getting flag order and redirection right under time pressure, which is exactly how the incident happened. Left as a documented "if `--stdin-key` isn't available for some reason" footnote only, not the primary guidance.
- **`shell: true` on the existing `execFileSync('gcloud', …)` call to fix Windows.** Rejected — enabling a shell reintroduces argument-injection risk for a command that will eventually carry secret names and project identifiers, for no benefit over just resolving the correct binary name.
- **TTY gate on the whole script, not just the GCP branch.** Rejected — `--stdin-key` and `RUFLO_HELPERS_SIGNING_KEY` are non-printing by construction; gating those paths too adds a `RUFLO_HELPERS_ALLOW_TTY=1` tax to every local/CI invocation for zero additional safety.
- **A full general-purpose "never let PRIVATE KEY reach any tool output" harness feature (e.g., an AIDefence-style scan on all Bash tool output repo-wide).** Out of scope here — real defense-in-depth, but a repo-wide harness/tooling change, not a `sign-helpers.mjs` change; tracked as a separate future concern if pursued, not folded into this ADR.
- **Rotating to a fully offline (non-GCP) key custody model (e.g., hardware token only).** Rejected for this ADR — orthogonal to the capture-time bug; GCP Secret Manager centralized custody is a separate, already-accepted decision (implicit in ADR-174), not something this incident calls into question.

## Consequences

**Positive**:
- The Windows fetch failure — the actual forcing function behind the incident — is fixed; the primary path works cross-platform.
- The sanctioned fallback (`--stdin-key`) is safe by construction under the same Claude-Code-in-the-loop conditions that caused the leak, not safe-by-discipline.
- `RUFLO_HELPERS_SIGNING_KEY=<file>` and the dev-default path are untouched — zero migration burden for anyone already using them.
- The output-scan is cheap insurance against a future accidental regression inside this one file.

**Negative / trade-offs**:
- `--stdin-key` requires updating the `CLAUDE.md` runbook and any CI/release scripts that reference the old `gcloud | node` pattern implicitly — a one-time doc/script sync, not a behavior change for correctly-configured CI (CI does not run in a TTY, so gate (3) never fires there).
- The TTY gate adds one more environment variable (`RUFLO_HELPERS_ALLOW_TTY`) to the script's already-multi-path resolution surface; mitigated by only gating the GCP branch and by a clear error message naming the escape hatches.
- The output-scan only covers this script's own emitted lines — it provides no protection if a human still runs raw `gcloud` commands manually outside `sign-helpers.mjs`; that residual risk is accepted because (1) removes the reason to do so and (2)/(3) redirect toward the safe fallback at the point of failure.

## Validation

1. **Windows fetch success**: on a Windows runner (or `platform` mocked to `win32` in a unit test), `loadPrivateKey()` resolves `gcloud.cmd` and does not throw the "gcloud not found" error that previously forced the workaround.
2. **`--stdin-key` end-to-end**: `printf '%s' "$TEST_PEM" | node scripts/sign-helpers.mjs --stdin-key` signs successfully using only piped input, with no `gcloud` invocation and no other env var set.
3. **TTY refusal**: with `RUFLO_HELPERS_SIGNING_SECRET` set and stdout forced to a TTY (e.g. via `script -qc` or a mocked `process.stdout.isTTY = true` in a unit test), the script exits 1 with the documented message and does not call `gcloud`; setting `RUFLO_HELPERS_ALLOW_TTY=1` allows it through.
4. **Output-scan trip-wire**: a deliberately introduced `console.log(privateKeyPem)` in a test fork of the script causes the run to abort with the FATAL message before exit — proving the scan is load-bearing, not dead code.
5. **No regression on existing paths**: `RUFLO_HELPERS_SIGNING_KEY=<pem-file>` and the `~/.ruflo/helpers-signing.key` dev-default paths continue to sign successfully with no behavior change and no new prompts.

## References

- Issue [#2674](https://github.com/ruvnet/ruflo/issues/2674) — this hardening request.
- PR [#2673](https://github.com/ruvnet/ruflo/pull/2673) — the v1→v2 key rotation this ADR follows up on.
- PR [#2671](https://github.com/ruvnet/ruflo/pull/2671) — v3.29.0, shipped the rotated pubkey.
- `CLAUDE.md` "Handling the signing key without leaking it" (root-cause postmortem, commit `0052b1b06`) and "Windows `prepublishOnly` failure" (adjacent Windows cross-platform gap in the same publish flow).
- [ADR-174](ADR-174-memory-distillation-self-optimization.md) — the Ed25519 helper-signing/auto-refresh mechanism this script's output feeds.
- `v3/@claude-flow/cli/src/init/helper-signing.ts` — verification side; `RUFLO_HELPERS_PUBKEY`, `canonicalManifestBytes()`.
