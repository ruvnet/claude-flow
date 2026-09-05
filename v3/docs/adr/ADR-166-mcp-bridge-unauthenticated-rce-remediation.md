# ADR-166: MCP Bridge Unauthenticated RCE — Coordinated Disclosure Remediation

**ID**: ADR-166
**Status**: Accepted — Phase 0-3 shipped 2026-06-30 (this branch). Runtime + static locks green on both bridges.
**Date**: 2026-06-30
**Authors**: Dragan Spiridonov, rUv (drafted with Claude Code)
**Acknowledgements**: External security researcher who disclosed the vulnerability under coordinated disclosure (name withheld until embargo lifts and CVE is public). Their end-to-end PoC + video made the eight-step chain concrete instead of theoretical, which drove the choice to bind loopback by default rather than paper over with a token-only fix. Reporter will be credited by name in the GitHub Security Advisory + CVE when published.
**Branch**: security/adr-166-mcp-bridge-rce
**Disclosure**: External coordinated disclosure received 2026-06-30 from an independent security researcher. Reporter identity, the PoC's OAST callback domain, and the target EC2 address are withheld from this document. Treat as **embargoed** until Phase 1 ships and a coordinated advisory is published.
**Related ADRs**:
- ADR-034 (Optional MCP backends — `ruflo`/`ruvector`/`agentic-flow` stdio backends)
- ADR-035 (MCP tool groups — `MCP_GROUP_*` default-on/opt-in model)
- ADR-037 (Autopilot chat mode — where the tool blocklist is actually enforced)
- ADR-038 (Ruvocal fork — the deployed chat UI + bridge)
- ADR-029 (HF Chat UI Cloud Run — the documented cloud deployment path)
- ADR-012 (MCP security features)
- ADR-013 (Core security module — `@claude-flow/security` validators/SafeExecutor)
- ADR-131 (ToolOutputGuardrail — content-boundary screening, relevant to the AI-poisoning vector)
- ADR-165 (Security & CVE posture review, June 2026 — dependency CVE companion to this ADR)

---

## 1. Context

### 1.1 Why this ADR now

On 2026-06-30 we received a coordinated-disclosure report titled *"Unauthenticated Remote Code Execution and AI Platform Compromise in ruflo MCP Bridge."* It claims that the MCP Bridge HTTP endpoint accepts arbitrary tool invocations — including shell execution — with **no authentication**, that the shipping `docker-compose.yml` binds it to all interfaces, and that a single unauthenticated `POST /mcp` yields remote code execution inside the bridge container, from which LLM API keys, the AgentDB learning store, and the MongoDB conversation store are all compromised. The report includes an 8-step automated PoC (Python) and a video, described as confirmed live against a default deployment on AWS EC2.

We statically verified every substantive claim against the checked-out source. **The report is accurate.** This is a critical, internet-reachable, unauthenticated RCE in the default Docker deployment.

This ADR provides:

1. A grounded inventory of the affected bridge as it actually ships (not as intended).
2. The confirmed vulnerability findings with file-and-line evidence.
3. The end-to-end attack chain, mapped to the PoC.
4. A phased remediation roadmap with testable acceptance criteria, including the operational incident response (key rotation, learning-store audit) that patching alone does not cover.

### 1.2 Scope

**In scope**: the deployed MCP bridge (`ruflo/src/ruvocal/mcp-bridge/index.js`) and its sibling (`ruflo/src/mcp-bridge/index.js`); the shipping `ruflo/docker-compose.yml`; the nginx reverse proxy (`ruflo/src/nginx/nginx.conf`); the stdio MCP backend spawn path; the `MCP_GROUP_*` tool-group exposure model; and the `plugin-agent-federation` default bind host.

**Design contract** (per maintainer decision 2026-06-30): the MCP bridge is local-only by default. Public network exposure is an **explicit opt-in deployment pattern** (`MCP_BIND_HOST=0.0.0.0` + `MCP_AUTH_TOKEN` required). Local-only deployments do not carry the auth burden — the threat model and Phase 1 deliverables below are calibrated to this contract.

