import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    conditions: ['node'],
    // Exercise the workspace security source rather than a stale installed
    // package during cross-package policy integration tests (ADR-324).
    alias: {
      '@claude-flow/security': fileURLToPath(new URL('../security/src/index.ts', import.meta.url)),
      '@claude-flow/providers': fileURLToPath(new URL('../providers/src/index.ts', import.meta.url)),
      // cli-core's export map points at dist/, which is not built in this
      // workspace. Resolve the subpath imports the tests actually use from
      // source instead so they work without a build — same pattern as the
      // providers/security aliases. No root alias: a bare
      // '@claude-flow/cli-core' alias matches as a prefix and Vite appends the
      // subpath onto the replacement file (src/index.ts/mcp-tools/types).
      '@claude-flow/cli-core/mcp-tools/types': fileURLToPath(new URL('../cli-core/src/mcp-tools/types.ts', import.meta.url)),
      '@claude-flow/cli-core/mcp-tools/validate-input': fileURLToPath(new URL('../cli-core/src/mcp-tools/validate-input.ts', import.meta.url)),
      '@claude-flow/cli-core/output': fileURLToPath(new URL('../cli-core/src/output.ts', import.meta.url)),
      '@claude-flow/cli-core/types': fileURLToPath(new URL('../cli-core/src/types.ts', import.meta.url)),
    },
  },
  plugins: [
    {
      name: 'externalize-optional-deps',
      enforce: 'pre',
      resolveId(source) {
        // Don't let Vite resolve optional deps that may have missing subpath
        // exports. These are imported via try/catch dynamic import in src/
        // (sona-optimizer falls back to no-SONA when the package isn't
        // installed). External-marking them keeps vitest from failing
        // module resolution at transform time.
        if (source.startsWith('agentic-flow')) return { id: source, external: true };
        if (source.startsWith('agentdb')) return { id: source, external: true };
        // memory-bridge dynamic-imports this inside try/catch and degrades to
        // the sql.js path; its dist is absent unless the workspace was built.
        if (source === '@claude-flow/memory') return { id: source, external: true };
        if (source.startsWith('@ruvector/')) return { id: source, external: true };
        if (source.startsWith('@huggingface/transformers')) return { id: source, external: true };
        if (source.startsWith('@xenova/transformers')) return { id: source, external: true };
        if (source.startsWith('@noble/ed25519')) return { id: source, external: true };
        return null;
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: true,
    coverage: {
      enabled: false,
    },
  },
});
