# .harness/ — ruflo's MetaHarness lifecycle directory

This directory holds the files that `harness <subcommand>` from `metaharness` reads to assess ruflo's governance posture. See [ADR-150](../v3/docs/adr/ADR-150-metaharness-integration-surfaces.md) for context.

## Contents

| File | Purpose | Iter |
|---|---|---|
| `mcp-policy.json` | MCP governance policy. ADR-022 default-deny, audit-log on, dangerous-pattern list, per-turn call budget. Required to clear the `no-policy` HIGH finding from `harness mcp-scan`. | 30 |
| `manifest.json` | Hand-authored harness identity manifest: hosts + sha256 fingerprints of the security-relevant files (mcp-policy + .claude/settings). Required input for `harness sign` and for OIA-manifest's `mcpPolicyPath` field. | 32 |
| `witness.json` | **NOT YET CREATED.** Ed25519-signed Merkle-style witness over the manifest. Would push OIA governance from "full / mcp-policy.json (witness missing)" to "full / mcp-policy.json + witness ADR-011". See below. | — |

## Witness — what's needed to ship it

`harness sign .` produces a witness from `.harness/manifest.json` BUT requires `WITNESS_SIGNING_KEY` (64-char hex Ed25519 private key) in the environment. Ruflo's existing `brain-signing-key` in GCP Secret Manager is in a different format (89 chars, not hex) and can't be reused.

To enable witness signing, one of:

1. **Create a new GCP secret `witness-signing-key`** (32 random bytes, hex-encoded). Fetched via Workload Identity Federation in CI; locally via `gcloud secrets versions access`. Pros: same auth path as the existing OPENROUTER_API_KEY workflow. Cons: requires explicit user authorization (creates a new sensitive secret).

2. **Use a hardware key (YubiKey, Sigstore-style ephemeral identity)**. Pros: no long-lived private key on disk. Cons: more CI plumbing.

3. **Skip the witness** and accept the "partial witness" note in the OIA manifest. The threat-model and mcp-scan are already CLEAN without it; the witness only signs the manifest, it doesn't itself add new security controls.

Current state (option 3) gives ruflo:
- ✓ L7 governance alignment: **full** (per `harness oia-manifest`)
- ✓ threat-model worst severity: **info / clean**
- ✓ mcp-scan: **0 actionable findings**
- The implementation note: `"mcp-policy.json (witness missing)"`

The witness is genuinely optional unless an external party needs to verify the manifest hasn't been tampered with. For ruflo's internal use it's nice-to-have polish.

## Verifying ruflo's current posture

```bash
# Full threat report
npx -y -p metaharness@latest harness threat-model .

# Per-server MCP scan
npx -y -p metaharness@latest harness mcp-scan .

# Full OIA layer alignment
npx -y -p metaharness@latest harness oia-manifest .

# Or via ruflo's wrappers (no metaharness install required if optional dep is present)
npx ruflo metaharness threat-model
npx ruflo metaharness mcp-scan
npx ruflo metaharness oia-audit --dry-run
```

## Updating mcp-policy.json

If you change `mcp-policy.json`, regenerate the manifest's sha256 entry:

```bash
node -e "
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const m = JSON.parse(readFileSync('.harness/manifest.json', 'utf-8'));
m.files['.harness/mcp-policy.json'] = createHash('sha256').update(readFileSync('.harness/mcp-policy.json')).digest('hex');
m.files['.claude/settings.json'] = createHash('sha256').update(readFileSync('.claude/settings.json')).digest('hex');
m.generated_at = new Date().toISOString();
writeFileSync('.harness/manifest.json', JSON.stringify(m, null, 2) + '\n');
console.log('Manifest updated.');
"
```

Smoke step 17t (in `plugins/ruflo-metaharness/scripts/smoke.sh`) locks the policy invariants. If you change the policy in a way that violates `defaultDeny:true / auditLog:true / requireApprovalForDangerous:true` or removes the `toolTimeoutMs`/`maxToolCallsPerTurn` positive-number requirements, CI will fail.
