// Loader hooks for agentic-flow-root-import.test.ts. Replaces agentic-flow and the
// embedders ahead of it with in-memory modules, so the test never loads (or runs)
// the real agentic-flow CLI. The fake root entry only reports that it was evaluated.
const FAKES = {
  'agentic-flow': "process.stderr.write('AGENTIC_FLOW_ROOT_EVALUATED\\n'); export const embeddings = undefined;",
  'agentic-flow/reasoningbank': process.env.PROBE_REASONINGBANK === 'throw'
    ? "throw new Error('reasoningbank unavailable');"
    : 'export const computeEmbedding = undefined; export const retrieveMemories = undefined;',
  '@huggingface/transformers': 'export const pipeline = undefined;',
  '@xenova/transformers': 'export const pipeline = undefined;',
  ruvector: 'export const initOnnxEmbedder = undefined; export const getOptimizedOnnxEmbedder = undefined;',
};

export async function resolve(specifier, context, next) {
  if (Object.hasOwn(FAKES, specifier)) {
    return { url: `probe:${specifier}`, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('probe:')) {
    return { format: 'module', source: FAKES[url.slice('probe:'.length)], shortCircuit: true };
  }
  return next(url, context);
}
