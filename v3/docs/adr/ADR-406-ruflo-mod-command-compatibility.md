# ADR 406: Ruflo mission control through compatible Claude Code mods

Status: Proposed

Date: 2026 10 01

Decision owner: Ruflo maintainers

Scope: Ruflo mission control, durable mission lifecycle, command discovery, slash command compatibility, optional mod interfaces, budgets, execution evidence, client recovery, packaging, and migration validation

Extends: ADR 404, Ruflo as a Claude Code Mod. Complements ADR 405, ruOS desktops as swarm hosts. Its cockpit interface is ADR 407. Preserves the policy and release authority boundaries in ADR 150, ADR 174, ADR 322A, and ADR 324/325 as referenced by the repository agent guide.

## 1. Decision

Build Ruflo mission control as an agent management interface inside Claude Code, backed by a durable runtime that is independent of any individual interface. The mission is the primary management object: objective, plan, agents, permissions, budget, execution, evidence, and acceptance criteria. Claude Code mods are one client; CLI, MCP, ruOS, and a future web interface use the same governed runtime contract.

This is a proposed product architecture, not a claim that a complete mission runtime or all client adapters already exist. Command compatibility is the foundation; mission lifecycle and recovery are additional implementation milestones.

Extend the existing Ruflo mod implementation with a canonical command registry and two compatible delivery adapters: existing Markdown command workflows and optional Claude Code mod interfaces. Preserve existing names, arguments, prompt semantics, tool access, policy decisions, and model visible results. Rich interfaces are additive and removable.

Complete coverage means every inventoried Ruflo command has a registry entry, a tested compatibility disposition, and a discoverable route. It does not mean every command becomes executable mod middleware. Prompt workflows remain prompt workflows until the engine provides a verified way to preserve their semantics. Unsupported commands remain available through their existing entry points.

Keep `plugins/ruflo-mods` within its present restricted capability boundary. Put command browsing and optional operation dispatch into a proposed separate plugin, `plugins/ruflo-workbench`, with an explicit capability declaration and separate opt in. Reuse `ruflo-swarm` views and command ownership rather than registering replacements for them.

No existing command is removed, renamed, or reassigned by this ADR. No package release, production policy change, or autonomous promotion is authorized by accepting the design alone.

## 2. Evidence and current state

The source review used Ruflo commit `27982983ea6cdc4767c0b6614a4ad9a9d9497cce`. Repository implementation and reported historical tests are distinct from fresh execution evidence. No Claude engine tests or benchmarks were run for this ADR.

| Observed source | Current behavior | Design implication |
|---|---|---|
| `plugins/ruflo-mods/hooks/register.ts` | Registers trust, noun, session, route, guard, learning, and cost components | Extend existing interfaces; do not create a competing core mod |
| `plugins/ruflo-mods/hooks/ownership.ts` | Only `route` and `post-edit` are ownable through `RUFLO_MODS_OWNS` | Guard ownership cannot be transferred through a convenience flag |
| ADR 404 | Core mod avoids process, network, model, and MCP calls; documents deferred reload and record persistence work | A CLI bridge belongs in a separately permissioned plugin |
| `plugins/ruflo-swarm/hooks/commands.ts` | Registers five namespaced commands and explicitly avoids its Markdown command names | Preserve these names and their owning plugin |
| `plugins/ruflo-swarm/hooks/actions/controller.ts` | Checks process exit codes, verifies some outcomes against disk, and expires destructive confirmations after 30 seconds | Reuse patterns, but add runtime request identity before claiming crash safe deduplication |
| `v3/@claude-flow/cli/src/commands/mods.ts` | Provides install, uninstall, status, doctor, and policy projection synchronization | Extend the existing CLI family instead of introducing a parallel installer |
| `.claude/commands/sparc/architect.md` | Contains instructions and alternate MCP/CLI activation paths | Executing a CLI operation alone is not semantic parity |
| `.claude-plugin/hooks/hooks.json` | Identifies a separate legacy POSIX hook package with native Windows limitations | Inventory by delivery channel; do not generalize one plugin's limitations to all Ruflo |
| `v3/@claude-flow/cli/package.json` | Source version 3.50.0 includes `.claude`, `plugins`, binaries, and dist in its packaging list | Inspect actual packed contents before claiming npm availability |

ADR 404 is marked Proposed despite describing implementation, test results, and live observations. This ADR does not change that status or repeat those results as independently verified. Its recorded engine versions and rollout behavior establish test candidates, not a permanent compatibility guarantee.

The motivating field guide is the supplied Claude Code mods gist at revision `d1720b24a433d58d6630ed848f0741201730a19d`. Engine generated types and actual validation take precedence over its examples.

## 3. Goals and exclusions

Goals are complete command accounting, a useful integrated command browser, progressive graphical views, preservation of Claude's conversational workflows, explicit evidence quality, bounded overhead, and reversible installation.

This phase excludes global prompt rewriting, automatic model replacement, removal of classic hooks for latency savings, automatic execution from retrieved memory, training on private transcripts, new publication authority, and mandatory installation of the broader ecosystem.

Existing policy modes and permissions remain independent of interface mode. Enabling mods must not switch a project from legacy policy to enforcement or weaken an existing enforced policy.

