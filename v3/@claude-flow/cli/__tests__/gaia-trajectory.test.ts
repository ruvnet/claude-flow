/**
 * Tests for the ADR-167 §4 trajectory serialization forward contract.
 *
 *   1. Redactor — planted secrets (sk-…, hf_…, Bearer, AWS, Authorization,
 *      env-var value) are masked; ordinary prose survives.
 *   2. Size-bounder — oversized fields truncate with a `…[truncated N bytes]`
 *      marker; small fields are untouched; per-record cap holds.
 *   3. assembleTrajectory — builds the exact record shape gaia-audit.mjs reads
 *      from a synthetic step list, deriving tools_used and applying redaction.
 *   4. Capture path — a MOCKED runGaiaAgent (stubbed fetch + mock tool
 *      catalogue, $0, no real inference) produces a GaiaAgentResult.trajectory
 *      with prompt/llm_call/tool_call/tool_result steps, and a planted secret
 *      in a tool output never reaches the serialized trajectory.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  redactSecrets,
  redactValue,
  boundSize,
  sanitizeStep,
  assembleTrajectory,
  toTrajectoryRecord,
  toJsonl,
  REDACTED,
  DEFAULT_STEP_MAX_BYTES,
  type TrajectoryStep,
} from '../src/benchmarks/gaia-trajectory.js';
import { runGaiaAgent } from '../src/benchmarks/gaia-agent.js';
import type { GaiaTool, ToolDefinition } from '../src/benchmarks/gaia-tools/index.js';

// Fake, secret-SHAPED test values. Assembled from fragments at runtime so no
// contiguous secret literal appears in source (keeps gitleaks/CodeQL quiet)
// while the runtime string is still a realistic shape for the redactor.
const FAKE = {
  anthropic: 'sk-' + 'ant-api03-AbCdEf0123456789ghIJklMnOpQr',
  anthropicEnv: 'sk-' + 'ant-fixturekeyvalue0000',
  hf: 'hf' + '_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
  aws: 'AKIA' + 'IOSFODNN7EXAMPLE',
  google: 'AIza' + 'SyD-1234567890abcdefghijklmnopqrstuvw',
  bearer: 'Authorization: Bearer ' + 'abcdef123456ghijkl',
  xApiKey: 'x-api-key: ' + 'superSecretValue123',
};

// ── 1. Redactor ────────────────────────────────────────────────────────────
describe('redactSecrets', () => {
  const env = { ANTHROPIC_API_KEY: FAKE.anthropicEnv, HOME: '/home/x' };

  it('masks known secret shapes', () => {
    const planted = [FAKE.anthropic, FAKE.hf, FAKE.aws, FAKE.bearer, FAKE.xApiKey, FAKE.google];
    for (const secret of planted) {
      const out = redactSecrets(`prefix ${secret} suffix`, env);
      expect(out, `should mask: ${secret}`).toContain(REDACTED);
      expect(out).not.toContain(secret);
    }
  });

  it('masks a secret-named env-var value wherever it appears', () => {
    const out = redactSecrets(`token is ${FAKE.anthropicEnv} done`, env);
    expect(out).toBe(`token is ${REDACTED} done`);
  });

  it('leaves ordinary prose and short/non-secret env values intact', () => {
    expect(redactSecrets('The capital of France is Paris.', env))
      .toBe('The capital of France is Paris.');
    // HOME is not secret-named -> its value must NOT trigger redaction.
    expect(redactSecrets('path /home/x is fine', env)).toBe('path /home/x is fine');
  });

  it('recursively redacts string leaves of an object (redactValue)', () => {
    const obj = { q: FAKE.hf, n: 3, nested: ['ok', FAKE.aws] };
    const red = redactValue(obj, env);
    expect(JSON.stringify(red)).not.toContain(FAKE.hf);
    expect(JSON.stringify(red)).not.toContain(FAKE.aws);
    expect(red.n).toBe(3);
  });
});

// ── 2. Size-bounder ──────────────────────────────────────────────────────────
describe('boundSize', () => {
  it('truncates oversized text with a byte-accurate marker', () => {
    const big = 'x'.repeat(20_000);
    const out = boundSize(big, 8 * 1024);
    expect(out).toMatch(/…\[truncated \d+ bytes\]$/);
    expect(out.startsWith('x'.repeat(8 * 1024))).toBe(true);
    const dropped = Number(/truncated (\d+) bytes/.exec(out)![1]);
    expect(dropped).toBe(20_000 - 8 * 1024);
  });

  it('leaves small text untouched', () => {
    expect(boundSize('short', 8 * 1024)).toBe('short');
  });

  it('never splits a multibyte UTF-8 character', () => {
    const out = boundSize('€'.repeat(5000), 100); // € is 3 bytes
    expect(out).toContain('…[truncated');
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
    expect(out).not.toContain('�'); // no replacement char from a bad cut
  });
});

// ── 3. assembleTrajectory ────────────────────────────────────────────────────
describe('assembleTrajectory', () => {
  const env = { ANTHROPIC_API_KEY: FAKE.anthropicEnv };

  it('builds the audit record shape, derives tools_used, and redacts', () => {
    const steps: TrajectoryStep[] = [
      { type: 'prompt', content: 'You are precise. Question: capital of France?' },
      { type: 'llm_call', output: 'I will search.', tokens_in: 100, tokens_out: 10 },
      { type: 'tool_call', name: 'web_search', input: { query: 'capital of France' } },
      { type: 'tool_result', name: 'web_search', output: `Paris. key=${FAKE.hf}`, url: 'https://x' },
      { type: 'llm_call', output: 'FINAL_ANSWER: Paris', tokens_in: 200, tokens_out: 5 },
    ];
    const traj = assembleTrajectory(
      { prompt: steps[0].content!, turns: 2, inputTokens: 300, outputTokens: 15, steps },
      { env },
    );
    expect(traj.tools_used).toEqual(['web_search']);
    expect(traj.steps.map((s) => s.type)).toEqual([
      'prompt', 'llm_call', 'tool_call', 'tool_result', 'llm_call',
    ]);
    // Secret in the tool_result output is redacted in the assembled record.
    expect(JSON.stringify(traj)).not.toContain(FAKE.hf);
    expect(JSON.stringify(traj)).toContain(REDACTED);
    // Round-trips as one jsonl line with task_id prepended.
    const line = toJsonl([toTrajectoryRecord('task-1', traj)]).trim();
    const parsed = JSON.parse(line);
    expect(parsed.task_id).toBe('task-1');
    expect(parsed.steps).toHaveLength(5);
  });

  it('enforces the per-record byte cap', () => {
    const steps: TrajectoryStep[] = Array.from({ length: 50 }, (_, i) => ({
      type: 'tool_result' as const,
      name: 'web_search',
      output: 'y'.repeat(DEFAULT_STEP_MAX_BYTES),
    }));
    const traj = assembleTrajectory(
      { prompt: 'p', turns: 50, inputTokens: 0, outputTokens: 0, steps },
      { env, recordMaxBytes: 64 * 1024 },
    );
    expect(Buffer.byteLength(JSON.stringify(traj), 'utf8')).toBeLessThanOrEqual(64 * 1024);
  });
});

// ── 4. Capture path (mocked runGaiaAgent — $0, no real inference) ─────────────
describe('runGaiaAgent trajectory capture (mocked model + tools)', () => {
  afterEach(() => vi.restoreAllMocks());

  function mockCatalogue(): GaiaTool[] {
    const definition: ToolDefinition = {
      name: 'web_search',
      description: 'mock',
      input_schema: { type: 'object', properties: { query: { type: 'string' } } },
    };
    return [{
      name: 'web_search',
      definition,
      // Planted secret in the fetched output — must NOT survive serialization.
      execute: async () => `Search result: The capital of France is Paris. leaked=${FAKE.hf}`,
    }];
  }

  function anthropicResponse(body: object) {
    return { ok: true, json: async () => body, text: async () => '' } as unknown as Response;
  }

  it('captures prompt/llm_call/tool_call/tool_result steps and redacts tool output', async () => {
    const responses = [
      // turn 0 -> ask for a tool call
      anthropicResponse({
        id: 'm1', model: 'mock', stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me search.' },
          { type: 'tool_use', id: 'tu_1', name: 'web_search', input: { query: 'capital of France' } },
        ],
        usage: { input_tokens: 120, output_tokens: 12 },
      }),
      // turn 1 -> final answer
      anthropicResponse({
        id: 'm2', model: 'mock', stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'FINAL_ANSWER: Paris' }],
        usage: { input_tokens: 300, output_tokens: 6 },
      }),
    ];
    const fetchMock = vi.fn(async () => responses.shift()!);
    vi.stubGlobal('fetch', fetchMock);

    const result = await runGaiaAgent(
      { task_id: 'q-cap', question: 'What is the capital of France?', level: 1, final_answer: 'Paris', file_name: null, file_path: null },
      { apiKey: 'test-key', catalogue: mockCatalogue(), enableConvergence: false, planningInterval: 0 },
    );

    expect(result.finalAnswer).toBe('Paris');
    const traj = result.trajectory!;
    expect(traj).toBeDefined();
    const types = traj.steps.map((s) => s.type);
    expect(types[0]).toBe('prompt');
    expect(types).toContain('llm_call');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(traj.tools_used).toEqual(['web_search']);

    // The tool_call carries name+args (grader-isolation surface).
    const call = traj.steps.find((s) => s.type === 'tool_call')!;
    expect(call.name).toBe('web_search');
    expect(JSON.stringify(call.input)).toContain('capital of France');

    // The fetched tool_result output is present (answer-leakage surface) but the
    // planted secret is redacted.
    const res = traj.steps.find((s) => s.type === 'tool_result')!;
    expect(res.output).toContain('Paris');
    expect(JSON.stringify(traj)).not.toContain(FAKE.hf);

    // The agent-visible prompt must NOT contain the gold answer (oracle surface).
    expect(traj.prompt).not.toContain('Paris');
  });
});
