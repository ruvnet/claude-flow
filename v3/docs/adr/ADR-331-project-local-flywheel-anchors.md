# ADR-331: Project-Local Flywheel Evaluation Anchors

**Status:** Accepted and implemented
**Date:** 2026-07-29
**Issue:** #2840
**Related:** ADR-081, ADR-176, ADR-322

## Decision

A downstream flywheel must use a human-labelled benchmark for the project it is
optimizing. The benchmark is canonicalized, hash-pinned, and identified in
every new evaluation receipt as `anchorRef`.

Ruflo's built-in development-history benchmark is selected automatically only
when the target repository identifies itself as Ruflo/Claude Flow. A foreign
repository without a project anchor fails closed with a clear reason. Operators
may explicitly retain the historical behavior with
`RUFLO_FLYWHEEL_ALLOW_BUILTIN_ANCHOR=1`, but it is never silently selected.

## Manifest

Create `.claude/eval/flywheel-anchor.manifest.json`:

```json
{
  "schemaVersion": "ruflo.flywheel-anchor-manifest/v1",
  "path": "my-project-anchor.json",
  "sha256": "sha256:<canonical-task-hash>"
}
```

The anchor file contains at least four tasks:

```json
{
  "schemaVersion": "ruflo.flywheel-anchor/v1",
  "version": "my-project-v1",
  "tasks": [
    {
      "id": "auth-01",
      "q": "where is request authentication enforced",
      "labels": ["authentication middleware", "request guard"]
    }
  ]
}
```

Both files and resolved symlinks must remain inside the project root. Changing
the tasks without updating the pinned hash is rejected.

The CLI and MCP surfaces also accept an explicit `anchorPath` plus
`anchorHash`; neither may be supplied alone.

## Receipt compatibility

`anchorRef` is optional when decoding historical `ruflo.flywheel-receipt/v1`
receipts, preserving verification of already-issued signatures. New
evaluations include it, so receipts from different project benchmarks cannot
be treated as one comparable lineage without an explicit migration.
