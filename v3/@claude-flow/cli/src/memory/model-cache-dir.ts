import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Resolve a writable cache directory for ONNX model downloads.
 *
 * ADR-454: duplicated intentionally from
 * `@claude-flow/embeddings/src/transformers-loader.ts`'s
 * `resolveModelCacheDir()` rather than imported, since `@claude-flow/cli`
 * has no dependency on `@claude-flow/embeddings` (see the circular
 * optional-dep note in `memory-initializer.ts`).
 */
export function resolveModelCacheDir(): string {
  return (
    process.env.TRANSFORMERS_CACHE ||
    process.env.HF_HOME ||
    path.join(os.homedir(), '.cache', 'ruflo', 'models')
  );
}
