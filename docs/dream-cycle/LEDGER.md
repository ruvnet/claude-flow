# Dream Cycle Ledger

Durable cross-night memory for the Ruflo Nightly Dream Cycle routine
(`trig_01HpEqAcEP7wzrxy3TzakrQ2`, `.github`-external, runs 06:00 UTC daily).
Read at the start of every run (STEP 1 of the v2 prompt) before the agent
touches `gh` at all — a fresh cloud checkout otherwise has zero memory of
prior nights beyond a `gh issue list` grep.

**Why this file exists**: the v1 routine (2026-05-25 through 2026-08-13)
filed 80 nightly research issues with no durable follow-through signal —
each night only checked whether it was repeating itself, never whether
anyone had acted on what it proposed. Backfilled from the full issue
history below: **4 shipped (5%), 1 rejected, 75 (94%) never touched**, some
over 2.5 months stale. The v2 prompt uses this table to bias toward
attempting a real Flywheel evaluation (STEP 3.5) over another docs-only
proposal when the merge rate over the trailing 14 nights is 0.

## Backfill (one-time, computed 2026-08-13T14:xx UTC from `gh issue list`)

`PR`, `Evaluated?`, and `Verdict` are placeholders for this backfill batch —
those columns didn't exist before v2 and weren't tracked live. `Fate` for
these rows reflects issue state only (MERGED = issue closed as completed,
CLOSED = closed not-planned/duplicate, STALE = open >14 days as of the
backfill date, OPEN = open ≤14 days). From v2 onward, each row is written
live by STEP 9 of the same night it was researched, and `Fate` in the last
column of a LATER row reflects what STEP 1 found when it re-checked EARLIER
rows — not a static snapshot.

