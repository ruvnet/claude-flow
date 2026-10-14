---
name: vector-hyperbolic
description: Place hierarchical data in the Poincare ball using depth for the radius and npx ruvector@0.3.3 embed text for direction (a unit-norm text embedding alone has no depth)
argument-hint: "<text> [--model poincare]"
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search
---

# Vector Hyperbolic

Embed hierarchical data in the Poincare ball model using `ruvector`.

## When to use

Use this skill when your data has inherent hierarchy — dependency trees, module structures, taxonomies, org charts, ontologies. Hyperbolic space captures hierarchical distances with far fewer dimensions than Euclidean embeddings.

## Steps

1. **Ensure ruvector@0.3.3 is available**:
   ```bash
   npm ls ruvector 2>/dev/null | grep '0.3.3' || npm install ruvector@0.3.3
   ```
2. **Know what a text embedding can and cannot give you.** ONNX sentence embeddings (all-MiniLM-L6-v2) are unit-norm. Rescaling or exp-mapping a unit vector puts every point at the same radius (the MCP `embeddings_hyperbolic convert` gives tanh(0.5) = 0.4621 for all of them), so the radius carries no depth and parent/child distances come out nearly the same as cross-branch distances. Projecting a text embedding does not create hierarchy.
3. **Put the hierarchy in yourself.** Choose each node's radius from its depth in the tree (root near 0, leaves near 1, for example r = tanh(depth * k)), and take its direction from the text embedding, or use embeddings trained on the tree's edges. Measure on your own tree: parent-child distance should be clearly smaller than cross-branch distance.
   ```bash
   npx -y ruvector@0.3.3 embed text "hierarchical concept" -o concept.vec.json   # direction only
   ```
4. **Geodesic distance** for points strictly inside the unit ball: `d(u, v) = arcosh(1 + 2 * ||u-v||^2 / ((1-||u||^2)(1-||v||^2)))`. The MCP `embeddings_hyperbolic distance` computes it (curvature -1) and returns `success: false` for a point on or outside the ball rather than a null distance.
5. **Store results**:
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "hyperbolic-CONCEPT", value: "COORDINATES_AND_NEIGHBORS", namespace: "hyperbolic-embeddings" })`

## Caveats

- ruvector@0.3.3 has no `--model poincare` flag; `attention hyperbolic` is the Poincare-ball attention op, not a text-embedding projector.
- "Norm encodes depth" only holds when you set the radius from depth yourself (step 3). It does not come from the embedding.
- If you need a hyperbolic search index, store the placed coordinates in AgentDB and compute geodesic distance in your own retrieval code.

## Poincare ball properties (for points you placed by depth)

| Property | Meaning |
|----------|---------|
| Norm close to 0 | Root-level concept (only if you assigned radius by depth) |
| Norm close to 1 | Leaf-level concept (same condition) |
| Small geodesic distance | Close in the hierarchy you encoded |
| Large geodesic distance | Distant subtrees in the hierarchy you encoded |

## Use cases

- **Dependency analysis**: embed module imports to find tightly coupled subtrees
- **Code architecture**: map class hierarchies to discover structural patterns
- **Knowledge organization**: embed concepts to reveal taxonomic relationships
- **Codebase navigation**: find most specific/general modules relative to a query
