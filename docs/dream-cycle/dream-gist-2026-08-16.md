# Security SOTA Report — 2026-08-16

TL;DR: Tonight (2026-08-16, security deep-dive) verified two CVEs flagged by last night's research against Ruflo's own code and found neither applies — but the investigation surfaced a real, distinct gap: `ruflo init`/`ruflo init --upgrade` carry a pre-existing project's `.claude/settings.json` hooks and Bash allow-rules forward with zero review, the same trust shape as CVE-2025-59536. Shipped an advisory-only static scanner closing that gap, hardened it against six concrete bypasses an independent critic found, and disclosed what still isn't caught.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| CVE-2025-59536: settings.json hook injection bypasses Claude Code's trust dialog, fixed in Claude Code 1.0.111 | Check Point Research, Action1, The Hacker News (Feb 2026) | A |
| CVE-2025-6514: `mcp-remote` OAuth `authorization_endpoint` → OS command injection, fixed 0.1.16 | GitHub Advisory GHSA-6xpm-ggf7-wc3p, SentinelOne, JFrog | A |
| MCP spec's own "Local MCP Server Compromise" + "OAuth Authorization URL Validation" threat models formalize both risk classes | modelcontextprotocol.io spec, 2026-07-28 | A |
| OWASP Top 10 for Agentic Applications (2026) classifies tool/config poisoning under ASI01, recommends hashing/diffing configs on reconnect | OWASP GenAI project | B |

## Ruflo Current Capability

Ground-truthed both CVEs directly against code. **CVE-2025-59536 (hook RCE):** Ruflo's own hook dispatch (`.claude/helpers/hook-handler.cjs`, `v3/@claude-flow/hooks/src/registry/`) is a closed set of internal function handlers — no code path executes an arbitrary command string sourced from config. **Not vulnerable through Ruflo's own dispatch.** **CVE-2025-6514 (OAuth MITM):** no `mcp-remote` dependency anywhere in the repo; Ruflo's own OAuth client (`v3/@claude-flow/security/src/oauth/client.ts`) targets one hardcoded endpoint (`auth.cognitum.one`) with no dynamic-endpoint-discovery flow to exploit. **Not applicable.**

But `mergeSettingsForUpgrade()` (`executor.ts:352-353`) spreads a target project's *existing* settings.json hooks into the merged output unexamined, and `writeSettings()`'s inline merge (`:901-912`) does the same for Bash `permissions.allow` rules — a malicious fork/PR/compromised dependency planting a bad settings.json before a user runs `ruflo init`/`--upgrade` there gets it silently preserved, reported as a normal success, zero visibility. Same trust shape as CVE-2025-59536, different code path, genuinely unaddressed until tonight.

## Competitor Comparison

| Framework | Practice | Evidence | Grade | 2026 status |
|---|---|---|---|---|
| MCP spec | Formal consent-gated/sandboxed hook execution + OAuth URL allowlisting threat model | modelcontextprotocol.io | A | Live, RC 2026-07-28 |
| LangGraph | No hook-exec surface; 3+ deserialization-RCE advisories via checkpoint caching in trailing 12mo | GHSA-mhr3-j7m5-c7c9, "LangGrinch" CVE | A | Reactive patching |
| CrewAI | CERT/CC-coordinated disclosure: sandbox fallback bypassable via prompt injection → RCE/SSRF | CERT/CC VU#221883 | A | Patched, same untrusted-input→exec shape |
| AutoGen | Opt-in `LocalCommandLineCodeExecutor` runs LLM code at full host privilege; hardening in progress, no CVE yet | GitHub Discussions #7595 | B/C | Unresolved mid-2026 |

None of these frameworks publish a *preventive* control set as complete as the MCP spec's own; all patch reactively per-incident. Closing Ruflo's init-merge gap (even advisory-only) puts it ahead of that reactive-patch baseline for this specific class.

## Hypothesis

Given `ruflo init`/`--upgrade`'s settings-merge paths (`executor.ts:352-353`, `:901-912`) that carry a pre-existing settings.json's hooks/allow-rules forward unexamined, when a static advisory-only scanner (`scanSettingsForRisk`) inspects that content before the merge, then dangerous-looking entries should be surfaced as CLI warnings, subject to: (1) merge/write behavior itself is completely unchanged — never blocking; (2) existing init/executor tests remain green; (3) zero false positives on Ruflo's own 3 real generated settings.json variants.

## Benchmarks

24-sample hand-written fixture corpus (`benchmarks/settings-risk-corpus.json`, provenance disclosed in-file): 15 malicious (download|shell, base64/eval, wildcard Bash allow, dangerous commands), 9 benign (incl. 2 real Ruflo-generated hook strings). **Important limitation, found by the critic below and disclosed rather than hidden:** this corpus is byte-identical to the unit-test fixtures — its F1=1.0 re-measures test assertions, not independent accuracy.

## Evaluation

**evaluated: accepted, with caveats.** Baseline (no scanner): 0/15 malicious samples caught (recall=0), 0 false positives. Candidate: 15/15 caught, precision=recall=F1=1.0, 0 FP (`benchmarks/results/comparison-settings-risk-final.json`). An independent adversarial-critic agent (fresh session, no access to the corpus file) then read the actual regex source and constructed **6 concrete bypasses**: intermediate-pipe-stage downloads (`curl…|tee x|bash`), two-step download-then-exec, `eval`-wrapped base64, dangerous words reached via `python3 -c os.system(...)`, absolute-path-prefixed commands (`/bin/rm`), and unscoped/whitespace-evasive Bash allow-rules (`Bash(sudo:*)`, `Bash( * )`). **All 6 are now fixed** — switched from strict-adjacency regexes to word-boundary matching + downloader/shell-interpreter co-occurrence, added `sudo`/`eval` to the dangerous-word list, widened wildcard-allow matching to tolerate whitespace. Pinned as a genuinely held-out regression set in the test file (not copied into the scored corpus). Also self-identified and fixed during this candidate's own security review: untrusted snippet text is now ANSI/control-character-stripped before it reaches a CLI warning (a malicious hook could otherwise spoof terminal output via the very warning meant to flag it). Final state: 87/87 relevant tests green (1 pre-existing, unrelated environmental test failure confirmed caused by an unbuilt sibling package, not this candidate). **Disclosed, not fixed tonight:** credential/SSH-key exfiltration via scp/rsync, DNS-tunnel exfiltration, and any payload avoiding every listed token entirely — this is a best-effort heuristic, not a security boundary.

## Darwin Results

**Skipped.** Darwin's scope (routing weights, topology, prompt/memory/tool/tier/context/coordination parameters) has no analog for a static pattern scanner — there's no continuous parameter space to evolve. Recorded as an explicit scope-mismatch skip, not a failed-evaluation skip (distinct from the last two nights' Darwin skips, which were evaluation-failure skips).

## SOTA Proof & Witness

See §Witness in the linked issue for the full stamp (session commit, report hash, witness hash) and verifier procedure.

## Recommended Next Steps

1. **Merge tonight's advisory scanner** (draft PR) — closes a real, verified gap with zero blocking-behavior risk; all pre-declared success criteria held after independent critique and hardening.
2. **Follow-up candidate:** extend the dangerous-pattern set to credential-exfiltration shapes (scp/rsync to a remote host, DNS-tunnel patterns) — explicitly out of scope tonight, flagged by this session's own security review as the most likely next bypass class.
3. **File as a lightweight ADR-364 extension** (plugin-manifest hook scanning already exists for a sibling surface) rather than a new ADR — this is a narrow implementation, not an architectural decision.
