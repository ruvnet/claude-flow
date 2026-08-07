/**
 * Vessel runtime dispatch — bridges vessel registry → ProviderManager (live @claude-flow/providers path).
 *
 * Given a resolved vessel + a prompt, this builds a `ProviderManager` from the
 * vessel registry config, dispatches a provider-agnostic request, and returns a
 * normalized result. It is the single execution path that revives
 * `@claude-flow/providers` as the live backend for agent execution, replacing
 * the hand-rolled fetch in `callAnthropicMessages`.
 *
 * #1725 — Tier-2/3 provider routing (Ollama / OpenRouter) is now driven by the
 * vessel registry + ProviderManager fallback rather than env-var branching.
 * #2042 — OpenRouter (OpenAI-compat wire shape) is a first-class vessel.
 * #2357 — adaptive-thinking model families that reject sampling params
 * (temperature/top_p/top_k) are stripped via `vesselRejectsSamplingParams`.
 */

import type { VesselConfig } from './vessels.js';
import type { VesselCallInput, VesselCallResult } from './agent-execute-core.js';
import type { LLMMessage, LLMProvider, LLMRequest } from '@claude-flow/providers';
import { resolveModel, toProviderManagerConfig } from './vessels.js';
import { vesselRejectsSamplingParams } from './vessel-schema.js';
import { createProviderManager } from '@claude-flow/providers';

/** Default per-call timeout (ms) when the caller omits one. */
const DEFAULT_TIMEOUT_MS = 60000;

/** Logical tier used when the caller supplies no model — `resolveModel` maps it. */
const DEFAULT_TIER = 'sonnet';

/**
 * Dispatch a prompt through the vessel registry via the live
 * `@claude-flow/providers` `ProviderManager`.
 *
 * Vessel selection prefers `input.vesselName`, then the `anthropic` vessel,
 * then the first registered vessel. The chosen vessel's shape selects the
 * preferred provider; `ProviderManager` handles fallback between siblings.
 *
 * @param vessels - Registered vessel registry (name → config).
 * @param input - Call input: prompt, optional system prompt/model/params, vessel override.
 * @param input.prompt - User prompt to send.
 * @param input.systemPrompt - Optional system prompt (placed in messages).
 * @param input.model - Optional tier (`haiku`/`sonnet`/`opus`) or concrete model id.
 * @param input.maxTokens - Optional max output tokens.
 * @param input.temperature - Optional sampling temperature (stripped for rejecting families).
 * @param input.timeoutMs - Optional per-call timeout in ms (default 60000).
 * @param input.vesselName - Optional vessel to target; defaults to `anthropic` then first.
 */
export async function dispatchViaVessel(
  vessels: Record<string, VesselConfig>,
  input: VesselCallInput,
): Promise<VesselCallResult> {
  const startedAt = Date.now();
  const vesselNames = Object.keys(vessels);

  if (vesselNames.length === 0) {
    return {
      success: false,
      error:
        'No vessels configured: vessel registry is empty. Add at least one vessel before dispatching.',
      durationMs: Date.now() - startedAt,
    };
  }

  // Resolve the target vessel: explicit → 'anthropic' → first registered.
  const chosenName = input.vesselName ?? (vessels['anthropic'] ? 'anthropic' : vesselNames[0]);
  const vessel = vessels[chosenName];
  if (!vessel) {
    return {
      success: false,
      error: `Vessel "${chosenName}" not found in registry. Available: ${vesselNames.join(', ')}`,
      durationMs: Date.now() - startedAt,
    };
  }

  // Resolve the concrete model. `input.model` may be a logical tier (mapped via
  // the vessel's `models` table) or an already-resolved id (passed through).
  const model = resolveModel(vessel, input.model || DEFAULT_TIER);

  // Build the provider config. `toProviderManagerConfig` takes an array and a
  // default-vessel name; we convert the record and pin the chosen vessel as
  // primary. Honor `input.timeoutMs` by overriding the chosen vessel's timeout
  // in a non-mutating copy (the provider reads `config.timeout` per-call).
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const vesselList = Object.values(vessels).map((v) =>
    v.name === chosenName ? { ...v, timeout: timeoutMs } : v,
  );
  const cfg = toProviderManagerConfig(vesselList, chosenName);

  // Build the provider-agnostic request. The system prompt is placed into
  // `messages` as a system-role entry for BOTH wire shapes: the Anthropic
  // provider's `buildRequest` reads system from `messages.find(role==='system')`
  // (there is no `system` field on `LLMRequest`), and OpenAI chat-completions
  // expects system in messages. The provider applies prompt caching (#8) itself.
  const messages: LLMMessage[] = [];
  if (input.systemPrompt) {
    messages.push({ role: 'system', content: input.systemPrompt });
  }
  messages.push({ role: 'user', content: input.prompt });

  const request: LLMRequest = {
    model,
    messages,
    maxTokens: input.maxTokens,
    stream: false,
  };
  // #2357 — strip temperature/top_p for model families that reject sampling
  // params with HTTP 400 "Extra inputs are not permitted" (Anthropic adaptive-
  // thinking, ZAI GLM, LongCat). Unknown families default to sending params.
  if (!vesselRejectsSamplingParams(vessel.name, model) && typeof input.temperature === 'number') {
    request.temperature = input.temperature;
  }

  try {
    const mgr = await createProviderManager(cfg);
    try {
      // `vessel.shape` ('anthropic' | 'openai') is a valid `LLMProvider` value.
      const preferredProvider: LLMProvider = vessel.shape;
      const resp = await mgr.complete(request, preferredProvider);

      return {
        success: true,
        model: resp.model,
        messageId: resp.id,
        stopReason: resp.finishReason,
        output: resp.content,
        usage: {
          inputTokens: resp.usage.promptTokens,
          outputTokens: resp.usage.completionTokens,
          totalTokens: resp.usage.totalTokens,
        },
        durationMs: Date.now() - startedAt,
      };
    } finally {
      // Release provider connections / listeners; manager is per-call.
      mgr.destroy();
    }
  } catch (err) {
    return {
      success: false,
      model,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}
