// Loader hooks for agentic-flow-root-import.test.ts. Replaces agentic-flow and the
// embedders ahead of it with in-memory modules, so the test never loads (or runs)
// the real agentic-flow CLI. The fake root entry only reports that it was evaluated.
// PROBE_REASONINGBANK=float32|dataview gives reasoningbank a computeEmbedding that
// resolves to a 384-d Float32Array (what agentic-flow returns) or a DataView over one.
const REASONINGBANK_EMBED = `
  export const retrieveMemories = undefined;
  export async function computeEmbedding(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    const v = Float32Array.from({ length: 384 }, (_, i) => Math.sin(h + i * 7) + 1.5);
    process.stderr.write('REASONINGBANK_EMBED ' + text + '\\n');
    return ${process.env.PROBE_REASONINGBANK === 'dataview' ? 'new DataView(v.buffer)' : 'v'};
  }`;
const FAKES = {
  'agentic-flow': "process.stderr.write('AGENTIC_FLOW_ROOT_EVALUATED\\n'); export const embeddings = undefined;",
  'agentic-flow/reasoningbank': process.env.PROBE_REASONINGBANK === 'throw'
    ? "throw new Error('reasoningbank unavailable');"
    : ['float32', 'dataview'].includes(process.env.PROBE_REASONINGBANK)
      ? REASONINGBANK_EMBED
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
