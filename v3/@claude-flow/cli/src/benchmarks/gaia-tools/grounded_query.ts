/**
 * GAIA Tool: grounded_query — ADR-135 / iter-33
 *
 * Calls Gemini 2.5 Flash with the google_search grounding tool and returns
 * a synthesised factual answer plus source citations in a single API call.
 *
 * Architectural advantage over web_search (Google Custom Search):
 *   - web_search: raw snippets → agent reads + parses → 2-3 extra turns
 *   - grounded_query: Gemini synthesises an answer + cites sources in 1 call
 *
 * This is Ruflo's cross-provider stack in action:
 *   Gemini grounds (google_search tool) → Sonnet/Haiku reasons → answer
 *
 * Credential resolution (mirrors performance-capability.ts / web_search.ts):
 *   1. process.env.GOOGLE_AI_API_KEY
 *   2. gcloud secrets versions access latest --secret=GOOGLE_AI_API_KEY --project=ruv-dev
 *   3. Throws with clear instructions if neither is available
 *
 * Free tier: 1500 grounded queries/day on Gemini 2.5 Flash.
 * Pricing: ~$0.075/M input tokens, ~$0.30/M output tokens, grounding free <1500/day.
 *
 * Regression note (iter-47): this file was absent from feat/adr-135-integrate-tracks
 * because the grounded-query-gemini branch was not cherry-picked during Track integration.
 * The omission caused a 36-question empty-answer failure in iter-42 (13.2% vs 49.1% baseline).
 *
 * Refs: ADR-133, ADR-135, iter-30 research, iter-33, iter-47, #2156
 * Live-tested 2026-05-27: Mercedes Sosa GAIA L1 question → HTTP 200, 4 sources.
 */