## 4. Checkable invariants

| ID | Invariant | Verification |
|---|---|---|
| I01 | Every discovered shipped command is cataloged or explicitly identified as documentation only | Inventory versus packed artifact comparison |
| I02 | Existing names resolve to their original semantics with mods disabled | Legacy golden fixtures and engine invocation tests |
| I03 | Each command name has one authoritative registrar in a session | Registration and collision tests |
| I04 | Prompt workflow instructions, argument substitution, and tool constraints remain intact | Byte fixtures plus engine continuation checks |
| I05 | Effective tool permission cannot become less restrictive through the mod | Verdict composition property tests |
| I06 | A rendering failure never retries an executing or ambiguously completed mutation | Failure injection and invocation ledger inspection |
| I07 | Observation, recorded coordination, executor completion, and verified outcome remain distinct | Result schema and display tests |
| I08 | Uninstall restores only settings owned by the installer and preserves later user edits | Three way settings reconciliation tests |
| I09 | No foreign plugin or Claude builtin is shadowed | Mixed plugin collision matrix |
| I10 | No secret or untrusted memory content becomes an instruction through a view | Redaction and prompt boundary tests |
| I11 | Unknown capability, policy, source freshness, or completion stays unknown | Refusal, timeout, stale data, and malformed response tests |
| I12 | CLI, MCP, Codex integrations, and headless use remain functional without mod code | Packed artifact regression suites |
| I13 | Mission state and execution authority survive loss of any one UI client | Cross client disconnect and recovery drill |
| I14 | Concurrent clients cannot silently overwrite mission state or reuse obsolete authority | Revision conflict and fencing tests |
| I15 | Completion requires acceptance evidence for the exact mission and artifact revision | Stale, forged, partial, and mismatched evidence rejection |
| I16 | Budget reservations are atomic and unknown charges remain accounted for | Concurrent dispatch and provider timeout tests |

## 5. Architecture and ownership

The build tooling owns a canonical registry. It produces a compact catalog for the sandbox and legacy command artifacts only after byte preservation tests pass. Initially it indexes existing Markdown files rather than rewriting them.

The workbench renders catalog entries and observations. A Node adapter validates operation requests and delegates to existing Ruflo services or approved MCP bindings. It does not create a second policy evaluator or execute arbitrary registry supplied JavaScript.

| Component | Responsibility | Must not do |
|---|---|---|
| Canonical registry | IDs, aliases, descriptions, arguments, prompt provenance, binding IDs, view metadata | Grant authority or contain shell templates |
| Legacy adapter | Preserve installed Markdown workflows and text outputs | Depend on engine mod APIs |
| Workbench plugin | Discover, preview, display, and request an approved operation | Treat a button as authorization for arbitrary effects |
| Existing core mod | Routing, tightening guards, learning hooks, cost signals, shared status noun | Acquire new process or network privileges silently |
| Runtime dispatcher | Validate, authorize, deduplicate, execute, and report | Substitute another workspace or backend after denial |
| Existing policy authority | Enforce current capabilities and approval scope | Accept caller supplied booleans as proof of permission |
| Existing executor | Perform work and supply completion evidence | Treat coordination ledger entries as executed work |

Shared pure code is compiled or copied into each mod package during the build. Runtime imports remain inside the plugin folder. Each emitted copy carries a contract version and source digest, with parity tests. Literal host API calls must satisfy the engine's static capability scanner; no computed host method dispatch is permitted.

## 6. Command inventory and registry contract

Inventory repository command directories, marketplace manifests, plugin command folders, CLI generated templates, published package contents, and known historical aliases. Exclude READMEs and compliance reports unless the installed loader actually exposes them as commands. Do not derive an executable command count from Markdown file count.

Record source path, delivery channel, package identity, source digest, invocation spelling observed in the engine, and current runtime binding. A command found only in source is labeled source only.

Proposed TypeScript contract, not an existing public API:

```ts
type CommandKind = 'prompt' | 'query' | 'mutation' | 'workflow' | 'help';
type ModDisposition = 'view' | 'dispatch' | 'delegate' | 'legacy';

interface CommandDefinition {
  schemaVersion: 1;
  id: string;
  revision: number;
  ownerPlugin: string;
  legacyNames: readonly string[];
  modNames: readonly string[];
  kind: CommandKind;
  argumentsSchema: object;
  resultSchemaId?: string;
  prompt?: { path: string; sha256: string; substitution: string };
  bindingId?: string;
  requiredCapabilities: readonly string[];
  requiredHostFeatures: readonly string[];
  disposition: ModDisposition;
  viewId?: string;
  modelVisibility: 'same-as-legacy' | 'explicit-summary';
  source: { repository: string; commit: string; path: string };
}
```

Schemas disallow unknown fields, cap input sizes, and define defaults explicitly. Runtime code maps `bindingId` to a reviewed operation allowlist. A registry entry cannot select an executable path, add shell flags, grant network access, or lower approval requirements.

Local user edited command files are overrides. Keep their contents and original ownership. Mark divergent copies in the catalog and do not regenerate or rebind them without an explicit migration preview and approval. Generator writes use expected source hashes to detect concurrent edits.

