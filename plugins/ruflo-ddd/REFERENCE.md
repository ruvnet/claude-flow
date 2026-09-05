# ruflo-ddd — DDD Reference

Companion reference for `domain-modeler` and other agents in this plugin. The agent prompt deliberately stays lean per [ADR-098 Part 2](../../v3/docs/adr/ADR-098-plugin-capability-sync-and-optimization.md); this file collects the vocabulary tables, scaffolding catalogs, and AgentDB graph-storage recipes the agent reads on-demand.

## DDD building blocks

| Building block | Purpose | Key rule |
|---|---|---|
| **Entity** | Object with identity and lifecycle | Identity-based equality; mutable state |
| **Value Object** | Immutable descriptor without identity | Equality by value; side-effect free |
| **Aggregate Root** | Consistency boundary with invariants | All mutations go through the root |
| **Domain Event** | Record of something that happened | Immutable; past-tense named; carries payload |
| **Repository** | Persistence abstraction per aggregate | One repository per aggregate root |
| **Domain Service** | Stateless cross-entity operations | Used when logic spans multiple aggregates |
| **Factory** | Complex object creation | Encapsulates construction invariants |

## Bounded-context relationships

| Relationship | Use when |
|---|---|
| **Partnership** | Two contexts succeed or fail together; coordinate releases |
| **Customer-Supplier** | Upstream context provides; downstream consumes; downstream needs are honored |
| **Conformist** | Downstream conforms to upstream's model verbatim (no translation) |
| **Anti-Corruption Layer (ACL)** | Downstream protects itself by translating between ubiquitous languages |
| **Open Host Service** | Upstream publishes a stable protocol for many downstream consumers |
| **Published Language** | Shared interchange format (often paired with Open Host Service) |

## Per-context directory structure

```
src/<context-name>/
  domain/
    entities/         # Entities and aggregate root
    value-objects/    # Value objects
    events/           # Domain events
    services/         # Domain services
    repositories/     # Repository interfaces
  application/        # Use cases / application services
  infrastructure/     # Repository implementations, ACL adapters
  index.ts            # Public API of the context
```

## AgentDB graph storage

Persist the domain model as a navigable graph so subsequent sessions can traverse it via the pathfinder agent:

```bash
# Store bounded context hierarchy
mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store --parent "domain" \
  --child "context:ordering" --relation "contains"
mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store --parent "context:ordering" \
  --child "aggregate:order" --relation "contains"

# Store context dependencies
mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge --from "context:ordering" \
  --to "context:inventory" --type "depends-on"
mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge --from "context:ordering" \
  --to "context:payments" --type "publishes-events-to"
```

Edge types worth standardizing across a project:
- `depends-on` — context needs the other to exist (sync coupling)
- `publishes-events-to` — fire-and-forget event flow
- `translates-via-acl-to` — anti-corruption layer mediates
- `conforms-to` — downstream adopts upstream model verbatim

## Naming conventions

- **Aggregate roots**: PascalCase singular noun (`Order`, `Customer`, `Invoice`).
- **Domain events**: PascalCase past-tense (`OrderPlaced`, `InvoiceVoided`, `CustomerEmailChanged`).
- **Commands**: PascalCase imperative (`PlaceOrder`, `VoidInvoice`).
- **Repository interfaces**: `<Aggregate>Repository` (`OrderRepository`).
- **Domain services**: `<Verb><Noun>Service` (`PriceQuoteService`, `InventoryAllocationService`).
