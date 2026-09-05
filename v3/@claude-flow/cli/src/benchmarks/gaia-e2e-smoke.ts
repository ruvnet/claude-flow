/**
 * GAIA End-to-End Smoke — ADR-133
 *
 * Wires gaia-agent.ts + gaia-judge.ts into a single end-to-end pipeline:
 *
 *   for each question in SMOKE_FIXTURE:
 *     1. runGaiaAgent(question)  — Haiku agent loop, ≤8 turns
 *     2. judgeAnswer(question, result.finalAnswer)  — exact-match fast-path,
 *        Sonnet LLM-judge only if exact-match misses
 *
 * Reports: pass rate, total cost, mean turn count.
 * Asserts: ≥ 3/5 questions pass (lenient — smoke fixture is not trivial).
 *
 * Cost discipline:
 *   - Agent: claude-haiku-4-5 at $0.25/$1.25 per M tokens
 *   - Judge: claude-sonnet-4-6 at $3/$15 per M tokens (only when needed)
 *   - Expected total for 5 questions × ~2 turns × Haiku + 1-2 Sonnet
 *     judge calls ≈ $0.02
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx src/benchmarks/gaia-e2e-smoke.ts
 *
 * Refs: ADR-133, #2156
 */

import * as os from 'node:os';
import * as path from 'node:path';
import {
  SMOKE_FIXTURE,
  GaiaQuestion,
} from './gaia-loader.js';
import {
  runGaiaAgent,
  GaiaAgentResult,
} from './gaia-agent.js';
import {
  judgeAnswer,
  JudgeResult,
  JudgeOptions,
} from './gaia-judge.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Agent model — Haiku only for cost discipline. */
const AGENT_MODEL = 'claude-haiku-4-5';

/** Judge model — Sonnet for semantic judgments (only when exact-match fails). */
const JUDGE_MODEL = 'claude-sonnet-4-6';

/** Minimum pass rate for smoke to succeed. */
const MIN_PASS_RATE = 3 / 5;

// Haiku pricing ($/M tokens)
const HAIKU_IN = 0.25;
const HAIKU_OUT = 1.25;

// Sonnet pricing ($/M tokens)
const SONNET_IN = 3.0;
const SONNET_OUT = 15.0;

// ---------------------------------------------------------------------------
// Result row
// ---------------------------------------------------------------------------

interface E2ERow {
  question: GaiaQuestion;
  agentResult: GaiaAgentResult;
  judgeResult: JudgeResult;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runE2ESmoke(): Promise<void> {
  const hasKey = !!(process.env.ANTHROPIC_API_KEY?.trim());
  if (!hasKey) {
    console.error(
      'ANTHROPIC_API_KEY is required for the end-to-end smoke.\n' +
      'Set it with: export ANTHROPIC_API_KEY=sk-ant-...',
    );
    process.exit(1);
  }

  const cacheDir = path.join(os.homedir(), '.cache', 'ruflo', 'gaia', 'judgments');
  const judgeOpts: JudgeOptions = { judgeModel: JUDGE_MODEL, cacheDir };

  const questions = SMOKE_FIXTURE;
  const rows: E2ERow[] = [];

  console.log(`\n=== GAIA End-to-End Smoke (${questions.length} questions) ===\n`);
  console.log(
    `Agent: ${AGENT_MODEL}  |  Judge: ${JUDGE_MODEL}\n` +
    `Questions: ${questions.length}  |  Min pass rate: ${(MIN_PASS_RATE * 100).toFixed(0)}%\n`,
  );

  for (const q of questions) {
    process.stdout.write(`[${q.task_id}] "${q.question.slice(0, 60)}..." `);

    // Run agent
    const agentResult = await runGaiaAgent(q, { model: AGENT_MODEL });

    // Judge
    const judgeResult = await judgeAnswer(
      { id: q.task_id, expected: q.final_answer, questionText: q.question },
      agentResult.finalAnswer,
      judgeOpts,
    );

    rows.push({ question: q, agentResult, judgeResult });

    const verdict = judgeResult.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    const path_ = judgeResult.scoringPath;
    console.log(
      `${verdict}  (turns=${agentResult.turns}, ` +
      `answer="${agentResult.finalAnswer ?? 'null'}", ` +
      `expected="${q.final_answer}", path=${path_})`,
    );
  }

  // ── Summary ──
  console.log('\n--- Summary ---\n');

  const passed = rows.filter((r) => r.judgeResult.passed).length;
  const total = rows.length;
  const passRate = passed / total;

  let totalAgentCostUsd = 0;
  let totalJudgeCostUsd = 0;
  let totalTurns = 0;

  for (const row of rows) {
    const { agentResult, judgeResult } = row;
    totalTurns += agentResult.turns;
    totalAgentCostUsd +=
      (agentResult.totalInputTokens / 1_000_000) * HAIKU_IN +
      (agentResult.totalOutputTokens / 1_000_000) * HAIKU_OUT;
    totalJudgeCostUsd += judgeResult.judgeCostUsd ?? 0;
  }

  const totalCostUsd = totalAgentCostUsd + totalJudgeCostUsd;
  const meanTurns = totalTurns / total;

  console.log(`Pass rate      : ${passed}/${total}  (${(passRate * 100).toFixed(0)}%)`);
  console.log(`Mean turns     : ${meanTurns.toFixed(1)}`);
  console.log(`Agent cost     : $${totalAgentCostUsd.toFixed(5)}  (Haiku)`);
  console.log(`Judge cost     : $${totalJudgeCostUsd.toFixed(5)}  (Sonnet, only when needed)`);
  console.log(`Total cost     : $${totalCostUsd.toFixed(5)}`);

  // ── Per-row detail ──
  console.log('\n--- Per-question detail ---\n');
  for (const row of rows) {
    const { question, agentResult, judgeResult } = row;
    const verdict = judgeResult.passed ? 'PASS' : 'FAIL';
    console.log(
      `  ${verdict}  ${question.task_id}  turns=${agentResult.turns}  ` +
      `path=${judgeResult.scoringPath}  ` +
      `answer="${agentResult.finalAnswer ?? 'null'}"  ` +
      `expected="${question.final_answer}"`,
    );
    if (judgeResult.judgeReason) {
      console.log(`        reason: ${judgeResult.judgeReason}`);
    }
    if (agentResult.error) {
      console.log(`        error : ${agentResult.error}`);
    }
  }

  // ── Assertion ──
  console.log('');
  if (passRate >= MIN_PASS_RATE) {
    console.log(
      `\x1b[32mSmoke PASSED\x1b[0m — ${passed}/${total} ≥ ${(MIN_PASS_RATE * 100).toFixed(0)}% required.\n`,
    );
  } else {
    console.error(
      `\x1b[31mSmoke FAILED\x1b[0m — ${passed}/${total} < ${(MIN_PASS_RATE * 100).toFixed(0)}% required.\n`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && (
  process.argv[1].endsWith('gaia-e2e-smoke.ts') ||
  process.argv[1].endsWith('gaia-e2e-smoke.js')
);
if (isMain) {
  runE2ESmoke().catch((err) => {
    console.error('E2E smoke failed:', err);
    process.exit(1);
  });
}

export { runE2ESmoke };