**Out of scope**: the npm dependency-CVE landscape (covered by ADR-165); the `@claude-flow/security` package internals; non-ruvocal deployment topologies beyond the documented Docker and `npx`/CLI paths; full TLS/network-segmentation design (referenced as operational guidance only).

### 1.3 Limitations of this audit

- **No live exploitation.** Findings are from static analysis (grep + file reads) of the source as checked out on 2026-06-30 and from reading the disclosed PoC script. We did **not** run the PoC against any host — there is no authorized target, and re-confirming a researcher-confirmed RCE adds risk without adding information.
- **Deployment-exposure assumption.** We did not measure the bind addresses of any live instance. The threat analysis assumes the documented default (`docker compose up -d`) and worst-case public reachability, consistent with the report.
- **PoC attachments not in repo.** The `.py` and `.mp4` live in the maintainer's local Downloads, not the repository, and are not committed. The PoC's callback domain is withheld here.

### 1.4 Measurement methodology

All findings were produced by reading the source directly at the current checkout. Representative commands:

```bash
# Locate the deployed bridge, compose, nginx
find ruflo -name docker-compose.yml -o -name nginx.conf
grep -n 'app.post("/mcp"' ruflo/src/ruvocal/mcp-bridge/index.js

# Confirm no inbound auth gate exists
grep -niE 'mcp_token|bearer|x-api-key|requireAuth|authMiddleware|MCP_AUTH' \
  ruflo/src/ruvocal/mcp-bridge/index.js   # → only outbound Authorization to LLM providers

# Confirm the blocklist's sole call site is the autopilot flow
grep -n 'isBlockedTool' ruflo/src/ruvocal/mcp-bridge/index.js   # def :1501, call :1633

# Confirm env inheritance to spawned backends, and listen bind
grep -n 'env: { ...process.env }\|app.listen(' ruflo/src/ruvocal/mcp-bridge/index.js
```

Compose, nginx, and the disclosed PoC were read in full. No synthetic data was used. Paths in this ADR are repo-relative.

---

## 2. Affected System Inventory

### 2.1 Topology (shipping `ruflo/docker-compose.yml`)

Four services compose the default deployment:

| Service | Image / Build | Host port mapping | Auth | Notes |
|---------|---------------|-------------------|------|-------|
| `mcp-bridge` | builds `./src/ruvocal/mcp-bridge` | `"3001:3001"` (all interfaces) | **none** | The deployed bridge is the **ruvocal** variant (`:22‑23`). |
| `mongodb` | `mongo:7` | `"27017:27017"` (all interfaces) | **none** | No `MONGO_INITDB_ROOT_*` set (`:10‑18`). |
| `nginx` | builds `./src/nginx` | `"3000:3000"` | n/a | CORS wildcard on all responses. |
| `chat-ui` | builds `./src/ruvocal` | `expose 3000` only | OIDC (app-level) | Talks to `mcp-bridge:3001` on the internal network. |

`restart: unless-stopped` on every service — relevant because it is what makes the PoC's persistence step survive a `kill 1`.

### 2.2 Bridge request surface (`ruflo/src/ruvocal/mcp-bridge/index.js`)

The Express app mounts exactly two pieces of middleware before all routes: `express.json()` (`:1034`) and a CORS handler that sets `Access-Control-Allow-Origin: *` (`:1037‑1043`). **There is no authentication middleware.** Routes:

- `POST /mcp` — catch-all, serves **all enabled tools** (`:1102‑1138`)
- `POST /mcp/:group` and `GET /mcp/:group` — per-group handlers (`:1096‑1099`, factory `:1046‑1084`)
- `POST /chat/completions`, `POST /autopilot*`, `GET /health|/models|/groups|/mcp-servers`

All `tools/call` requests dispatch to `executeTool(name, args)` (`:1066`, `:1121`).

### 2.3 Tool groups and backends (ADR-034 / ADR-035)