Prompt hashes detect unintended changes; they do not prove that two model runs will produce identical prose. Behavioral checks instead verify delivered instructions, tool availability, required steps, transcript continuity, and permitted effects.

## 7. Command registration and conversation semantics

Retain `/ruflo-mods` and all existing `ruflo-swarm-*` registrations. Introduce `/ruflo-workbench` only after collision checks. The user facing `/ruflo` spelling can be an optional alias if a real engine inventory proves it is free; this ADR does not reserve it over an existing command.

For a prompt workflow, the initial workbench shows its existing invocation and may fill the composer using a supported affordance. It must not auto-submit. If prompt filling is unavailable, display copyable text. Merely returning the Markdown as a command result is not assumed to invoke the original workflow.

Direct prompt dispatch requires a separately validated engine mechanism preserving expansion, metadata, permissions, argument quoting, and subsequent conversation. Until then the disposition is `delegate`, not `dispatch`.

Queries render structured data and return a textual result with equivalent model visible information. Mutations show their exact target and effects and use the runtime policy path. Existing session authorization may be reused only within its original scope and expiry; do not add redundant confirmation to already authorized harmless actions.

Command handlers pass unrelated events to the next handler. They never globally intercept every slash command, suppress Claude builtins, or broaden the user's tool set.

## 8. Interface modes and capability discovery

Proposed interface settings are `legacy`, `auto`, and `mods`. These are separate from Ruflo policy modes and the core mod's trust settings.

| Mode | Behavior |
|---|---|
| legacy | Existing command delivery remains active; workbench dispatch disabled |
| auto | Enable only verified mod capabilities; preserve unavailable commands through legacy routes |
| mods | Prefer mod views and report missing required capabilities explicitly; never remove the legacy command installation |

Existing users are not opted in by package update. Use the existing installer record pattern, local settings by default, a dry run, and an expected content check before writes. Never change managed policy or rollout flags to force compatibility.

The doctor reports actual executable path, engine version, plugin artifact version and digest, generated type compatibility, registration success, session heartbeat freshness, denied affordances, command collisions, and fallback reasons. A version string, environment variable, or cached heartbeat alone is insufficient to declare a mod active.

The `mods` interface's own cockpit — `ruflo-console`'s frame, look, boot screen, main menu, band, AI terminal, x.ruv.io board, Skills, Hive-Mind and MetaHarness lab, and the safety contract every view keeps — is specified in ADR 407.

External doctor checks cannot prove all live session behavior. Label their observations accordingly. Read only the configuration fields required for diagnosis; do not dump host credential or account configuration.

## 9. Runtime bridge and execution identity

Prefer a validated existing in-process runtime interface where available outside the sandbox. When a mod needs a process, invoke an installed versioned helper through fixed argv and structured input using a verified host transport. Do not interpolate command strings or use a shell. Do not run floating `npx @latest` resolution on each click.

If the engine cannot deliver structured stdin, use a bounded owner-only request file created by a supported affordance, with realpath validation, content binding, and cleanup. If neither mechanism is available, disable dispatch and preserve the legacy route. The adapter must not assume a stdin option exists merely because the field guide supports argv.

Each request binds request ID, command ID and revision, argument digest, workspace identity, session identity, policy reference, and expiry. Resolve authorization from the trusted runtime context. Never accept a request's claim that it has already been approved.

The runtime maintains a durable invocation record before side effects. States are `prepared`, `authorized`, `running`, `succeeded`, `failed`, `cancelRequested`, `cancelled`, and `unknown`. A timeout or connection loss after dispatch yields `unknown` until reconciled. A successful process exit proves process completion, not necessarily the intended outcome.

Deduplication is scoped to principal, workspace, command, and request ID. Reusing an ID with different arguments is rejected. Concurrent claims use an atomic uniqueness constraint or equivalent durable locking. New intentional executions receive new IDs.

Exactly once external effects cannot be guaranteed by a local journal alone. Use backend idempotency support or a queryable operation ID where available. Otherwise prohibit automatic mutation retries after ambiguous completion and require reconciliation. Rendering recovery only requests the recorded result.

Cancellation is an explicit authorized request. Do not report cancelled until the executor confirms it. Closing a pane stops its observation timers, not a running operation. Compensating actions and rollback require their own authorization and evidence.

## 10. Lifecycle ownership and durable observations

Preserve ADR 404's rule that guard checks are never disabled by `RUFLO_MODS_OWNS`. Command registration ownership and classic event ownership are separate mechanisms.

Before broader event migration, test partial registration, failed start, denied environment writes, reload refusal, uninstall during a session, and a retained ownership flag after mod unload. A process scoped flag alone must not be treated as proof that a handler remains active after reload.

Proposed strengthening: maintain a session bound ownership epoch and readiness record, scoped to permitted non-guard events. Classic helpers must validate readiness for their session before standing down. If safe ownership changes cannot be established with the engine, keep the affected event classic owned until restart. Do not use an expiring heartbeat alone to authorize takeover of an in-flight mutation.

Post-edit records need one append authority or immutable uniquely identified event segments reconciled by the existing Node runtime. Avoid concurrent read-modify-write on a shared log. If the sandbox cannot guarantee safe persistence, keep classic post-edit ownership; do not widen the core mod's process permissions to repair it.

