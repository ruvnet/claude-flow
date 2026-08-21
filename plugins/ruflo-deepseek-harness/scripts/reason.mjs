#!/usr/bin/env node
/**
 * DeepSeek reasoning completion — `deepseek-reasoner` (aka R1).
 *
 * Surfaces the model's `reasoning_content` (chain-of-thought) separately
 * from the final `content`, so tooling can display or discard the CoT
 * without re-parsing the message.
 *
 * Usage:
 *   node plugins/ruflo-deepseek-harness/scripts/reason.mjs \
 *     --prompt "Prove that sqrt(2) is irrational." \
 *     [--system "..."] \
 *     [--model deepseek-reasoner] \
 *     [--max-tokens 4096] \
 *     [--show-reasoning] \
 *     [--format table|json] \
 *     [--alert-on-error]
 *
 * Notes:
 * - `deepseek-reasoner` ignores `temperature`/`top_p` per DeepSeek's API
 *   docs, so this script does not forward them.
 * - `--show-reasoning` in table mode prints the chain-of-thought before
 *   the answer; in JSON mode the reasoning is always included.
 */

import { parseArgs, emitAndExit, deepseekChat, extractCompletion } from './_deepseek.mjs';

const args = parseArgs(process.argv.slice(2));
const alertOnError = args['alert-on-error'] === true;

const prompt = args.prompt;
if (!prompt || prompt === true) {
  emitAndExit(
    { status: 'error', reason: '--prompt is required (a string of at least 1 char)' },
    { alertOnError: true }
  );
}

const messages = [];
if (args.system && args.system !== true) messages.push({ role: 'system', content: args.system });
messages.push({ role: 'user', content: prompt });

const model = (args.model && args.model !== true) ? args.model : 'deepseek-reasoner';
const maxTokens = args['max-tokens'] !== undefined ? Number(args['max-tokens']) : undefined;

const result = await deepseekChat({ model, messages, maxTokens });

if (!result.ok) {
  emitAndExit(
    { status: 'degraded', model, reason: result.reason, hint: result.hint || null },
    { alertOnError }
  );
}

const { content, reasoning, finishReason } = extractCompletion(result.data);
const usage = result.data.usage || {};

if (args.format === 'table') {
  if (args['show-reasoning']) {
    process.stdout.write('--- reasoning ---\n' + reasoning + '\n--- answer ---\n');
  }
  process.stdout.write(content + '\n');
  process.exit(0);
}

emitAndExit({
  status: 'ok',
  model,
  content,
  reasoning,
  finishReason,
  usage: {
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
    reasoningTokens:
      usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens
        ? usage.completion_tokens_details.reasoning_tokens
        : null,
    totalTokens: usage.total_tokens ?? null,
  },
});