import { GaiaTool, ToolDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_GENERATE_CONTENT_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const DEFAULT_MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

// Gemini 2.5 Flash pricing (USD per 1M tokens, grounding free under 1500/day)
const PRICE_INPUT_PER_M = 0.075;
const PRICE_OUTPUT_PER_M = 0.30;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GroundedQueryInput {
  query: string;
  max_tokens?: number;
}

export interface GroundedQuerySource {
  title: string;
  uri: string;
  snippet?: string;
}

export interface GroundedQueryResult {
  /** Synthesised factual answer from Gemini. */
  answer: string;
  /** Web pages Gemini cited when composing its answer. */
  sources: GroundedQuerySource[];
  /** Auto-formulated search queries issued by Gemini. */
  search_queries_used: string[];
  /** True when grounding metadata was returned (sources or search_queries present). */
  grounded: boolean;
  /** Always 'gemini-2.5-flash' for this tool. */
  model: string;
  /** Estimated cost in USD. */
  cost_usd: number;
}

// ---------------------------------------------------------------------------
// Internal Gemini API response shape
// ---------------------------------------------------------------------------

interface GeminiPart {
  text?: string;
}

interface GeminiGroundingChunk {
  web?: { title?: string; uri?: string };
}

interface GeminiGroundingSupport {
  groundingChunkIndices?: number[];
  segment?: { text?: string };
}

interface GeminiGroundingMetadata {
  groundingChunks?: GeminiGroundingChunk[];
  webSearchQueries?: string[];
  groundingSupports?: GeminiGroundingSupport[];
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  groundingMetadata?: GeminiGroundingMetadata;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

// ---------------------------------------------------------------------------
// Test hooks (same pattern as web_search.ts — injected without module patching)
// ---------------------------------------------------------------------------

export interface GroundedQueryTestHooks {
  /** Override the API key resolver. */
  resolveKey?: () => Promise<string>;
  /** Override the actual HTTP fetch so tests never make live calls. */
  fetchResponse?: (
    query: string,
    maxTokens: number,
    apiKey: string,
  ) => Promise<GeminiGenerateContentResponse>;
}

export const groundedQueryTestHooks: GroundedQueryTestHooks = {};

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a Google AI API key.
 *
 * Order: env var → gcloud secret → throw.
 * Never returns null — throws with actionable guidance if no key is found.
 */
export async function resolveGoogleAIApiKey(): Promise<string> {
  // 1. Environment variable (fastest path, used in test mocks and CI)
  const envKey = process.env['GOOGLE_AI_API_KEY'];
  if (envKey) return envKey;

  // 2. GCP Secrets Manager (matches resolveApiKey pattern in gaia-bench.ts)
  try {
    const { execSync } = await import('node:child_process');
    const key = execSync(
      'gcloud secrets versions access latest --secret=GOOGLE_AI_API_KEY --project=ruv-dev 2>/dev/null',
      { encoding: 'utf-8', timeout: 5_000 },
    ).trim();
    if (key) return key;
  } catch {
    // gcloud not installed, project unreachable, or secret not yet created
  }

  throw new Error(
    'grounded_query: No Google AI API key found.\n' +
      'Set GOOGLE_AI_API_KEY env var, or ensure `gcloud` is authenticated and\n' +
      'the secret GOOGLE_AI_API_KEY exists in GCP project ruv-dev.\n' +
      'Get a free key at: https://aistudio.google.com/apikey',
  );
}

// ---------------------------------------------------------------------------
// Gemini Grounding API call
// ---------------------------------------------------------------------------

/**
 * Call Gemini 2.5 Flash with google_search grounding and parse the response.
 *
 * Exported so smoke tests can exercise the parser without live HTTP (via
 * groundedQueryTestHooks.fetchResponse).
 */
export async function callGeminiGrounded(
  query: string,
  maxTokens: number,
  apiKey: string,
): Promise<GroundedQueryResult> {
  const url = `${GEMINI_GENERATE_CONTENT_URL}?key=${encodeURIComponent(apiKey)}`;

  const requestBody = {
    contents: [{ parts: [{ text: query }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: maxTokens },
  };

  let rawBody: GeminiGenerateContentResponse;

  if (groundedQueryTestHooks.fetchResponse) {
    rawBody = await groundedQueryTestHooks.fetchResponse(query, maxTokens, apiKey);
  } else {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 400);
      throw new Error(`grounded_query: Gemini HTTP ${resp.status}: ${errText}`);
    }

    rawBody = (await resp.json()) as GeminiGenerateContentResponse;
  }

  return parseGeminiResponse(rawBody);
}

/**
 * Parse a raw Gemini generateContent response into GroundedQueryResult.
 * Exported for unit testing the parser independently.
 */
export function parseGeminiResponse(body: GeminiGenerateContentResponse): GroundedQueryResult {
  const candidate = body.candidates?.[0];

  // Extract text answer
  const answer = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('');

  // Extract grounding metadata
  const meta = candidate?.groundingMetadata;
  const chunks = meta?.groundingChunks ?? [];
  const searchQueries = meta?.webSearchQueries ?? [];

  // Build source list from grounding chunks (deduplicate by URI)
  const seenUris = new Set<string>();
  const sources: GroundedQuerySource[] = [];

  for (const chunk of chunks) {
    const uri = chunk.web?.uri ?? '';
    const title = chunk.web?.title ?? '';
    if (uri && !seenUris.has(uri)) {
      seenUris.add(uri);
      sources.push({ title, uri });
    }
  }

  // Estimate cost
  const inputTokens = body.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = body.usageMetadata?.candidatesTokenCount ?? 0;
  const costUsd =
    (inputTokens / 1_000_000) * PRICE_INPUT_PER_M +
    (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;

  return {
    answer,
    sources,
    search_queries_used: searchQueries,
    grounded: sources.length > 0 || searchQueries.length > 0,
    model: 'gemini-2.5-flash',
    cost_usd: costUsd,
  };
}

// ---------------------------------------------------------------------------
// Format output for Claude (mirrors web_search formatResults pattern)
// ---------------------------------------------------------------------------

function formatResult(result: GroundedQueryResult): string {
  const lines: string[] = [];
  lines.push(`[grounded_query model: ${result.model}]`);

  if (result.answer) {
    lines.push('');
    lines.push(result.answer.trim());
  }

  if (result.sources.length > 0) {
    lines.push('');
    lines.push('Sources:');
    for (let i = 0; i < result.sources.length; i++) {
      const s = result.sources[i];
      lines.push(`[${i + 1}] ${s.title}`);
      lines.push(`    ${s.uri}`);
    }
  }

  if (result.search_queries_used.length > 0) {
    lines.push('');
    lines.push(`Search queries: ${result.search_queries_used.join('; ')}`);
  }

  if (!result.grounded) {
    lines.push('');
    lines.push('[Note: No grounding metadata returned — answer is unverified.]');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// GaiaTool implementation
// ---------------------------------------------------------------------------

export class GroundedQueryTool implements GaiaTool {
  readonly name = 'grounded_query';

  readonly definition: ToolDefinition = {
    name: 'grounded_query',
    description:
      'Query Google Search via Gemini 2.5 Flash grounding. ' +
      'Returns a synthesised factual answer with source citations in a single call — ' +
      'more efficient than web_search for factoid questions because Gemini pre-synthesises ' +
      'the answer rather than returning raw snippets. ' +
      'Use this for: factual lookups, "what year did X happen", "how many Y", ' +
      '"who is Z", or any question requiring current web information with a clean answer. ' +
      'Use web_search instead when you need to read a source page in full.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Question or factual lookup to ground via Google Search.',
        },
        max_tokens: {
          type: 'number',
          description: `Maximum response length in tokens (default: ${DEFAULT_MAX_TOKENS}).`,
        },
      },
      required: ['query'],
    },
  };

  private readonly apiKey?: string;

  constructor(opts?: { apiKey?: string }) {
    this.apiKey = opts?.apiKey;
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const query = String(input['query'] ?? '').trim();
    if (!query) {
      throw new Error('grounded_query: `query` input is required and must be non-empty.');
    }

    const maxTokens = Math.min(
      Math.max(64, Number(input['max_tokens'] ?? DEFAULT_MAX_TOKENS)),
      8192,
    );

    const resolveKeyFn = groundedQueryTestHooks.resolveKey ?? resolveGoogleAIApiKey;
    const apiKey = this.apiKey ?? (await resolveKeyFn());

    process.stderr.write(
      `[grounded_query] model=gemini-2.5-flash query=${JSON.stringify(query)}\n`,
    );

    const result = await callGeminiGrounded(query, maxTokens, apiKey);

    process.stderr.write(
      `[grounded_query] grounded=${result.grounded} sources=${result.sources.length} ` +
        `cost_usd=${result.cost_usd.toFixed(6)}\n`,
    );

    return formatResult(result);
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

export function createGroundedQueryTool(opts?: { apiKey?: string }): GroundedQueryTool {
  return new GroundedQueryTool(opts);
}
