---
name: vector-hyperbolic
description: Embed hierarchical data via npx ruvector@0.2.25 embed text and project into the Poincare ball in user code (no --model poincare flag in 0.2.25)
argument-hint: "<text> [--model poincare]"
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search
---

# Vector Hyperbolic

Embed hierarchical data in the Poincare ball model using `ruvector`.

## When to use

Use this skill when your data has inherent hierarchy — dependency trees, module structures, taxonomies, org charts, ontologies. Hyperbolic space captures hierarchical distances with far fewer dimensions than Euclidean embeddings.

## Steps

1. **Ensure ruvector@0.2.25 is available**:
   ```bash
   npm ls ruvector 2>/dev/null | grep '0.2.25' || npm install ruvector@0.2.25
   ```
2. **Generate a base ONNX embedding** (ruvector@0.2.25 does not expose a `--model poincare` flag on `embed text`):
   ```bash
   npx -y ruvector@0.2.25 embed text "hierarchical concept" -o concept.vec.json
   ```
3. **Project into the Poincare ball** in your own code (or via the experimental neural substrate):
   ```bash
   npx -y ruvector@0.2.25 embed neural --help
   ```
   For an ad-hoc projection, normalize the 384-dim vector to live inside the unit ball (`x_i / (||x|| * (1 + epsilon))`) and persist the projected coordinates alongside the original embedding.
4. **Geodesic distance**: `d(u, v) = arcosh(1 + 2 * ||u-v||^2 / ((1-||u||^2)(1-||v||^2)))`
   Distance grows logarithmically with tree depth, preserving hierarchy.
5. **Store results**:
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "hyperbolic-CONCEPT", value: "COORDINATES_AND_NEIGHBORS", namespace: "hyperbolic-embeddings" })`

## Caveats

- ruvector@0.2.25 has no first-class Poincare ball CLI flag. Treat hyperbolic projection as a post-processing step over a standard ONNX embedding.
- If you need a hyperbolic search index, store projected coordinates in AgentDB and compute geodesic distance in your own retrieval code.

## Poincare ball properties

| Property | Meaning |
|----------|---------|
| Norm close to 0 | Generic, root-level concept |
| Norm close to 1 | Specific, leaf-level concept |
| Small geodesic distance | Closely related in hierarchy |
| Large geodesic distance | Distant or different subtrees |

## Use cases

- **Dependency analysis**: embed module imports to find tightly coupled subtrees
- **Code architecture**: map class hierarchies to discover structural patterns
- **Knowledge organization**: embed concepts to reveal taxonomic relationships
- **Codebase navigation**: find most specific/general modules relative to a query