Use engine session state for selections and pending event IDs where verified. Durable operation state belongs in the runtime. Rehydrate after reload, fence obsolete callbacks by generation, and ensure a late refresh cannot repaint data for a different workspace. Never persist pending approval as a reusable authorization token.

## 11. Results, provenance, and interface behavior

Observation envelopes include schema version, source, workspace, source observation time, fetch time, freshness, operation identity where applicable, and evidence status. Freshness comes from the source timestamp, not the latest redraw. Unknown source time remains unknown.

Display at least these states distinctly: requested, recorded in coordination ledger, executing, process completed, outcome verified, failed, stale, unavailable, and unknown. A task row marked done on disk is recorded state unless independently backed by executor evidence.

Support text first. Layout uses the actual pane dimensions. Every keyboard action has a visible control or command alternative. Do not steal focus, clear existing composer text, or open an intrusive pane automatically. Unsupported graphical elements fall back to text. Disabled actions explain the missing capability without inventing an installation status.

Sanitize control characters and bound all displayed strings. Retrieved memory, filenames, logs, and peer descriptions are data, never instructions. Do not expose hidden reasoning or reconstruct transcripts from partial tool observations. Preserve the existing shared `$.ruflo` status contract and its segment limits; any extension is additive and versioned.

## 12. Security and ecosystem boundaries

The workbench has an explicit host capability inventory. Adding `process.run` makes it risky under ADR 404's trust rules; installation must disclose that and must not automatically add itself to the trust allowlist. Managed refusal remains authoritative.

Bind filesystem access to the selected workspace. Validate canonical paths, symlinks, argument sizes, schemas, and operation permissions again at execution. Keep credentials in their existing host or runtime stores. Do not put secrets in argv, snapshots, mod state, telemetry, or generated catalogs. A local state file is not a cryptographic completion receipt.

RuVector provides optional memory and retrieval observations. MetaHarness supplies evaluation artifacts and comparisons. Autogenous may supply signed adaptation evidence through a future adapter. These integrations cannot authorize code promotion, expand a SafetyEnvelope, or manufacture independent evaluator support. Existing Ruflo policy and release authorities remain in control.

Codex and other clients continue using CLI/MCP contracts without loading Claude mod code. No runtime dependency on Claude types is introduced into their execution paths.

## 13. Performance budgets

These are proposed gates to measure on declared reference hardware, not current measurements.

| Metric | Target and measurement |
|---|---|
| Closed workbench | Zero polling, animation timers, or observation child processes |
| Open observation refresh | Default 5 seconds; one request in flight; bounded backoff on failure |
| Live observation freshness | Stale after three missed expected intervals; historical artifacts retain historical labels |
| UI refresh timeout | 2 seconds for an observation request; not a timeout for a long running task |
| Incremental dispatch bookkeeping | p95 at most 5 ms, excluding executor work and process startup |
| Warm local text view | p95 at most 100 ms from available validated snapshot to render |
| Incremental JS heap | At most 10 MiB after a 30 minute observation soak, with bounded history |
| Workbench plugin assets | At most 150 KiB unpacked, excluding existing runtime and generated development types |
| Observation provider cost | Zero model or provider calls unless separately requested |

Run baseline and candidate with identical plugins, tasks, hardware, warmup, and backend. Report end to end latency including engine hops and surviving classic hook processes. At least 1,000 warm samples per measured path and 30 cold starts; report p50, p95, sample count, and uncertainty. Do not present in-process microbenchmarks as user visible latency savings.

## 14. Implementation plan and proposed file map

All new paths below are proposed. Existing named paths are integration points, not evidence that these additions already exist.

| Phase | Inputs and assumptions | Outputs | Exit gate |
|---|---|---|---|
| P0 inventory | Source, package tarballs, marketplace manifests; no command count assumed | Command inventory, aliases, baseline fixtures, engine capability report | Every shipped command classified; unresolved bindings explicit |
| P1 registry | P0 sources and reviewed schemas | CLI `src/mods/command-registry/`, registry validator, deterministic catalog generator | Duplicate IDs/names rejected; legacy files unchanged |
| P2 observation | Registry and current core/swarm contracts | `plugins/ruflo-workbench`, text command browser, status and memory views | No mutations or provider calls; preserved transcript output |
| P3 lifecycle | Core ownership handshake, classic helper sources | Reload fencing, durable observation strategy, collision handling | No lost accepted records or duplicate event processing in fault tests |
| P4 dispatch | Runtime policy and request records | `src/mods/dispatch/`, operation status/reconciliation, approved mutation adapters | Ambiguous completion never causes automatic retry |
| P5 workflow coverage | Prompt fixtures and verified engine affordances | Per-command delegates or direct adapters with disposition reasons | Every cataloged command reachable without semantic regression |
| P6 release qualification | Packed CLI and marketplace candidates | Compatibility report, signed helper updates if needed, migration/rollback guide | All release gates pass; separate release authorization |

P6 qualifies the command compatibility release only. The mission control product additionally requires M0 through M3 in section 19; it must not be advertised as complete at P6.

