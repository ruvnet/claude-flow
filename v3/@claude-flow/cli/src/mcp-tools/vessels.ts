/**
 * Vessel registry — thin config wrappers for LLM providers.
 *
 * A "vessel" is PURE config: it describes a provider endpoint by its wire
 * shape (`anthropic` | `openai`), a base URL, an API key, and a model tier
 * map. Vessels map onto the existing `BaseProvider` classes in
 * `@claude-flow/providers` (an anthropic-shaped vessel IS an
 * `AnthropicProvider` with apiUrl/apiKey set; openai-shaped IS an
 * `OpenAIProvider`). This module owns the vessel → `ProviderManagerConfig`
 * translation so the rest of the CLI treats provider wiring as data.
 */

import type {
  LLMProvider,
  LLMProviderConfig,
  ProviderManagerConfig,
} from '@claude-flow/providers';

// ===== VESSEL TYPES =====

/** Wire protocol a vessel speaks. Drives which `BaseProvider` subclass backs it. */
export type ProviderShape = 'anthropic' | 'openai';

/** Logical capability tiers. Maps onto provider-specific model ids. */
export type ModelTier = 'opus' | 'sonnet' | 'haiku' | 'fable';

/**
 * A single provider endpoint described as config. No runtime state —
 * `toProviderManagerConfig` turns a list of these into the shape
 * `ProviderManager` consumes.
 */
export interface VesselConfig {
  /** Stable name, used as the merge key in `mergeVessels`. */
  name: string;
  /** Wire protocol — `anthropic` → Messages API, `openai` → chat completions. */
  shape: ProviderShape;
  /** Provider base URL (e.g. `https://api.anthropic.com/v1`). */
  baseUrl: string;
  /** Auth credential. May be empty for local/self-hosted endpoints. */
  apiKey: string;
  /** Logical tier → concrete model id. Missing tiers pass through literally. */
  models: Partial<Record<ModelTier, string>>;
  /** Extra request headers (e.g. OpenRouter `HTTP-Referer` / `X-Title`). */
  headers?: Record<string, string>;
  /**
   * Auth scheme for anthropic-shaped vessels. Default `x-api-key` matches the
   * Anthropic Messages API (and ZAI). `bearer` emits `Authorization: Bearer
   * <apiKey>` instead — used by LongCat's `/anthropic` proxy, which rejects
   * x-api-key. Driven by config, not vessel name.
   */
  auth?: 'x-api-key' | 'bearer';
  /** Per-request timeout in milliseconds. */
  timeout?: number;
  /** Provider-specific options forwarded onto `LLMProviderConfig.providerOptions`. */
  providerOptions?: Record<string, unknown>;
}

// ===== BUILT-IN VESSELS =====

/**
 * Default vessels shipped with the CLI. User config (env vars or explicit
 * records) overrides same-named entries via `mergeVessels` — these are the
 * baseline, not the final word.
 */
export const BUILTIN_VESSELS: Record<string, VesselConfig> = {
  anthropic: {
    name: 'anthropic',
    shape: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    models: {
      haiku: 'claude-haiku-4-5-20251001',
      sonnet: 'claude-sonnet-5',
      opus: 'claude-opus-4-8',
    },
  },
  zai: {
    name: 'zai',
    shape: 'anthropic',
    baseUrl: 'https://api.z.ai/api/anthropic',
    apiKey: '',
    models: {
      haiku: 'glm-4.7',
      sonnet: 'glm-5.1',
      opus: 'glm-5.2',
    },
    headers: {},
  },
  longcat: {
    name: 'longcat',
    shape: 'anthropic',
    baseUrl: 'https://api.longcat.chat/anthropic',
    apiKey: '',
    auth: 'bearer',
    models: {
      haiku: 'longcat-2.0',
      sonnet: 'longcat-2.0',
      opus: 'longcat-2.0',
    },
  },
  openrouter: {
    name: 'openrouter',
    shape: 'openai',
    baseUrl: 'https://openrouter.ai/api',
    apiKey: '',
    models: {
      haiku: 'inclusionai/ling-2.6-flash',
      sonnet: 'openai/gpt-4.1',
      opus: 'anthropic/claude-opus-4',
    },
  },
  ollama: {
    name: 'ollama',
    shape: 'openai',
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    models: {},
  },
};

// ===== FUNCTIONS =====

/**
 * Infer a provider shape from a base URL. Anthropic's Messages API is the
 * special case (URL path contains `/anthropic`); everything else is treated
 * as OpenAI-chat-completions-shaped (Ollama, OpenRouter, LiteLLM, custom).
 *
 * #2042 — OpenRouter fronts many providers but speaks the OpenAI wire shape,
 * so the default branch is the safe choice for OpenAI-compat endpoints.
 */
export function inferShape(url: string): ProviderShape {
  return url.includes('/anthropic') ? 'anthropic' : 'openai';
}

/**
 * Resolve a logical tier to a concrete model id for a vessel. If the vessel
 * has no mapping for the tier, the tier string is returned verbatim — callers
 * passing already-resolved ids (e.g. `anthropic/claude-opus-4`) pass through
 * untouched.
 */
export function resolveModel(vessel: VesselConfig, tier: string): string {
  return vessel.models[tier as ModelTier] || tier;
}

