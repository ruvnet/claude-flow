# ruflo-adr — ADR Reference

Companion reference for `adr-architect`. The agent prompt deliberately stays lean per [ADR-098 Part 2](../../v3/docs/adr/ADR-098-plugin-capability-sync-and-optimization.md); this file collects the template, graph-storage recipes, and detection workflow the agent reads on-demand.

## ADR template

Every ADR follows this structure:

```markdown
# ADR-NNN: <Title>

- **Status**: proposed | accepted | deprecated | superseded by ADR-XXX
- **Date**: YYYY-MM-DD
- **Deciders**: <list of people>
- **Tags**: <comma-separated tags>

## Context

<What is the issue that we're seeing that motivates this decision?>

## Decision

<What is the change that we're proposing and/or doing?>

## Consequences

### Positive
- <good outcomes>

### Negative
- <trade-offs and costs>

### Neutral
- <other effects>

## Links
- Supersedes: ADR-XXX (if applicable)
- Amended by: ADR-YYY (if applicable)
- Related: ADR-ZZZ
```

## Lifecycle state machine

```
       (write)
          ▼
      proposed
          │ accept
          ▼
      accepted ───deprecate───► deprecated
          │
          │ supersede
          ▼
      superseded by ADR-XXX
```

- An ADR enters `proposed` on creation.
- `accepted` after team review.
- `deprecated` when no longer recommended but kept for history.
- `superseded` is permanent; ADR-XXX must already exist and reference back via `supersedes:`.

## AgentDB graph storage

Persist the ADR tree + relationships so traversal queries (e.g. "all ADRs depended on by ADR-097") work without reparsing markdown:

```bash
# Hierarchical tree — store each ADR under adr/<id>
mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store \
  --path "adr/ADR-097" \
  --value '{"status":"accepted","title":"Federation Budget Circuit Breaker","date":"2026-05-04"}'

# Causal edges for relationships
mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge \
  --from "ADR-097" --to "ADR-086" --relation "depends-on"
mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge \
  --from "ADR-098" --to "ADR-095" --relation "depends-on"
mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge \
  --from "ADR-094" --to "ADR-093" --relation "amends"
```

Standard relationship vocabulary:
- `supersedes` — replaces an older ADR (the older one moves to `superseded`).
- `amends` — adjusts an existing ADR without superseding it (older stays `accepted`).
- `depends-on` — this ADR's correctness depends on another ADR's decision being in force.

## Code-ADR violation detection

Detect when code drifts away from an accepted ADR:

1. **Find ADR references in code** — `Grep` for the ADR ID in comments:
   ```bash
   grep -rnE "ADR-[0-9]{3}" src/ --include='*.ts' --include='*.js'
   ```
2. **Find when those code lines last changed** — `git blame` on each match.
3. **Compare against ADR status timestamps** — load ADR's `Date:` field and ADR-graph history. If the code changed *after* the ADR was accepted AND the ADR wasn't amended in the same PR, flag the file as a potential violation.
4. **Report** — emit a structured finding with file, line, ADR ID, and the lag in days between ADR acceptance and the code change.

Common drift patterns to look for:
- Code references a `superseded` ADR (should reference its successor).
- Code introduces a pattern explicitly forbidden in an `accepted` ADR.
- ADR's "Decision" wording doesn't match the actual code shape.

## Index file

`docs/adr/README.md` maintains a flat index of all ADRs with status. Update on every ADR write:

```markdown
| # | Title | Status | Date |
|---|---|---|---|
| ADR-097 | Federation Budget Circuit Breaker | accepted | 2026-05-04 |
| ADR-096 | Encryption at Rest | accepted | 2026-05-03 |
```