Extend existing `src/commands/mods.ts` for proposed catalog, compatibility, and workbench management subcommands after CLI naming review. Do not silently change existing install behavior to enable the workbench. Extend `plugins/ruflo-mods/types/index.d.ts` only for necessary additive contracts. Reuse `plugins/ruflo-swarm/hooks/commands.ts` and its controller through reviewed shared interfaces without cross-folder sandbox imports.

Add tests under the existing `v3/@claude-flow/cli/__tests__/mods` family and a new workbench engine test directory. Add deterministic catalog and packed artifact validation to the existing build/release workflow. Command generation must not overwrite customized project files during ordinary install or update.

## 15. Test matrix and release gates

| Area | Required cases | Acceptance |
|---|---|---|
| Legacy compatibility | Mods absent, disabled, rollout blocked, managed rejection | Existing commands and guards retain baseline behavior |
| Engine matrix | ADR 404 reference builds where available, selected supported release, unknown type revision | Unknown capabilities degrade; unavailable engines are reported untested |
| Command identity | Builtins, foreign plugins, old aliases, local overrides, repeated registration | No shadowing or double registration |
| Prompt workflow | Spaces, quotes, Unicode, multiline input, empty input, frontmatter, tool constraints | Same instructions and substituted arguments reach the intended workflow |
| Policy | allow/ask/deny combinations, projection unavailable, policy change before confirm | No permission widening; protected work cannot proceed on unknown authority |
| Execution | Double click, concurrent request, crash before/after effect, timeout, lost reply | Deduplication or explicit unknown state; zero automatic duplicate mutation |
| Lifecycle | Hot reload, failed reload, late callback, close, restart, workspace switch | No stale writes, duplicate timers, or false ownership |
| Evidence | Nonzero exit with valid JSON, zero exit with invalid JSON, stale snapshot, forged receipt | Correct failure or unknown label; no false verified badge |
| Persistence | Concurrent append, disk full, interrupted write, edited settings | Accepted events retained or explicit failure; user settings preserved |
| Platforms | Supported Node versions; Linux, macOS, native Windows; ESM and CommonJS projects | Fixed argv behavior; no shell retokenization regression |
| Packaging | CLI, claude-flow, ruflo umbrella artifacts; local marketplace install | Expected files present and resolvable; no dependency on source checkout |
| Ecosystem | Optional packages absent, incompatible, or denied | Useful core behavior continues without fabricated capability |

Use pure Node tests for schemas, formatting, catalog generation, and state machines. Use real engine tests for command resolution, permissions, middleware composition, prompt continuation, and UI refusal. Mock based engine tests do not count as live provider execution or production deployment evidence.

Run focused relevant tests plus existing command, hook, policy, package, and installer regression suites. Known baseline failures must have source bound evidence and explicit adjudication; do not silently waive security or compatibility failures. Release evidence records commit, packed artifact digests, engine binary/type identity, platform, test results, and benchmark inputs.

Final acceptance requires 100% inventory accounting, 100% preserved legacy invocation fixtures, zero permission widening, zero duplicate mutations in the fault suite, correct restoration after uninstall, and measured compliance with the selected performance budgets.

## 16. Packaging, migration, and rollback

ADR 404 distinguishes npm CLI delivery from marketplace plugin delivery. Preserve that distinction in the installer and doctor. Publishing npm alone must not claim that the marketplace plugin has updated. Record exact installed digests and compatible contract ranges for both channels.

The stable public npm train remains `@claude-flow/cli`, `claude-flow`, then `ruflo`, as required by the repository guide. Internal packages are not independently published as part of this work. If generated signed helpers change, regenerate and sign through the existing authorized release process; never bypass signature verification to make tests pass.

Canary progression is internal fixtures, explicit maintainer opt in, a small opt in cohort, then general availability as an optional feature. Do not select automatic percentage cohorts without product support. Exit each stage on actual correctness evidence, not elapsed time.

Rollback disables workbench registration and new dispatch, preserves in-flight request records, restores settings using installation ownership records, and starts a fresh session if hook ownership cannot safely change in place. Do not delete ledger evidence or terminate external work by closing the interface. A rollback drill must prove legacy command invocation works after an interrupted installation and after user settings have changed.

## 17. Alternatives and consequences

Scores are architectural judgments, 5 is best; compatibility and permission isolation are weighted twice.

| Alternative | Compatibility | Isolation | Reuse | Delivery simplicity | Weighted total |
|---|---:|---:|---:|---:|---:|
| Replace all Markdown with mod handlers | 1 | 2 | 3 | 3 | 12/30 |
| Add full dispatch to the core mod | 3 | 1 | 4 | 4 | 16/30 |
| Separate workbench with shared registry | 5 | 5 | 5 | 3 | 28/30 |
| Maintain independent command implementations | 3 | 4 | 1 | 2 | 17/30 |

The chosen design requires a catalog generator, extra compatibility tests, and coordinated npm/marketplace artifacts. In return, it preserves the core mod's smaller trust surface and enables complete command discovery without requiring unsafe alias takeover.

Some commands will remain delegates indefinitely if the engine cannot preserve their prompt semantics. That is an acceptable outcome. The implementation must report this honestly instead of claiming every command executes natively as a mod.

## 18. Open questions and decision gates