/**
 * Translate a list of vessels into a `ProviderManagerConfig`. Each vessel
 * becomes one `LLMProviderConfig` keyed by its shape's provider name; the
 * sonnet tier is used as the per-provider default model. Fallback is enabled
 * (maxAttempts 2) so a failed provider can try its siblings.
 *
 * `defaultVesselName` pins the primary provider by vessel name; when omitted
 * the first vessel in the list wins.
 */
export function toProviderManagerConfig(
  vessels: VesselConfig[],
  defaultVesselName?: string,
): ProviderManagerConfig {
  const providers: LLMProviderConfig[] = vessels.map((vessel) => {
    // ProviderShape ('anthropic' | 'openai') is a subset of LLMProvider.
    const provider: LLMProvider = vessel.shape;

    // Merge vessel-supplied headers. For bearer-auth vessels, synthesize the
    // `Authorization: Bearer <apiKey>` header here from the runtime apiKey —
    // the value is never hardcoded in source. The provider only switches to
    // Bearer when this header is present, so x-api-key vessels are unaffected.
    const headers: Record<string, string> = { ...(vessel.headers ?? {}) };
    if (vessel.auth === 'bearer') {
      headers['Authorization'] = `Bearer ${vessel.apiKey}`;
    }

    return {
      provider,
      apiUrl: vessel.baseUrl,
      apiKey: vessel.apiKey,
      model: vessel.models.sonnet || '',
      providerOptions: vessel.providerOptions,
      timeout: vessel.timeout,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    };
  });

  const defaultProvider: LLMProvider = defaultVesselName
    ? (vessels.find((v) => v.name === defaultVesselName)?.shape
        ?? vessels[0]?.shape
        ?? 'anthropic')
    : (vessels[0]?.shape ?? 'anthropic');

  return {
    providers,
    defaultProvider,
    fallback: { enabled: true, maxAttempts: 2 },
  };
}

/**
 * Shallow-merge built-in and user vessel records. User vessels override
 * same-named built-ins; built-ins with no user counterpart survive. Neither
 * input is mutated.
 */
export function mergeVessels(
  builtins: Record<string, VesselConfig>,
  user: Record<string, VesselConfig>,
): Record<string, VesselConfig> {
  return { ...builtins, ...user };
}

/**
 * Build a vessel record from environment variables, applying env overrides
 * onto a copy of the built-ins (the module-level constant is never mutated).
 *
 * - `ANTHROPIC_BASE_URL` → synthesizes an `env-anthropic` vessel from the
 *   standard Anthropic env vars. Tier models are optional; only non-empty
 *   `ANTHROPIC_DEFAULT_*_MODEL` values are included.
 * - `OPENROUTER_BASE_URL` / `OPENROUTER_API_KEY` (#2042) → override the
 *   openrouter built-in.
 * - `OLLAMA_BASE_URL` → override the ollama built-in's baseUrl.
 *
 * Only vessels with meaningful config (a baseUrl or apiKey) are returned.
 */
export function vesselsFromEnv(): Record<string, VesselConfig> {
  const vessels: Record<string, VesselConfig> = {};

  // Seed from a shallow copy of the built-ins so env overrides never mutate
  // the shared BUILTIN_VESSELS constant across calls.
  for (const [name, cfg] of Object.entries(BUILTIN_VESSELS)) {
    vessels[name] = { ...cfg, models: { ...cfg.models } };
  }

  // ANTHROPIC_BASE_URL → synthesize an env-anthropic vessel. Models are
  // optional; only non-empty tier overrides are included so `resolveModel`
  // falls back to the literal tier string when a tier is unmapped.
  const anthropicBase = process.env.ANTHROPIC_BASE_URL;
  if (anthropicBase) {
    const models: Partial<Record<ModelTier, string>> = {};
    const setIfPresent = (tier: ModelTier, value: string | undefined): void => {
      if (value) models[tier] = value;
    };
    setIfPresent('sonnet', process.env.ANTHROPIC_DEFAULT_SONNET_MODEL);
    setIfPresent('opus', process.env.ANTHROPIC_DEFAULT_OPUS_MODEL);
    setIfPresent('haiku', process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL);
    setIfPresent('fable', process.env.ANTHROPIC_DEFAULT_FABLE_MODEL);
    vessels['env-anthropic'] = {
      name: 'env-anthropic',
      shape: 'anthropic',
      baseUrl: anthropicBase,
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      models,
    };
  }

  // #2042 — OpenRouter is configured via env vars in many setups. Override
  // the openrouter built-in's baseUrl/apiKey when either is present.
  const openrouterBase = process.env.OPENROUTER_BASE_URL;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if ((openrouterBase || openrouterKey) && vessels['openrouter']) {
    if (openrouterBase) vessels['openrouter'].baseUrl = openrouterBase;
    if (openrouterKey) vessels['openrouter'].apiKey = openrouterKey;
  }

  // OLLAMA_BASE_URL lets users point at non-default Ollama endpoints
  // (e.g. http://ruvultra:11434, a remote host) instead of localhost.
  const ollamaBase = process.env.OLLAMA_BASE_URL;
  if (ollamaBase && vessels['ollama']) {
    vessels['ollama'].baseUrl = ollamaBase;
  }

  // Keep only vessels with meaningful config. Built-ins always carry a
  // baseUrl, so this primarily guards against partially-constructed env
  // vessels and drops entries that ended up fully empty.
  const result: Record<string, VesselConfig> = {};
  for (const [name, cfg] of Object.entries(vessels)) {
    if (cfg.baseUrl || cfg.apiKey) result[name] = cfg;
  }
  return result;
}
