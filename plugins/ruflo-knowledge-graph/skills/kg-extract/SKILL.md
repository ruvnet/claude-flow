---
name: kg-extract
description: Extract entities and relations from source files to build a knowledge graph
argument-hint: "<path>"
allowed-tools: Read Glob Grep mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store mcp__plugin_ruflo-core_ruflo__embeddings_generate Bash
---

# KG Extract

Extract entities (classes, functions, modules, types, concepts) and their relations (imports, extends, implements, depends-on, calls) from source files, then store them as a knowledge graph in AgentDB.

## When to use

When you need to build or update a knowledge graph from source code or documentation. Useful for understanding codebase structure, dependency analysis, and impact assessment.

## Steps

1. **Scan files** -- use `Glob` and `Read` to enumerate and read source files at the given path
2. **Identify entities** -- extract classes, functions, modules, types, and config references from each file
3. **Map relations** -- for each entity, determine its relations to other entities. **Critical: TypeScript `import type` and inline `type` specifiers (`import { type Foo, bar }`) are erased at compile time and MUST NOT be counted as value imports** -- they're a separate, weaker relation. Misclassifying them produces phantom runtime cycles (see ruvnet/ruflo#2049).
   - `imports`: value imports (`import { x } from '...'`, `require(...)`) -- weight `0.9`
   - `type-depends-on`: TypeScript type-only imports (`import type { Foo } from '...'` and `import { type Foo, value } from '...'`) -- weight `0.1`, **never used for cycle detection or runtime impact analysis**
   - `extends`: class inheritance -- weight `0.9`
   - `implements`: interface implementations -- weight `0.7`
   - `depends-on`: constructor dependencies, injected services -- weight `0.8`
   - `calls`: function/method invocations -- weight `0.7`
   - `references`: documentation mentions, comments -- weight `0.3`

   **Regex hint for classifying TS imports** (so a naive `from '...'` grep doesn't conflate the two):
   ```
   ^\s*import\s+type\s+               → type-depends-on (entire import is type-only)
   ^\s*import\s*\{[^}]*\btype\s+\w+   → split: type specifiers → type-depends-on, value specifiers → imports
   ^\s*import\s+[^{]*\bfrom\s+        → imports (value)
   ```
4. **Store in AgentDB** -- call `mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store` for each entity with metadata (name, type, file, line, description)
5. **Create edges** -- call `mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge` for each relation with source, target, relation type, and weight
6. **Report** -- summarize: total entities by type, total relations by type, files scanned

## CLI alternative

```bash
npx @claude-flow/cli@latest memory store --namespace knowledge-graph --key "entity-NAME" --value "METADATA_JSON"
npx @claude-flow/cli@latest memory search --query "entities in auth module" --namespace knowledge-graph
```