1. Which actual supported engine build and generated type digest become the first release baseline? Resolve in P0; ADR 404's historical observations are insufficient alone.
2. Can the engine safely invoke an existing prompt command without composer intervention? Resolve with a live fixture before any direct prompt migration.
3. Which durable request store and transactional primitive can the existing runtime reuse? Resolve before P4; no new store is assumed available.
4. What readiness mechanism can survive reload without skipping classic events? Resolve before broadening ownership; keep classic ownership if uncertain.
5. Which commands are user edited, obsolete documentation, or runtime unavailable? Inventory each explicitly rather than guessing from filenames.

The first implementation decision is P0 plus P1, followed by an observation only workbench. The largest risk is semantic drift or duplicated actions hidden behind a successful UI. The acceptance test is to replay the full command fixture inventory with mods off and on, inject lifecycle and transport failures, and verify unchanged permissions and exactly one intended execution or an explicit unresolved outcome.

## 19. Mission control architecture and implementation

### 19.1 Product contract and interface

The interface must answer six practical questions: what objective is being pursued, who is doing the work, what is blocked, what authority and budget remain, what actually changed, and what evidence proves success.

| View | Contents | Primary action |
|---|---|---|
| Missions | Objective, owner, lifecycle state, freshness, budget, acceptance summary | Create or resume a mission |
| Plan | Task dependency graph, selected executors, estimated cost, capability scope | Review and authorize a plan revision |
| Execution | Task progress, executor health, claims, resource leases, blocked dependencies | Request pause, cancellation, or scoped replanning |
| Memory and decisions | Retrieved sources, provenance, competing options, recorded rationale | Inspect or exclude evidence from a future plan revision |
| Evaluation | Baseline versus candidate, quality, cost, latency, safety, failed criteria | Request evaluation or review its receipt |
| Evidence and recovery | Artifact digests, executor receipts, acceptance verdicts, checkpoints, rollback target | Verify completion or request an authorized rollback |

The terminal interface begins with a mission list and focused detail view, not six permanent panes. It must remain useful in a narrow terminal. Each action has a text command equivalent. Display rationale and observable decisions, never hidden model reasoning. Plan estimates are labeled estimates; measured spend and verified results have separate fields.

### 19.2 Runtime authority and ecosystem roles

The mission service owns durable state transitions, dispatch admission, budget reservations, and evidence indexing. It invokes existing Ruflo policy and executor integrations. Its persistence and transactional implementation must be selected from actual runtime capabilities during M0.

| Component | Proposed mission role | Boundary |
|---|---|---|
| Ruflo | Coordination, task dependencies, policy routing, mission state | Recording a task does not execute it |
| RuVector | Retrieval, memory provenance, optional decision comparisons | Retrieved similarity is not authorization or verified truth |
| MetaHarness | Baseline and candidate evaluations, reproducible comparisons | An evaluation result cannot authorize its own promotion |
| Autogenous | Optional adaptation lineage and governed rollback evidence | Adapter must be verified; cannot widen mission authority |
| ruOS or another admitted executor | Execute work in an identified environment and return evidence | Provisioned desktop, transport connection, and healthy executor are different states |
| Claude Code mod, MCP, CLI, web | Observe and submit scoped requests | No client owns the authoritative mission state |

Existing standalone commands continue to work without creating missions. Commands invoked from a mission bind to its task, policy, budget, and execution identity. A command is enrolled only when its effects and recovery semantics are understood. Reading an existing command's status must not retroactively claim ownership of its execution.

### 19.3 Mission record

Proposed logical schema; this is not a currently exported SDK type:

```ts
interface MissionRecord {
  schemaVersion: 1;
  missionId: string;
  tenantId: string;
  workspaceId: string;
  ownerPrincipalId: string;
  revision: number;
  objective: string;
  plan: { revision: number; digest: string; taskGraphRef: string };
  policyRef: string;
  authorizationRef?: string;
  budgetRef: string;
  executionMode: 'durable-executor' | 'session-bound';
  state: MissionState;
  evidenceRefs: readonly string[];
  acceptance: { revision: number; criteriaDigest: string };
  lastEventSequence: number;
  createdAt: string;
  updatedAt: string;
}

type MissionState =
  | 'draft' | 'planned' | 'awaitingAuthorization' | 'queued'
  | 'running' | 'pauseRequested' | 'paused' | 'blocked'
  | 'verifying' | 'completed' | 'failed'
  | 'cancelRequested' | 'cancelled';
```

Executor connection state is a separate observation: healthy, stale, disconnected, or unknown. A disconnected executor does not establish failure or cancellation. Store connection age and last acknowledged execution ID alongside the observation.

Use append-only transition records with sequence numbers and materialized snapshots. Each record binds mission ID, expected revision, principal, request ID, policy decision reference, and server timestamp. A hash chain detects changes but does not by itself establish trusted origin; verified claims need an authenticated producer or the existing signed receipt mechanism.

### 19.4 State transitions and authority

