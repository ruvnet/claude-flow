#!/usr/bin/env node
/**
 * Shared helper for the ruflo-deepseek-harness plugin.
 *
 * Calls the DeepSeek OpenAI-compatible Chat Completions API
 * (https://api.deepseek.com/v1/chat/completions). Reads the key from
 * DEEPSEEK_API_KEY. Never crashes ruflo on boot — every failure emits a
 * JSON object with { status: 'degraded', reason } and exits 0 by default;
 * pass --alert-on-error to exit 1 on a hard failure (missing key, HTTP
 * error, timeout).
 *
 * Modeled on plugins/ruflo-metaharness/scripts/_harness.mjs' graceful
 * degradation shape (ADR-150), so this plugin never becomes a hard runtime
 * dependency of ruflo — remove it and everything else keeps working.
 */

const API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Parse a minimal --key value CLI. Booleans: --flag with no value.
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

/**
 * Emit a degraded/OK JSON envelope and exit.
 * status: 'ok' | 'degraded' | 'error'
 */
export function emitAndExit(payload, { alertOnError = false } = {}) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  const isFailure = payload.status === 'degraded' || payload.status === 'error';
  process.exit(isFailure && alertOnError ? 1 : 0);
}

/**
 * Call DeepSeek's chat/completions endpoint.
 *
 * @param {object} opts
 * @param {string} opts.model            e.g. "deepseek-chat", "deepseek-reasoner"
 * @param {Array}  opts.messages         OpenAI-style messages
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ok: true, data: object} | {ok: false, reason: string, hint?: string}>}
 */
export async function deepseekChat({ model, messages, temperature, maxTokens, timeoutMs }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason: 'DEEPSEEK_API_KEY is not set',
      hint: 'Get a key at https://platform.deepseek.com and export DEEPSEEK_API_KEY=... in your shell.',
    };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const body = { model, messages };
    if (typeof temperature === 'number') body.temperature = temperature;
    if (typeof maxTokens === 'number') body.max_tokens = maxTokens;

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        reason: 'HTTP ' + res.status + ' from DeepSeek',
        hint: text.slice(0, 500),
      };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, reason: 'DeepSeek call timed out after ' + (timeoutMs || DEFAULT_TIMEOUT_MS) + 'ms' };
    }
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Convenience: pull the first choice's message content (and reasoning_content
 * when present, for deepseek-reasoner).
 */
export function extractCompletion(data) {
  const choice = data && data.choices && data.choices[0];
  if (!choice || !choice.message) return { content: '', reasoning: '' };
  return {
    content: choice.message.content || '',
    reasoning: choice.message.reasoning_content || '',
    finishReason: choice.finish_reason || null,
  };
}
