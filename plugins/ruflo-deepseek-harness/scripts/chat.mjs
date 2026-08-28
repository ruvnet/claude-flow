#!/usr/bin/env node
/**
 * DeepSeek chat completion — non-reasoning model (`deepseek-chat`).
 *
 * Usage:
 *   node plugins/ruflo-deepseek-harness/scripts/chat.mjs \
 *     --prompt "Summarize the following in one sentence: ..." \
 *     [--system "You are a concise assistant."] \
 *     [--model deepseek-chat] \
 *     [--temperature 0.7] \
 *     [--max-tokens 1024] \
 *     [--format table|json] \
 *     [--alert-on-error]
 */

import { parseArgs, emitAndExit, deepseekChat, extractCompletion } from './_deepseek.mjs';

const args = parseArgs(process.argv.slice(2));
const alertOnError = args['alert-on-error'] === true;

const prompt = args.prompt;
if (!prompt || prompt === true) {
  emitAndExit(
    { status: 'error', reason: '--prompt is required (a string of at least 1 char)' },
    { alertOnError: true } // hard-error even without the flag: this is a usage bug
  );
}

const messages = [];
if (args.system && args.system !== true) messages.push({ role: 'system', content: args.system });
messages.push({ role: 'user', content: prompt });

const model = (args.model && args.model !== true) ? args.model : 'deepseek-chat';
const temperature = args.temperature !== undefined ? Number(args.temperature) : undefined;
const maxTokens = args['max-tokens'] !== undefined ? Number(args['max-tokens']) : undefined;

const result = await deepseekChat({ model, messages, temperature, maxTokens });

if (!result.ok) {
  emitAndExit(
    { status: 'degraded', model, reason: result.reason, hint: result.hint || null },
    { alertOnError }
  );
}

const { content, finishReason } = extractCompletion(result.data);
const usage = result.data.usage || {};

const payload = {
  status: 'ok',
  model,
  content,
  finishReason,
  usage: {
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  },
};

if (args.format === 'table') {
  process.stdout.write(content + '\n');
  process.exit(0);
}

emitAndExit(payload);