| From | Request or event | To | Required condition |
|---|---|---|---|
| draft | Plan validated | planned | Task graph, scope, budget, and acceptance criteria are well formed |
| planned | Authority missing | awaitingAuthorization | Concrete plan and effects available for review |
| planned or awaitingAuthorization | Admission accepted | queued | Current authorization covers the exact plan and budget reservation |
| queued | Executor acknowledges | running | Executor identity and lease are valid |
| running | Pause accepted | pauseRequested | No further task admission; in-flight work remains tracked |
| pauseRequested | Quiescence confirmed | paused | Tasks reached safe checkpoints or completed |
| running or queued | Dependency, authority, or budget unavailable | blocked | Record reason and unresolved in-flight operations |
| paused or blocked | Resume admitted | queued | Fresh policy, budget, dependency, and checkpoint checks |
| running | Required tasks settled | verifying | No unresolved required operation or unknown mutation outcome |
| verifying | All acceptance criteria satisfied | completed | Evidence binds to the current plan, criteria, and exact artifacts |
| verifying | Acceptance fails | failed | Failure evidence recorded; replanning creates a new plan revision |
| any nonterminal state | Cancellation admitted | cancelRequested | Stop new admission and request executor cancellation |
| cancelRequested | All relevant executors acknowledge settlement | cancelled | Preserve effects already produced and outstanding remediation |
| active state | Verified unrecoverable failure | failed | Do not equate lost connectivity with verified failure |

Retries from failed missions create a new authorized attempt and preserve prior evidence. Terminal mission history is immutable. Rollback is a linked compensating operation with its own status and verification; a completed mission does not become uncompleted by rewriting its history.

Replanning records a new plan revision, fences obsolete dispatch, and invalidates approval when effects, targets, requested capabilities, or approved limits change beyond the existing authorization. User approval is not repeated for unchanged actions already covered by a valid scope.

### 19.5 Task graph, leases, and execution recovery

Each task identifies dependencies, executor requirements, capability ceiling, workspace or resource claims, invocation IDs, checkpoint format, and acceptance evidence. Dependencies must form an acyclic graph or use an explicit bounded loop construct with a stop condition, iteration limit, and budget.

Schedule ready tasks only after policy and atomic budget admission. Concurrent executors claim scoped leases with fencing epochs. A replacement worker cannot mutate resources using an older epoch. Lease expiry triggers reconciliation, not blind replay. Commands without backend idempotency or queryable outcomes remain blocked after ambiguous completion until their effects are established.

Durable execution requires a runtime or executor whose lifetime is independent of the Claude process. If a task uses a Claude session bound tool, declare it `session-bound`; closing that session cannot be promised to preserve execution. Such work must checkpoint and await a compatible session, or report its unresolved outcome. The product must not hide this distinction under a universal background running badge.

### 19.6 Budgets and resource control

Use explicit currency and integer monetary units. Track estimated cost, settled spend, reserved maximum cost, and unresolved charge exposure separately. Admission requires settled spend plus reserved exposure plus the new reservation to remain within the authorized ceiling. Reservations include in-flight work; atomic updates prevent parallel tasks from oversubscribing the budget.

Budget dimensions include provider spend, tokens, wall time, concurrency, retries, and selected compute resources. Lowering limits applies immediately to new admission. Raising them requires existing sufficient authority or a new approval. Provider calls with uncertain final charges keep their reservation until reconciled; unknown usage is never reset to zero.

A strict monetary ceiling is supported only when the provider's maximum charge can be bounded and existing work fits the reservation. Otherwise label it an admission ceiling with disclosed overshoot exposure. On exhaustion, block new tasks and request safe quiescence; do not promise that an already accepted external request can be cancelled or refunded.

Observation panels incur no model calls. Optional recommendations or plan generation explicitly consume a mission or user approved planning budget.

### 19.7 Shared API and multiple clients

Proposed semantic operations are `mission.create`, `mission.plan`, `mission.get`, `mission.events`, `mission.requestAction`, and `mission.verify`. Transport names and schemas are finalized during M0. CLI, MCP, and future web adapters share versioned validation and authorization; they do not reinterpret mission policy independently.

Every mutation includes request ID and expected mission revision. The server derives principal and tenant from authenticated context and rejects stale revisions with a refreshable conflict. A browser session cannot inherit a terminal credential simply because it knows a mission ID. Read access and control access are distinct and rechecked on reconnect.

Consumers resume events from a durable cursor. Delivery may repeat events; clients deduplicate by mission ID and sequence. A retention gap requires a new snapshot with its sequence boundary, followed by replay. Never infer new execution requests from replayed display events.

Cross device recovery requires an authorized reachable runtime. A local mission service may remain loopback only; remote access is a separately authenticated deployment capability. The initial acceptance test may use two local clients, but must not claim remote or web recovery until those adapters are implemented and tested.

### 19.8 Evidence and verified completion

Define acceptance criteria before execution. Each criterion names its check, inputs, baseline if relevant, threshold, evidence producer, and whether independent validation is required. Results bind task ID, attempt, source or artifact digest, tool or evaluator version, environment, and exit or verification status.

Completion requires all mandatory criteria to pass with no unknown required operations. Optional criteria and waived criteria remain visible. Waivers require an authorized acceptance revision and cannot silently relax safety or governance rules. An agent narrative, task status flag, UI animation, or successful transport response cannot serve as a completion receipt.