| Date | Deep | Finding (one line) | Issue | PR | Evaluated? | Verdict | Prior-night fates recorded this run |
|---|---|---|---|---|---|---|---|
| 2026-05-26 | security | Indirect prompt injection critical gap vs OWASP ASI01 + inte | #2149 | - | backfill | n/a | STALE |
| 2026-05-27 | intelligence | SR²AM 8B=120–355B via simulative planning — 95% token gap +  | #2156 | - | backfill | n/a | STALE |
| 2026-05-29 | swarm | SWARM+ hierarchical PBFT 97-98% latency gain at 1K agents +  | #2223 | - | backfill | n/a | STALE |
| 2026-05-30 | performance | MV-HNSW 14× gap + LAMaS 38-46% latency + security,hive-mind  | #2241 | - | backfill | n/a | STALE |
| 2026-05-31 | security | MCP auth gap (40.55% no-auth) + AIRGuard −85% + authorizatio | #2248 | - | backfill | n/a | STALE |
| 2026-06-01 | security | SCH plugin supply-chain 77.67% breach + 0% detection; ADR-14 | #2254 | - | backfill | n/a | STALE |
| 2026-06-02 | intelligence | SONA behavioral drift undetected — embedding-space trait aud | #2265 | - | backfill | n/a | STALE |
| 2026-06-03 | memory | VikingMem +30% temporal compression gap in AgentDB + plugins | #2277 | - | backfill | n/a | STALE |
| 2026-06-04 | swarm | AdaptOrch +22.9% topology gain gap — Ruflo fixed-hierarchica | #2289 | - | backfill | n/a | STALE |
| 2026-06-05 | performance | LAMaS 38-46% critical-path gap — Ruflo fixed-hierarchical mi | #2294 | - | backfill | n/a | STALE |
| 2026-06-06 | security | memory write poisoning (9 vulns, 4 channels) leaves AgentDB  | #2303 | - | backfill | n/a | STALE |
| 2026-06-07 | intelligence | RHO self-supervised harness optimization +19pp SWE-Bench Pro | #2309 | - | backfill | n/a | STALE |
| 2026-06-08 | memory | multi-signal retrieval gap vs Mem0 SOTA (94.4% LongMemEval)  | #2316 | - | backfill | n/a | STALE |
| 2026-06-08 | meta | ADR-147 collision across 6 open PRs + 0 merges in 14 nights | #2324 | - | backfill | n/a | STALE |
| 2026-06-09 | swarm | RL orchestration 5-decision gap (no stopping-RL in any frame | #2332 | - | backfill | n/a | STALE |
| 2026-06-10 | performance | DeLM shared-context +10.5pp SWE-bench gap (−50% cost) + secu | #2343 | - | backfill | n/a | STALE |
| 2026-06-11 | security | runtime governance gap — Microsoft AGT forecloses 7 ASI risk | #2353 | - | backfill | n/a | STALE |
| 2026-06-12 | intelligence | Agents-K1 KG gap — flat HNSW ReasoningBank cannot multi-hop; | #2362 | - | backfill | n/a | STALE |
| 2026-06-13 | memory | AgentDB lacks temporal decay — flat HNSW causes semantic dri | #2367 | - | backfill | n/a | STALE |
| 2026-06-14 | swarm | Shapley credit routing gap (+23.66% vs SHARP SOTA) + ruview- | #2378 | - | backfill | n/a | STALE |
| 2026-06-15 | performance | Arbor tree-search +193% throughput gap + security,hive-mind  | #2381 | - | backfill | n/a | STALE |
| 2026-06-16 | security | MCP threat coverage gap 34% vs 91% MCPSHIELD + intelligence, | #2393 | - | backfill | n/a | STALE |
| 2026-06-17 | intelligence | benchmark contamination +5-15pp gap + RetailBench long-horiz | #2401 | - | backfill | n/a | STALE |
| 2026-06-18 | memory | bi-temporal HNSW gap +10.4pp LongMemEval_S (Engram) + OPD-Ev | #2410 | - | backfill | n/a | STALE |
| 2026-06-19 | swarm | AdaptOrch +22.9% SWE-bench via adaptive topology — hierarchi | #2419 | - | backfill | n/a | STALE |
| 2026-06-20 | performance | Ruflo missing task-completion benchmark vs LangGraph 62% — M | #2427 | - | backfill | n/a | STALE |
| 2026-06-21 | security | 83.9% of sandbox harms pass semantic checks — execution-phas | #2429 | - | backfill | n/a | STALE |
| 2026-06-22 | intelligence | FLARE myopic commitment gap — SONA has no lookahead simulati | #2435 | - | backfill | n/a | STALE |
| 2026-06-23 | memory | semantic drift from repeated summarization cycles — AgentDB  | #2452 | - | backfill | n/a | STALE |
| 2026-06-24 | swarm | SGTO-MAS trust-weighted consensus closes 5.3% adversarial ga | #2456 | - | backfill | n/a | STALE |
| 2026-06-25 | performance | 5× Grade A evidence for stateful KV-cache + execution graph  | #2462 | - | backfill | n/a | STALE |
| 2026-06-26 | security | MCP tool permission boundaries unguarded — ShareLock >90% AS | #2471 | - | backfill | n/a | STALE |
| 2026-06-27 | intelligence | SKILL-DISCO trace-to-skill distillation closes 22%+ benchmar | #2478 | - | backfill | n/a | STALE |
| 2026-06-28 | memory | TRUSTMEM+MemStrata expose AgentDB write-verification and tem | #2485 | - | backfill | n/a | STALE |
| 2026-06-29 | swarm | RL stopping policy is the last un-automated orchestration su | #2495 | - | backfill | n/a | STALE |
| 2026-06-30 | performance | TokenDance (Grade A) proves 17.5× cross-agent KV-cache reduc | #2510 | - | backfill | n/a | STALE |
| 2026-07-01 | security | AgentDB retrieval pipeline has 0 certified defenses — SMSR p | #2516 | - | backfill | n/a | MERGED |
| 2026-07-02 | intelligence | HyDRA dimension routing +12.9% cost savings / SkillCAT +40%  | #2526 | - | backfill | n/a | STALE |
| 2026-07-03 | memory | AutoMem proves RL-trained memory ops yield 2x–4x long-horizo | #2536 | - | backfill | n/a | STALE |
| 2026-07-04 | swarm | Inverse-Wisdom Law (Grade A) proves larger swarms harden wro | #2559 | - | backfill | n/a | STALE |
| 2026-07-05 | performance | PolyKV shared KV pool cuts 15-agent memory 97.7% (Grade A) + | #2576 | - | backfill | n/a | STALE |
| 2026-07-06 | security | 40-75% agent attack rate (Grade A) exposes VMG + RepE IPI ga | #2588 | - | backfill | n/a | MERGED |
| 2026-07-07 | intelligence | SkillRL recursive skill acquisition exposes static SONA cata | #2597 | - | backfill | n/a | STALE |
| 2026-07-08 | memory | NapMem RL-navigated pyramid exposes passive-retrieval gap in | #2606 | - | backfill | n/a | STALE |
| 2026-07-09 | swarm | ND-MARL 83× zero-shot scale + HNSW-comms-fabric gap in ruvec | #2616 | - | backfill | n/a | STALE |
| 2026-07-10 | performance | Workflow-Atomic Scheduling closes 1.6×–5.9× latency gap — no | #2623 | - | backfill | n/a | STALE |
| 2026-07-11 | security | plugin supply chain 0.00% detection gap + ADR-179 + intellig | #2630 | - | backfill | n/a | STALE |
| 2026-07-12 | intelligence | Harness Effect 41% cost gap + heterogeneous 2.3× accuracy ga | #2641 | - | backfill | n/a | STALE |
| 2026-07-13 | memory | RecMem −87% token cost + SelfMem +48.7% BEAM expose eager-co | #2655 | - | backfill | n/a | STALE |
| 2026-07-14 | swarm | Swarm Skills trajectory distillation + SWARM+ 97-98% latency | #2664 | - | backfill | n/a | STALE |
| 2026-07-16 | security | IPI attack success 10.7–29.6% exposes missing RuntimeAuthori | #2692 | - | backfill | n/a | CLOSED |
| 2026-07-17 | intelligence | SLEUTH +11pt multi-hop gap + GRADE 44% runtime gap unimpleme | #2701 | - | backfill | n/a | STALE |
| 2026-07-18 | memory | selective persistence 97× token reduction + plugins,automati | #2715 | - | backfill | n/a | STALE |
| 2026-07-19 | swarm | IB+VQ messaging 181.8% task gain breaks performance-bandwidt | #2727 | - | backfill | n/a | STALE |
| 2026-07-20 | performance | world-model 14× agent-planning speedup (DSWorld) unmasks unv | #2739 | - | backfill | n/a | STALE |
| 2026-07-21 | security | NCA gate + PlanFlip planning-phase injection + MemPoison bli | #2752 | - | backfill | n/a | STALE |
| 2026-07-22 | intelligence | SCM routed memory 86% LongMemEval exposes Ruflo CMR gap + ca | #2760 | - | backfill | n/a | STALE |
| 2026-07-23 | memory | OAS budget-operator selection +48% exposes Ruflo consolidati | #2763 | - | backfill | n/a | STALE |
| 2026-07-24 | swarm | ClawArena shows privilege-granting is #1 orchestration bottl | #2768 | - | backfill | n/a | STALE |
| 2026-07-25 | performance | AA-AgentPerf 23.6× gap + mixture-of-agents ACL 2026 Pareto-o | #2778 | - | backfill | n/a | STALE |
| 2026-07-26 | security | ShareLock MCP threshold poisoning + ChannelGuard gap + intel | #2783 | - | backfill | n/a | STALE |
| 2026-07-27 | intelligence | PoTRE 49.92% HLE — heterogeneous ensembles + capabilities,me | #2792 | - | backfill | n/a | STALE |
| 2026-07-28 | memory | MemIR provenance-role collapse gap in AgentDB flat storage + | #2803 | - | backfill | n/a | STALE |
| 2026-07-29 | swarm | TPSC pheromone consensus 50% agent reduction +11.6% fitness  | #2832 | - | backfill | n/a | MERGED |
| 2026-07-30 | performance | Two Calls Beat Five Agents 7.4× token gap + HalluProp pre-ho | #2862 | - | backfill | n/a | OPEN |
| 2026-07-30 | security | Implement ADR-377: AgentDB Retrieval Security Layer | #2873 | - | backfill | n/a | MERGED |
| 2026-07-31 | security | ALIBI adversarial code comment injection + SkillGate acceler | #2881 | - | backfill | n/a | OPEN |
| 2026-08-01 | security | MemSecBench memory poisoning gap in AgentDB + OwlPath 28.8%  | #2892 | - | backfill | n/a | OPEN |
| 2026-08-02 | intelligence | MANTA in-inference topology self-evolution (+5.8pp) exposes  | #2898 | - | backfill | n/a | OPEN |
| 2026-08-03 | memory | Zero-Mem -57.6% retrieval latency exposes AgentDB entity-con | #2902 | - | backfill | n/a | OPEN |
| 2026-08-04 | swarm | Stigmergic pheromone bus closes 50%-agent-reduction gap (ADR | #2918 | - | backfill | n/a | OPEN |
| 2026-08-05 | performance | 8.08× inference gap — agents converge on 1 framework, miss 1 | #2923 | - | backfill | n/a | OPEN |
| 2026-08-06 | security | AgentDB memory poisoning 84.2% persistence gap — Adaptive Tr | #2932 | - | backfill | n/a | OPEN |
| 2026-08-07 | intelligence | EnvACE World Rehearsal gap — SONA lacks pre-execution self-s | #2938 | - | backfill | n/a | OPEN |
| 2026-08-08 | memory | ScrubJay temporal decay collapses GenGap 5.7× — AgentDB peri | #2943 | - | backfill | n/a | OPEN |
| 2026-08-09 | swarm | SwarmAgentic PSO topology auto-generation +261.8% gap (ADR-3 | #2949 | - | backfill | n/a | OPEN |
| 2026-08-10 | performance | cross-agent KV cache sharing 7.8× prefill gap (ADR-381) + se | #2953 | - | backfill | n/a | OPEN |
| 2026-08-11 | security | ColluSkill 96% compositional evasion gap (ADR-382) + intelli | #2964 | - | backfill | n/a | OPEN |
| 2026-08-12 | intelligence | VibeLifeBench proactivity gap — SONA lacks background world- | #2979 | - | backfill | n/a | OPEN |
| 2026-08-13 | memory | TOKI bitemporal contradiction resolution gap in AgentDB + pl | #3008 | - | backfill | n/a | OPEN |

## v2 live entries start below

(STEP 9 of the v2 routine appends here nightly, starting 2026-08-14.)