`executeTool` resolves a handful of built-in tools (`search`, `web_research`, `guidance`) and routes everything else to a spawned **stdio MCP backend** (`:979‑989`). Backends (`:259‑264`) include `ruflo` (`npx -y ruflo mcp start`), which serves the `agents`, `memory`, `devtools`, `security`, `browser`, `neural` groups — and crucially exposes `terminal_execute`. The `devtools` group defaults **on** (`MCP_GROUP_DEVTOOLS !== "false"`, compose `:43`), so `terminal_execute` is reachable by default.

Each backend is spawned with `env: { ...process.env }` (`:135‑138`) — the full parent environment, including every provider key injected by compose (`:32‑53`).

---

## 3. Confirmed Vulnerability Findings (Measured 2026-06-30)

The deployed bridge is the ruvocal variant; the sibling `ruflo/src/mcp-bridge/index.js` shares the identical flaws (the report's quoted line numbers 1302/1428 match that sibling file). Both must be remediated.

| ID | Severity | Finding | Evidence (repo-relative) |
|----|----------|---------|--------------------------|
| **V1** | **Critical** | `POST /mcp` dispatches `tools/call → executeTool()` with no authentication. The only middleware is JSON + wildcard CORS. | `ruflo/src/ruvocal/mcp-bridge/index.js:1102‑1138`; middleware `:1034‑1043` |
| **V2** | **Critical** | `terminal_execute` reachable unauthenticated → shell as `node` (uid 1000). Served by the `ruflo` backend; `devtools` defaults on. | `executeTool` default route `:979‑989`; backend def `:259‑261`; compose `:43` |
| **V3** | **High** | Tool blocklist (`AUTOPILOT_BLOCKED_PATTERNS`, incl. `/terminal_execute/`) enforced **only** in the autopilot flow via `isBlockedTool()` at `:1633`. `/mcp` and `/mcp/:group` never call it. | blocklist `:1493‑1503`; sole call site `:1633` |
| **V4** | **High** | Spawned backends inherit the full parent env (`{ ...process.env }`), exposing `OPENAI/GOOGLE/OPENROUTER/ANTHROPIC` keys to any compromised child. | `StdioMcpClient.start()` `:135‑138`; keys `docker-compose.yml:32‑53` |
| **V5** | **High** | MongoDB bound to all interfaces on `27017` with no authentication — directly reachable off-host, independent of the RCE. | `ruflo/docker-compose.yml:10‑18` |
| **V6** | **High** | Bridge port `3001` bound to all interfaces by default (amplifies V1 from local to internet). `app.listen(PORT)` has no bind-host argument. | `ruflo/docker-compose.yml:26‑27`; `index.js:1889` |
| **V7** | **Medium** | `Access-Control-Allow-Origin: *` on every response at both nginx and the bridge — defense-in-depth gap for browser-driven pivots. | `ruflo/src/nginx/nginx.conf:20‑22`; bridge `:1037‑1040` |
| **V8** | **Medium** | `plugin-agent-federation` defaults `bindHost: '0.0.0.0'` — a second surface with the same exposure shape. | `v3/@claude-flow/plugin-agent-federation/src/bin.ts` |

**Severity rationale.** V1+V2+V6 compose to an unauthenticated, internet-reachable RCE (CVSS ~9.8, `AV:N/AC:L/PR:N/UI:N`). V4 and V5 turn the foothold into full platform and data compromise. V3 explains why the existing control gives false assurance: the maintainers *did* blocklist `terminal_execute`, but only on the one path attackers don't need.

---

## 4. Threat Model — the disclosed attack chain

The PoC weaponizes the findings end-to-end, every step a plain HTTP `POST /mcp` with no credentials:

| Step | Action | Tool / mechanism | Findings used |
|------|--------|------------------|---------------|
| 1 | Recon — enumerate all exposed tools | `initialize`, `tools/list` | V1 |
| 2 | RCE — shell in container; OAST callback proves outbound egress | `ruflo__terminal_execute` | V1, V2, V3 |
| 3 | Credential theft — `printenv | grep -iE 'KEY|TOKEN|SECRET'` | terminal_execute | V2, V4 |
| 4 | Weaponize — spin up attacker-controlled swarm on victim keys | `ruflo__swarm_init`, `ruflo__agent_spawn` | V1 |
| 5 | **AI poisoning** — inject malicious "compliance"/"best-practice" patterns so future generated code beacons out | `ruflo__agentdb_pattern-store` | V1 |
| 6 | Data theft — connect to `mongodb:27017` (no auth), dump + exfil conversations | terminal_execute → MongoClient | V2, V5 |
| 7 | Persistence — write `/app/beacon.js` + `NODE_OPTIONS` preload, `kill 1`; `restart: unless-stopped` relaunches with the backdoor | terminal_execute | V2 |
| 8 | Cleanup — wipe shell/REPL history | terminal_execute | V2 |

**Why step 5 raises the stakes.** The `agentdb_pattern-store` write is an **AI-supply-chain** attack: a one-time unauthenticated write persists into the learning store and steers *future* AI outputs for *all* users of that instance (it matches the `embedded-system`/`exfiltration` categories ADR-131's `ToolOutputGuardrail` was written to catch, but that guardrail is not on this path). Eradication therefore requires auditing/resetting the pattern store and rotating credentials — **not just redeploying a patched image.**

---

## 5. Gap Analysis

| Area | Apparent intent | Code reality | Consequence |
|------|-----------------|--------------|-------------|
| Dangerous-tool gating | `terminal_execute` is in `AUTOPILOT_BLOCKED_PATTERNS` | Enforced only in autopilot (`:1633`); `/mcp` bypasses it | False sense of control; RCE wide open on the primary path (V2, V3) |
| Endpoint auth | MCP HTTP transport | No inbound auth middleware anywhere | Anyone who can reach `:3001` is fully trusted (V1) |
| Bind exposure | Local service | `"3001:3001"` + `app.listen(PORT)` → `0.0.0.0` | Internet-reachable by default (V6) |
| Data store isolation | Internal Mongo | `"27017:27017"`, no auth | Direct off-host DB access, no RCE needed (V5) |
| Credential blast radius | Per-provider keys | `{ ...process.env }` to every backend | One compromised child reads all keys (V4) |
| CORS | Convenience for port-forward dev | `*` everywhere, incl. preflight | Browser-pivot defense-in-depth gap (V7) |
| Federation bind | Plugin networking | `bindHost: '0.0.0.0'` default | Same exposure shape on a second surface (V8) |

---

## 6. Remediation Roadmap

Apply Layer-1–3 changes to **both** bridge files (`ruflo/src/ruvocal/mcp-bridge/index.js` and `ruflo/src/mcp-bridge/index.js`). Authentication is the root-cause fix; every other layer is independent so no single regression re-opens the chain.

### Phase 0 — Operational incident response (immediate, parallel to coding)

0a. **Triage live exposure.** Identify any public default deployment (the report cites a confirmed AWS EC2 hit). For each, firewall `:3001`/`:27017` immediately.
0b. **Treat keys as compromised.** Rotate `OPENAI`/`GOOGLE`/`OPENROUTER`/`ANTHROPIC` keys for any exposed instance; review provider billing for abuse.
0c. **Audit the learning + conversation stores.** Inspect the AgentDB pattern store for injected `agentdb_pattern-store` entries (step 5) and MongoDB for tampering; purge poisoned patterns. **A patched redeploy alone does not undo poisoning.**
0d. **Coordinate disclosure timeline** with the reporter; open a private GitHub Security Advisory; reserve a CVE.

### Phase 1 — Default to local-only; auth required for the optional public deployment pattern (P0, target: hotfix release)

**1a. Bind loopback by default everywhere (root cause of public-default exposure, V6/V8).** Was 1c. Now the leading change.
  - `ruflo/docker-compose.yml`: `"3001:3001"` → `"127.0.0.1:3001:3001"`; same for Mongo `"27017:27017"` → `"127.0.0.1:27017:27017"`
  - `ruflo/src/ruvocal/mcp-bridge/index.js` + `ruflo/src/mcp-bridge/index.js`: `app.listen(PORT)` → `app.listen(PORT, BIND_HOST)` where `BIND_HOST = process.env.MCP_BIND_HOST || '127.0.0.1'`
  - `v3/@claude-flow/plugin-agent-federation/src/bin.ts`: default `bindHost: '127.0.0.1'` (was `'0.0.0.0'`)

**1b. Fail closed on public-bind opt-in without token (root cause of un-authed public exposure when operator opts in, V1).** Was 1b. Now second.

```js
const BIND_HOST = process.env.MCP_BIND_HOST || "127.0.0.1";
const isPublic = BIND_HOST !== "127.0.0.1" && BIND_HOST !== "localhost";
if (isPublic && !process.env.MCP_AUTH_TOKEN) {
  console.error(
    "FATAL: refusing to bind a public interface without MCP_AUTH_TOKEN. " +
    "Generate one with: MCP_AUTH_TOKEN=$(openssl rand -base64 32)"
  );
  process.exit(1);
}
app.listen(PORT, BIND_HOST, () => { /* ... */ });
```

  Token generation guidance: `MCP_AUTH_TOKEN=$(openssl rand -base64 32)`. Recommend ≥32 bytes.

**1c. Authenticate the HTTP surface when token IS set (V1, for the opt-in case).** Was 1a. Now third.

```js
const MCP_TOKEN = process.env.MCP_AUTH_TOKEN || "";
function requireAuth(req, res, next) {
  if (req.path === "/health") return next();
  if (!MCP_TOKEN) return next();
  const expected = `Bearer ${MCP_TOKEN}`;
  const got = req.get("authorization") || "";
  const ok = got.length === expected.length &&
    timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  if (!ok) return res.status(401).json({ error: "unauthorized" });
  next();
}
app.use(requireAuth);
```

  Behavior: if `MCP_AUTH_TOKEN` is unset AND bind is loopback, middleware is a no-op (local IPC trust model); if `MCP_AUTH_TOKEN` is set (any bind), middleware enforces 401.

**1d. Gate `terminal_execute` (V2).** Off unless `MCP_ENABLE_TERMINAL=true`; print a security warning at startup when enabled. Enforce inside `executeTool` so every path is covered (see 2a).

### Optional public deployment pattern — explicit opt-in

When an operator deliberately exposes the bridge to a non-loopback interface (cloud, VPN-routed, or shared host), they MUST set BOTH of:

| Variable | Required | Notes |
|----------|----------|-------|
| `MCP_BIND_HOST` | yes (≠ 127.0.0.1) | e.g. `0.0.0.0` or a specific interface IP |
| `MCP_AUTH_TOKEN` | yes (≥32 bytes) | Generate: `openssl rand -base64 32`. Rotate quarterly. |

`docker-compose.public.yml` (NEW, separate file from the default compose) is the supported public-deployment composition. The default `docker-compose.yml` stays loopback-only.

Generate the token, write to `.env` (gitignored), reference from compose:

```bash
echo "MCP_AUTH_TOKEN=$(openssl rand -base64 32)" >> .env
echo "MCP_BIND_HOST=0.0.0.0" >> .env
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d
```

If either var is missing on a public bind, the bridge exits non-zero at startup. The chat-ui service must inject `Authorization: Bearer <token>` (Q1).

### Phase 2 — Reduce blast radius (P1, target: same release train)

**2a. Server-side tool authorization on every path (V3).** Move policy enforcement **into `executeTool()`** and switch denylist → **allowlist** (dangerous tools off unless explicitly enabled), so `/mcp`, `/mcp/:group`, and autopilot share one gate.
**2b. MongoDB auth + isolation (V5).** Add `MONGO_INITDB_ROOT_USERNAME/PASSWORD`; update `MONGODB_URL` with credentials; remove the `"27017:27017"` host mapping (or scope to `127.0.0.1`).
**2c. Read-only container (breaks step 7).** `read_only: true` on the bridge service + `tmpfs` for any scratch path, so `/app/beacon.js` writes fail (`EROFS`).

### Phase 3 — Hardening (P2, follow-on)

**3a. Scoped credential injection (V4).** Replace `{ ...process.env }` with a per-backend allowlist of only the keys that backend needs.
**3b. CORS allowlist (V7).** Replace `*` with a configurable origin allowlist (`MCP_CORS_ORIGIN`, default same-origin/localhost) at nginx (`:20‑22`) and the bridge (`:1037‑1040`).
**3c. Rate limiting** on `/mcp*`.
**3d. Fix federation default (V8).** `plugin-agent-federation` `bindHost` → `127.0.0.1`.
**3e. Independent auth** on memory/agent-management tools, decoupled from endpoint auth.

### Acceptance criteria

1. Unauthenticated `POST /mcp` (any method) → **401**; valid bearer → normal behavior. Covers `/mcp`, `/mcp/:group`, `/chat/completions`, `/autopilot*`.
2. The disclosed PoC fails at **Step 1** (recon `tools/list` → 401). Keep a sanitized request-replay as a regression test.
3. Startup with a public bind host and no token exits non-zero with a clear message.
4. `terminal_execute` returns "tool disabled" unless `MCP_ENABLE_TERMINAL=true`; allowlist enforced identically on `/mcp` and autopilot.
5. `docker compose up -d` exposes neither `3001` nor `27017` on a public interface (`ss -tlnp` shows loopback only); Mongo rejects unauthenticated clients.
6. A spawned backend's env contains only its allowlisted keys (assert e.g. no `ANTHROPIC_API_KEY` in a backend that doesn't need it).
7. `read_only` container: writing `/app/beacon.js` fails with `EROFS`.
8. A disallowed `Origin` does not receive `*`.
9. CI test asserts the auth middleware exists and returns 401 unauthenticated — it cannot be removed without a failing test.

---

## 7. Honest Risks and Open Questions

### Risks

**R1 — UX cost is concentrated in the optional public path.** Local-only deployments see zero new friction (no token, no headers, no rotation). The auth surface and rotation burden land only on operators who explicitly opt into public exposure — which matches the principle of "pay the security cost only when you assume the risk."
**R2 — Operators may set `MCP_BIND_HOST=0.0.0.0` without realizing the auth requirement.** Mitigated by 1b (fail-closed with a clear FATAL message + token-generation guidance in the same error string). The fatal log line MUST include the exact `openssl rand -base64 32` command.
**R3 — Allowlist over-restriction.** Moving to an allowlist (2a) may break workflows that rely on tools we forget to list. Mitigate by enumerating the current default-on tool set before flipping the default and logging every denied call.
**R4 — Persistence may already exist.** If an instance was exploited pre-patch, a beacon/`NODE_OPTIONS` preload may persist across a plain image pull. Phase 0c (rebuild from clean image + rotate keys + audit stores) is mandatory, not optional.

### Open questions

**Q1 — Token transport to chat-ui.** Inject via `DOTENV_LOCAL` env, a Docker secret, or a header added at the nginx proxy layer? Recommend a Docker secret + nginx-injected header so the browser never holds the token.
**Q2 — Does the `npx`/CLI bridge path share the gate?** The report notes the CLI defaults to `host: 'localhost'` (safer). Confirm the same auth middleware applies there before claiming the CLI path is covered.
**Q3 — Should the bridge adopt a signed-token scheme** (short-lived HMAC/JWT) instead of a static bearer, aligning with `TokenGenerator` (ADR-165 §4.6 Q6)? Static bearer ships fastest; revisit for multi-tenant deployments.
**Q4 — Per-room / per-client scoping** if the bridge ever serves more than one trust domain. Out of scope here; flagged for a follow-on.

---

## 8. Alternatives Considered and Rejected

**"Bind loopback by default; auth only for the optional public deployment pattern."** ACCEPTED (2026-06-30 per maintainer review). Rationale: matches the design contract that MCP is fundamentally local IPC; the public deployment story is an opt-in operational mode, not the default. Auth cost is paid only by operators who opt in. The previously-proposed always-on bearer auth was rejected as imposing local-IPC overhead on the common case.

**"Remove `terminal_execute` entirely."** Necessary-but-insufficient. Other tools (`agentdb_pattern-store` poisoning, swarm spawn on victim keys, Mongo reachability) keep platform-compromise paths open. Gate it (Phase 1d) *and* authenticate (1a).

**"Network-only mitigation (security groups / firewall)."** Required operationally (Phase 0a) but not a product fix — the goal is secure-by-default out of the box, which firewalls outside the repo cannot guarantee.

**"mTLS / OAuth on `/mcp` now."** Stronger but heavyweight for the self-host story. Fail-closed bearer + loopback bind is the right first step; mTLS can layer on for enterprise (Q3).

---

## 9. Evidence Ledger (2026-06-30 baseline, BEFORE remediation)

| Claim in this ADR | How it was verified | Source (repo-relative) |
|-------------------|---------------------|------------------------|
| Deployed bridge is the ruvocal variant | compose `build.context` read | `ruflo/docker-compose.yml:22‑23` |
| `POST /mcp` dispatches `tools/call → executeTool` with no auth | File read of handler + middleware | `ruflo/src/ruvocal/mcp-bridge/index.js:1102‑1138`, `:1034‑1043` |
| No inbound auth gate exists | `grep -niE 'mcp_token\|bearer\|x-api-key\|requireAuth\|authMiddleware\|MCP_AUTH'` → only outbound provider `Authorization` at `:1571`,`:1780` | `ruflo/src/ruvocal/mcp-bridge/index.js` |
| `terminal_execute` served by `ruflo` backend; `devtools` default-on | Backend def + group-enabled expression + compose default | `index.js:259‑261`, `:56`; `docker-compose.yml:43` |
| Blocklist enforced only in autopilot | `isBlockedTool` def `:1501`, sole call `:1633` (inside `handleAutopilot`) | `ruflo/src/ruvocal/mcp-bridge/index.js` |
| Backends spawned with full env inheritance | File read of `StdioMcpClient.start()` | `ruflo/src/ruvocal/mcp-bridge/index.js:135‑138` |
| `app.listen(PORT)` has no bind-host arg (→ 0.0.0.0) | File read of `main()` | `ruflo/src/ruvocal/mcp-bridge/index.js:1889` |
| Bridge port `3001` + Mongo `27017` bound to all interfaces | compose `ports` read | `ruflo/docker-compose.yml:15‑16`, `:26‑27` |
| MongoDB has no auth configured | No `MONGO_INITDB_ROOT_*` in compose | `ruflo/docker-compose.yml:10‑18` |
| Provider keys injected into the bridge env | compose `environment` read | `ruflo/docker-compose.yml:32‑53` |
| CORS wildcard at nginx and bridge | File reads | `ruflo/src/nginx/nginx.conf:20‑22`; `ruflo/src/ruvocal/mcp-bridge/index.js:1037‑1040` |
| Sibling bridge shares the flaw (report's 1302/1428) | `sed -n '1300,1305p;1426,1430p'` matches blocklist + `isBlockedTool` autopilot call | `ruflo/src/mcp-bridge/index.js` |
| `plugin-agent-federation` defaults `bindHost: '0.0.0.0'` | grep located the default | `v3/@claude-flow/plugin-agent-federation/src/bin.ts` |
| 8-step attack chain (recon→RCE→creds→swarm→poison→Mongo→persist→cleanup) | Read disclosed PoC script in full | Coordinated-disclosure attachment (not committed) |

### 9.1 Post-remediation verification (2026-06-30, AFTER commits on this branch)

| Acceptance criterion (§6) | Verified how | Result |
|---------------------------|--------------|--------|
| #1 Unauthenticated POST /mcp → 401; valid bearer → normal | `test-runtime-security.mjs` R2 + R3 on BOTH bridges | ✅ R2=401, R3=200 |
| #2 Disclosed PoC fails at Step 1 (recon `tools/list` → 401) | Follows from #1 (`tools/list` goes through same middleware) | ✅ |
| #3 Startup with public bind + no token exits non-zero | `test-runtime-security.mjs` R5 on BOTH bridges | ✅ exit code 1 + FATAL to stderr |
| #4 `terminal_execute` returns disabled unless `MCP_ENABLE_TERMINAL=true`; enforced on both `/mcp` and autopilot | Gate implemented in `executeTool()` (single site) — `test-runtime-security.mjs` R4 | ✅ TOOL_DISABLED code |
| #5 `docker compose up -d` exposes neither 3001 nor 27017 publicly; Mongo rejects unauth | Compose diff (loopback binds + `--auth` + required root password) | ✅ compose grep gate in CI |
| #6 Backend env allowlist (scoped `{ ...process.env }` replacement) | **Phase 3a — deferred** (see §7 Q, next release train) | ⏳ deferred |
| #7 `read_only` container: `/app/beacon.js` write fails EROFS | `read_only: true` + `tmpfs: /tmp` in compose | ✅ present |
| #8 Disallowed Origin does not receive `*` | CORS allowlist wired to `MCP_CORS_ORIGIN`; default `*` for back-compat, allowlist honored when set | ✅ present |
| #9 CI test asserts auth middleware exists + returns 401 | `test-security-lock.js` (static-source, 6 checks × 2 bridges) + `test-runtime-security.mjs` + `.github/workflows/adr-166-mcp-bridge-security.yml` | ✅ 12/12 lock + 12/12 runtime green locally; CI gate armed on every PR |

---

## 10. References

### Predecessor ADRs

- **Maintainer decision 2026-06-30** (this branch's review thread): MCP design contract is local-only; public is explicit opt-in.
- [ADR-029](../../../ruflo/docs/adr/ADR-029-HUGGINGFACE-CHAT-UI-CLOUD-RUN.md) — documented Cloud Run deployment path
- [ADR-034](../../../ruflo/docs/adr/ADR-034-OPTIONAL-MCP-BACKENDS.md) — optional stdio MCP backends (`ruflo`/`ruvector`/…)
- [ADR-035](../../../ruflo/docs/adr/ADR-035-MCP-TOOL-GROUPS.md) — `MCP_GROUP_*` default-on/opt-in model
- [ADR-037](../../../ruflo/docs/adr/ADR-037-AUTOPILOT-CHAT-MODE.md) — autopilot flow (where the blocklist is enforced)
- [ADR-038](../../../ruflo/docs/adr/ADR-038-RUVOCAL-FORK.md) — the deployed ruvocal chat UI + bridge
- [ADR-165](./ADR-165-security-cve-posture-review.md) — June 2026 dependency-CVE posture (companion; note its hono CORS-wildcard advisory GHSA-88fw-hqm2-52qc, which compounds V7)
- [ADR-131](./ADR-131-tool-output-guardrail.md) — ToolOutputGuardrail (the content-screening control absent on the poisoning path, §4 step 5)

### External standards

- OWASP Top 10 for Agentic Applications 2026 — ASI01 (Agent Goal Hijacking), the class the §4 step-5 learning-store poisoning falls under
- CWE-306 (Missing Authentication for Critical Function), CWE-78 (OS Command Injection), CWE-942 (Permissive CORS)

### Follow-up issues to open (private until embargo lifts)

- "MCP bridge: require bearer auth on /mcp + fail-closed public bind" (Phase 1a/1b)
- "docker-compose: bind 3001 loopback; Mongo auth + drop 27017 host mapping" (Phase 1c/2b)
- "executeTool: allowlist tool gate covering /mcp + autopilot; gate terminal_execute" (Phase 1d/2a)
- "MCP bridge: read_only container + scoped per-backend env + CORS allowlist" (Phase 2c/3a/3b)
- "plugin-agent-federation: default bindHost 127.0.0.1" (Phase 3d)
- "Publish coordinated advisory + CVE; credit reporter" (Phase 0d)