Candidate comparisons use the same declared workload and resource accounting. MetaHarness results and Autogenous recommendations remain advisory to the separately authorized promotion path. Rollback success requires evidence of restored artifact identity and health, not just acceptance of a rollback command.

### 19.9 Mission delivery stages

| Stage | Inputs and assumptions | Outputs | Acceptance gate |
|---|---|---|---|
| M0 contract and storage | Existing runtime, identity, policy, and persistence audit; independent executor availability unknown | Versioned mission schemas, transition validator, durable store decision, migration design | State replay and revision conflict tests pass |
| M1 mission observation | M0 plus P2 workbench | Mission list, plan, task graph, evidence and budget views | Snapshot plus event replay reconstructs the same state |
| M2 governed execution | P4 dispatch, M0 authority, admitted executor | Task admission, budget reservations, pause/cancel/replan, durable invocation references | Fault suite shows no unauthorized or duplicated effects |
| M3 client recovery | M2 and at least two implemented authorized clients | Cursor recovery, control conflicts, executor reconciliation, rollback drill | Cross client mission recovery test passes |

Suggested new runtime module path is `v3/@claude-flow/cli/src/missions/`, subject to M0's reuse decision. Do not place the durable service inside mod hooks. Full web UI delivery and remote ruOS execution remain separate adapters, each with its own evidence and access checks.

### 19.10 Mission acceptance and failure tests

The primary acceptance scenario uses a durable executor and a controlled three task mission: produce an artifact, evaluate it, and verify acceptance. Start through the Claude Code mod, record mission ID and cursor, close Claude Code during execution, then reconnect using an authorized CLI or MCP client. Recover the same mission revision, task identities, budget reservations, evidence, and available controls. Complete or pause through that client with no duplicated task dispatch. Reopen Claude Code and reconstruct the same state.

Repeat with a session bound executor and require an honest blocked or unknown state rather than a false claim of continued work. Repeat with a client lacking control scope and require observation only.

Additional required tests cover concurrent client pause and replan requests, revoked authority on reconnect, stale fencing epochs, budget exhaustion during parallel admission, delayed provider charges, event replay duplicates, cursor retention gaps, invalid evidence signatures, evidence for the wrong artifact, service restart, disk full, and rollback with failed health confirmation.

Proposed local recovery target is p95 below 2 seconds for a mission of 100 tasks and 1,000 retained events, excluding authentication interaction and remote network delay. Test at least 30 reconnects and report hardware, dataset size, cold versus warm behavior, and actual measurements. Recovery must make zero provider calls and submit zero new execution requests.

The business acceptance experiment compares 20 representative missions using the existing CLI workflow against the workbench. Target a 20% reduction in median time to locate and diagnose blocked work, with no increase in incorrect actions or task failures. This is an evaluation target, not a claimed benefit. Safety, compatibility, and evidence correctness remain mandatory even if the usability target is met.

## 20. Sources

Repository links are pinned to the reviewed source commit. Benchmark and engine claims inside linked ADRs remain those documents' reports.

1. [ADR 404](https://github.com/ruvnet/ruflo/blob/27982983ea6cdc4767c0b6614a4ad9a9d9497cce/v3/docs/adr/ADR-404-claude-code-mods-function-hooks.md)
2. [Repository agent and release guidance](https://github.com/ruvnet/ruflo/blob/27982983ea6cdc4767c0b6614a4ad9a9d9497cce/AGENTS.md)
3. [Core registration](https://github.com/ruvnet/ruflo/blob/27982983ea6cdc4767c0b6614a4ad9a9d9497cce/plugins/ruflo-mods/hooks/register.ts)
4. [Event ownership](https://github.com/ruvnet/ruflo/blob/27982983ea6cdc4767c0b6614a4ad9a9d9497cce/plugins/ruflo-mods/hooks/ownership.ts)
5. [Existing swarm mod commands](https://github.com/ruvnet/ruflo/blob/27982983ea6cdc4767c0b6614a4ad9a9d9497cce/plugins/ruflo-swarm/hooks/commands.ts)
6. [Existing swarm action controller](https://github.com/ruvnet/ruflo/blob/27982983ea6cdc4767c0b6614a4ad9a9d9497cce/plugins/ruflo-swarm/hooks/actions/controller.ts)
7. [Mods CLI](https://github.com/ruvnet/ruflo/blob/27982983ea6cdc4767c0b6614a4ad9a9d9497cce/v3/@claude-flow/cli/src/commands/mods.ts)
8. [CLI package manifest](https://github.com/ruvnet/ruflo/blob/27982983ea6cdc4767c0b6614a4ad9a9d9497cce/v3/@claude-flow/cli/package.json)
9. [SPARC architect workflow](https://github.com/ruvnet/ruflo/blob/27982983ea6cdc4767c0b6614a4ad9a9d9497cce/.claude/commands/sparc/architect.md)
10. [Separate legacy hook manifest](https://github.com/ruvnet/ruflo/blob/27982983ea6cdc4767c0b6614a4ad9a9d9497cce/.claude-plugin/hooks/hooks.json)
11. [Claude Code mods field guide](https://gist.github.com/ruvnet/a485e930b148185197fc53fd38b429ea/d1720b24a433d58d6630ed848f0741201730a19d)
