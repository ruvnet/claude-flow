/**
 * V3 CLI gaia-bench Command — ADR-133-PR8 + ADR-135 Tracks A/B/D/E/Q + ADR-136 Track Q
 *
 * Runs GAIA benchmark questions through the claude-flow agent loop and
 * reports pass-rate, cost, and per-question results.
 *
 * Contract (matches gaia-benchmark.yml workflow expectations):
 *   node bin/cli.js gaia-bench run \
 *     --level <1|2|3> \
 *     --limit <N> \
 *     --models <csv> \
 *     --output json
 *
 * JSON output shape:
 *   {
 *     level: number,
 *     model: string,
 *     summary: { total, passed, passRate, estCostUsd, hardnessDist? },
 *     results: [{ task_id, question, model, correct, answer, expected_output, error }]
 *   }
 *
 * Integration (iter 39 — ADR-135):
 *   Wires standalone track modules into the CLI so they are usable end-to-end.
 *   - Track A  (--voting-attempts N)   : multi-attempt self-consistency voting
 *   - Track B  (--planning-interval N) : periodic planning checkpoints in gaia-agent
 *   - Track D  (--enable-critic)       : adversarial critic review after agent answer
 *   - Track E  (--decompose)           : question decomposition for multi-step Qs
 *   - Track Q  (--hardness-routing)    : hardness-based compute allocation
 *
 * Precedence when flags combine:
 *   --hardness-routing overrides --max-turns and --voting-attempts per question.
 *   --voting-attempts > 1 takes precedence over --enable-critic (cost containment).
 *   --decompose works independently; sub-question answers feed into voting/critic/plain.
 *
 * Refs: ADR-133, ADR-135, ADR-136, #2165, iter 28/34/36/37/39
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

// ---------------------------------------------------------------------------
// Pricing constants for cost estimation
// ---------------------------------------------------------------------------

const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-haiku-4-5': { inputPerM: 0.25, outputPerM: 1.25 },
  'claude-haiku-3': { inputPerM: 0.25, outputPerM: 1.25 },
  'claude-sonnet-4-5': { inputPerM: 3.0, outputPerM: 15.0 },
  'claude-sonnet-4-6': { inputPerM: 3.0, outputPerM: 15.0 },
  'claude-opus-4-5': { inputPerM: 15.0, outputPerM: 75.0 },
};

function estimateCost(
  model: string,
  totalInputTokens: number,
  totalOutputTokens: number,
): number {
  const pricing = MODEL_PRICING[model] ?? { inputPerM: 3.0, outputPerM: 15.0 };
  return (
    (totalInputTokens / 1_000_000) * pricing.inputPerM +
    (totalOutputTokens / 1_000_000) * pricing.outputPerM
  );
}

// ---------------------------------------------------------------------------
// Result types (matches PR7 workflow contract)
// ---------------------------------------------------------------------------

interface QuestionResult {
  task_id: string;
  question: string;
  model: string;
  correct: boolean;
  answer: string | null;
  expected_output: string;
  error?: string;
  turns?: number;
  wallMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** ADR-136 Track Q: predicted difficulty class when --hardness-routing is enabled. */
  hardnessDifficulty?: string;
  /** ADR-136 Track Q: classifier confidence (0-1). */
  hardnessConfidence?: number;
  /** ADR-135 Track E: set to true when the question was decomposed. */
  decomposed?: boolean;
}

interface HardnessDist {
  easy: number;
  medium: number;
  hard: number;
}

interface BenchRunOutput {
  level: number;
  model: string;
  summary: {
    total: number;
    passed: number;
    passRate: number;
    estCostUsd: number;
    meanTurns: number;
    meanWallMs: number;
    /** ADR-136 Track Q: distribution of predicted difficulty classes (present when --hardness-routing). */
    hardnessDist?: HardnessDist;
  };
  results: QuestionResult[];
}

// ---------------------------------------------------------------------------
// run subcommand
// ---------------------------------------------------------------------------

const runCommand: Command = {
  name: 'run',
  description: 'Run GAIA benchmark questions against one or more models',
  options: [
    {
      name: 'level',
      short: 'l',
      type: 'number',
      description: 'GAIA difficulty level: 1 (easiest), 2, or 3',
      default: '1',
    },
    {
      name: 'limit',
      short: 'n',
      type: 'number',
      description: 'Maximum number of questions to run (default: all)',
    },
    {
      name: 'models',
      short: 'm',
      type: 'string',
      description: 'Comma-separated list of model IDs to test',
      default: 'claude-haiku-4-5',
    },
    {
      name: 'output',
      short: 'o',
      type: 'string',
      description: 'Output format: text or json',
      default: 'text',
    },
    {
      name: 'concurrency',
      short: 'c',
      type: 'number',
      description: 'Number of questions to run in parallel (default: 3)',
      default: '3',
    },
    {
      name: 'smoke-only',
      type: 'boolean',
      description: 'Use the 5-question smoke fixture instead of real HF dataset (no HF token required)',
      default: 'false',
    },
    {
      name: 'max-turns',
      type: 'number',
      description: 'Maximum agent turns per question (default: 12). Overridden per-question when --hardness-routing is enabled.',
      default: '12',
    },
    {
      name: 'judge-model',
      type: 'string',
      description: 'Model for LLM-as-judge scoring (default: claude-sonnet-4-6)',
      default: 'claude-sonnet-4-6',
    },
    {
      name: 'voting-attempts',
      type: 'number',
      description: 'Number of parallel attempts for majority-vote self-consistency (default: 1 = no voting). N>1 costs Nx per question. Recommended: 3 (+5-10pp L1 lift per ADR-135 Track A). Overridden per-question when --hardness-routing is enabled.',
      default: '1',
    },
    {
      name: 'hardness-routing',
      type: 'boolean',
      description: 'ADR-136 Track Q: enable hardness-based compute routing. Trains a linear classifier from historical result JSONs and allocates: easy=Haiku/4t/1-attempt, medium=Sonnet/8t/1-attempt, hard=Sonnet/12t/3-vote. Overrides --max-turns and --voting-attempts per question.',
      default: 'false',
    },
    {
      name: 'hardness-verbose',
      type: 'boolean',
      description: 'ADR-136 Track Q: log hardness prediction for each question (requires --hardness-routing).',
      default: 'false',
    },
    {
      name: 'enable-critic',
      type: 'boolean',
      description: 'ADR-135 Track D: enable adversarial critic review after agent answer (+3-5pp L1 lift expected). Skipped when --voting-attempts > 1 (cost containment — voting takes precedence).',
      default: 'false',
    },
    {
      name: 'decompose',
      type: 'boolean',
      description: 'ADR-135 Track E: decompose complex questions into 1-5 sub-questions before solving (+5-10pp on multi-step Qs, ~30-40% of L1 set). Each sub-question runs through voting/critic/plain independently; sub-answers are synthesized before judging.',
      default: 'false',
    },
    {
      name: 'planning-interval',
      type: 'number',
      description: 'ADR-135 Track B: inject a planning checkpoint every N tool_use turns (default: 4, set 0 to disable). Based on smolagents finding — prevents tunnel-vision on bad strategies.',
      default: '4',
    },
    {
      name: 'enable-convergence',
      type: 'boolean',
      description: 'iter 62: enable convergence layer — forces a final commit when max_turns, loop, or token_overflow is detected (default: true). Disabling is for ablation only.',
      default: 'true',
    },
  ],
  examples: [
    {
      command: 'claude-flow gaia-bench run --level 1 --limit 10 --models claude-haiku-4-5 --output json',
      description: 'Run 10 Level-1 questions with Haiku, JSON output',
    },
    {
      command: 'claude-flow gaia-bench run --level 1 --limit 10 --models claude-haiku-4-5,claude-sonnet-4-6',
      description: 'Compare Haiku vs Sonnet on 10 Level-1 questions',
    },
    {
      command: 'claude-flow gaia-bench run --smoke-only --output json',
      description: 'Quick smoke test (5 fixture questions, no HF token needed)',
    },
    {
      command: 'claude-flow gaia-bench run --level 1 --limit 20 --models claude-haiku-4-5 --voting-attempts 3 --output json',
      description: 'Self-consistency voting: run each question 3x, majority-vote (ADR-135 Track A, +5-10pp expected)',
    },
    {
      command: 'claude-flow gaia-bench run --level 1 --models claude-sonnet-4-6 --hardness-routing --output json',
      description: 'ADR-136 Track Q: auto-route questions to Haiku/Sonnet based on predicted difficulty',
    },
    {
      command: 'claude-flow gaia-bench run --level 1 --models claude-sonnet-4-6 --enable-critic --output json',
      description: 'ADR-135 Track D: adversarial critic reviews each answer before submission (+3-5pp expected)',
    },
    {
      command: 'claude-flow gaia-bench run --level 1 --models claude-sonnet-4-6 --decompose --output json',
      description: 'ADR-135 Track E: decompose complex questions into sub-questions (+5-10pp on multi-step Qs)',
    },
    {
      command: 'claude-flow gaia-bench run --level 1 --models claude-sonnet-4-6 --hardness-routing --enable-critic --planning-interval 4',
      description: 'Recommended config: hardness routing + critic + planning checkpoints (~$2/run est.)',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const level = parseInt(String(ctx.flags.level ?? '1'), 10) as 1 | 2 | 3;
    const limit = ctx.flags.limit ? parseInt(String(ctx.flags.limit), 10) : undefined;
    const modelsRaw = String(ctx.flags.models ?? 'claude-haiku-4-5');
    const models = modelsRaw.split(',').map((m) => m.trim()).filter(Boolean);
    const outputFormat = String(ctx.flags.output ?? 'text');
    const concurrency = parseInt(String(ctx.flags.concurrency ?? '3'), 10);
    // Parser converts --smoke-only to camelCase "smokeOnly"
    const smokeOnly = ctx.flags['smokeOnly'] === true || ctx.flags['smokeOnly'] === 'true' ||
      ctx.flags['smoke-only'] === true || ctx.flags['smoke-only'] === 'true';
    // Parser converts --max-turns to maxTurns, --judge-model to judgeModel, --voting-attempts to votingAttempts
    // NOTE: default must match DEFAULT_MAX_TURNS in benchmarks/gaia-agent.ts
    const maxTurns = parseInt(String(ctx.flags['maxTurns'] ?? ctx.flags['max-turns'] ?? '12'), 10);
    const judgeModel = String(ctx.flags['judgeModel'] ?? ctx.flags['judge-model'] ?? 'claude-sonnet-4-6');
    // votingAttempts=1 means no voting (backward-compat default).  N>1 routes through runGaiaAgentWithVoting.
    const votingAttempts = parseInt(String(ctx.flags['votingAttempts'] ?? ctx.flags['voting-attempts'] ?? '1'), 10);
    const useVoting = votingAttempts > 1;
    // ADR-136 Track Q: hardness-based routing.
    const hardnessRouting = ctx.flags['hardnessRouting'] === true || ctx.flags['hardnessRouting'] === 'true' ||
      ctx.flags['hardness-routing'] === true || ctx.flags['hardness-routing'] === 'true';
    const hardnessVerbose = ctx.flags['hardnessVerbose'] === true || ctx.flags['hardnessVerbose'] === 'true' ||
      ctx.flags['hardness-verbose'] === true || ctx.flags['hardness-verbose'] === 'true';
    // ADR-135 Track D: adversarial critic.
    // Voting takes precedence over critic when both are enabled (cost containment).
    const enableCritic = !useVoting && (
      ctx.flags['enableCritic'] === true || ctx.flags['enableCritic'] === 'true' ||
      ctx.flags['enable-critic'] === true || ctx.flags['enable-critic'] === 'true'
    );
    // ADR-135 Track E: question decomposition.
    const enableDecompose = ctx.flags['decompose'] === true || ctx.flags['decompose'] === 'true';
    // ADR-135 Track B: planning interval (passed through to runGaiaAgent via agentOpts).
    const planningInterval = parseInt(String(ctx.flags['planningInterval'] ?? ctx.flags['planning-interval'] ?? '4'), 10);
    // iter 62: convergence layer — default ON, disable with --no-enable-convergence.
    // Note: boolean false is falsy, so we check for explicit false values only.
    const enableConvergence = !(
      ctx.flags['enableConvergence'] === false || ctx.flags['enableConvergence'] === 'false' ||
      ctx.flags['enable-convergence'] === false || ctx.flags['enable-convergence'] === 'false'
    );

    // Dynamic imports to avoid loading at startup.
    // NOTE: gaia-*.ts sources are pre-compiled under dist/src/benchmarks/ only --
    // they are NOT in the src/ include glob so TypeScript cannot resolve them
    // statically.  We resolve the absolute path from import.meta.url at runtime
    // and cast to `any` to bypass the static-analysis check.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const benchmarksBase = new URL('../benchmarks/', import.meta.url).href;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { loadGaia } = (await import(benchmarksBase + 'gaia-loader.js')) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { runGaiaAgent } = (await import(benchmarksBase + 'gaia-agent.js')) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { judgeAnswer } = (await import(benchmarksBase + 'gaia-judge.js')) as any;
    // ADR-135 Track A: voting wrapper (imported when --voting-attempts > 1 OR hardness routing triggers it).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { runGaiaAgentWithVoting } = (useVoting || hardnessRouting)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ((await import(benchmarksBase + 'gaia-voting.js')) as any)
      : { runGaiaAgentWithVoting: null };
    // ADR-135 Track D: critic wrapper (only imported when --enable-critic and no voting).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { runGaiaAgentWithCritic } = enableCritic
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ((await import(benchmarksBase + 'gaia-critic.js')) as any)
      : { runGaiaAgentWithCritic: null };
    // ADR-135 Track E: decomposer (only imported when --decompose).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let decomposeQuestion: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let synthesizeFromSubAnswers: any = null;
    if (enableDecompose) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const decomposerMod = (await import(benchmarksBase + 'gaia-decomposer.js')) as any;
      decomposeQuestion = decomposerMod.decomposeQuestion;
      synthesizeFromSubAnswers = decomposerMod.synthesizeFromSubAnswers;
    }

    // ADR-136 Track Q: hardness predictor.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let hardnessPredictor: any = null;
    if (hardnessRouting) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { HardnessPredictor } = (await import(benchmarksBase + 'gaia-hardness/predictor.js')) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { loadTrainingData } = (await import(benchmarksBase + 'gaia-hardness/train-data-loader.js')) as any;
      hardnessPredictor = new HardnessPredictor({ conservativeMode: true });
      const trainingData = loadTrainingData([], hardnessVerbose);
      if (trainingData.length >= 10) {
        hardnessPredictor.train(trainingData);
      }
      // If < 10 examples: cold-start (medium for all) -- documented fallback.
    }

    // Only print to stderr so stdout stays clean for JSON consumers
    const log = (msg: string) => {
      if (outputFormat !== 'json') {
        output.writeln(msg);
      } else {
        process.stderr.write(msg + '\n');
      }
    };

    log('');
    log(output.bold(`GAIA Benchmark -- Level ${level}${smokeOnly ? ' [SMOKE]' : ''}`));
    log(output.dim('-'.repeat(60)));
    log(`Models  : ${models.join(', ')}`);
    log(`Limit   : ${limit ?? 'all'}`);
    log(`Concurrency: ${concurrency}`);
    if (useVoting && !hardnessRouting) {
      log(`Voting  : ${votingAttempts}x self-consistency (ADR-135 Track A) -- cost ~${votingAttempts}x per question`);
    }
    if (enableCritic) {
      log(`Critic  : ADR-135 Track D enabled -- adversarial review after each answer`);
    }
    if (enableDecompose) {
      log(`Decompose: ADR-135 Track E enabled -- multi-step questions will be split into sub-questions`);
    }
    if (planningInterval > 0) {
      log(`Planning: ADR-135 Track B -- checkpoint every ${planningInterval} turns`);
    }
    if (hardnessRouting) {
      const trainedStatus = hardnessPredictor?.isTrained
        ? 'trained (classifier active)'
        : 'cold-start (no training data -> all medium)';
      log(`Hardness: ADR-136 Track Q enabled -- ${trainedStatus}`);
      log('          easy=Haiku/4t/1-attempt  medium=Sonnet/8t/1-attempt  hard=Sonnet/12t/3-vote');
    }
    log('');

    // Load questions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let questions: any[];
    try {
      questions = await loadGaia({ level, limit, smokeOnly });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (outputFormat === 'json') {
        process.stdout.write(JSON.stringify({ error: `Failed to load GAIA dataset: ${msg}` }, null, 2) + '\n');
      } else {
        output.writeln(output.error(`Failed to load GAIA dataset: ${msg}`));
      }
      return { success: false };
    }

    log(`Loaded  : ${questions.length} questions`);
    log('');

    const allModelOutputs: BenchRunOutput[] = [];

    // Resolve the API key once (shared across all per-question agent calls).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { resolveAnthropicApiKey } = (await import(benchmarksBase + 'gaia-agent.js')) as any;
    const apiKey: string = resolveAnthropicApiKey();

    for (const model of models) {
      log(output.bold(`Running model: ${model}`));
      log(output.dim('-'.repeat(40)));

      const results: QuestionResult[] = [];
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalTurns = 0;
      let totalWallMs = 0;

      // ADR-136 Track Q: hardness distribution tracking.
      const hardnessDist: HardnessDist = { easy: 0, medium: 0, hard: 0 };

      // Process questions in batches of `concurrency`
      for (let i = 0; i < questions.length; i += concurrency) {
        const batch = questions.slice(i, Math.min(i + concurrency, questions.length));

        const batchResults = await Promise.all(
          batch.map(async (q) => {
            const qIdx = i + batch.indexOf(q) + 1;

            // ADR-136 Track Q: predict hardness and set per-question compute budget.
            let effectiveModel = model;
            let effectiveMaxTurns = maxTurns;
            let effectiveVotingAttempts = votingAttempts;
            let predictedDifficulty: string | undefined;
            let predictedConfidence: number | undefined;

            if (hardnessRouting && hardnessPredictor) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const prediction: any = hardnessPredictor.predict(q);
              predictedDifficulty = prediction.difficulty as string;
              predictedConfidence = prediction.confidence as number;
              hardnessDist[predictedDifficulty as keyof HardnessDist]++;

              // Override compute budget from hardness policy.
              const budget = prediction.budget;
              effectiveModel = budget.model === 'haiku'
                ? 'claude-haiku-4-5'
                : (model.includes('sonnet') ? model : 'claude-sonnet-4-6');
              effectiveMaxTurns = budget.maxTurns;
              effectiveVotingAttempts = budget.votingAttempts;

              if (hardnessVerbose) {
                log(
                  `  [${qIdx}/${questions.length}] ${q.task_id} hardness=${predictedDifficulty}` +
                  ` conf=${((predictedConfidence ?? 0) * 100).toFixed(0)}%` +
                  ` -> ${effectiveModel} / ${effectiveMaxTurns}t / ${effectiveVotingAttempts}-attempt`,
                );
              } else {
                log(`  [${qIdx}/${questions.length}] ${q.task_id} [${predictedDifficulty}] -- ${String(q.question).slice(0, 50)}...`);
              }
            } else {
              log(`  [${qIdx}/${questions.length}] ${q.task_id} -- ${String(q.question).slice(0, 60)}...`);
            }

            const useThisVoting = effectiveVotingAttempts > 1;
            // Critic is suppressed when voting is active (same precedence rule as the global flag).
            const useThisCritic = enableCritic && !useThisVoting && runGaiaAgentWithCritic;

            // Shared agent options (Track B planning interval + iter 62 convergence wired here).
            const agentOpts = {
              model: effectiveModel,
              maxTurns: effectiveMaxTurns,
              planningInterval,
              apiKey,
              enableConvergence,
            };

            // ADR-135 Track E: decompose the question if enabled.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let decomposedResult: any = null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let questionsToSolve: any[] = [q];
            if (enableDecompose && decomposeQuestion) {
              try {
                decomposedResult = await decomposeQuestion(q.question, { apiKey });
                if (decomposedResult?.decomposed === true && Array.isArray(decomposedResult.subQuestions) && decomposedResult.subQuestions.length > 1) {
                  questionsToSolve = decomposedResult.subQuestions.map((sq: string) => ({ ...q, question: sq }));
                  log(`    decomposed into ${questionsToSolve.length} sub-questions`);
                }
              } catch {
                // Graceful fallback: treat as atomic question.
                decomposedResult = null;
              }
            }

            // Solve each (sub-)question.
            const subAnswers: string[] = [];
            let lastAgentResult: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
            let solveError: string | undefined;

            for (const sq of questionsToSolve) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              let agentResult: any;
              try {
                if (useThisVoting && runGaiaAgentWithVoting) {
                  // ADR-135 Track A: multi-attempt majority voting.
                  agentResult = await runGaiaAgentWithVoting(sq, {
                    ...agentOpts,
                    attempts: effectiveVotingAttempts,
                  });
                  const vr = agentResult as { votingMethod?: string; agreementCount?: number };
                  log(
                    `    vote-method=${vr.votingMethod ?? '?'}  agreement=${vr.agreementCount ?? '?'}/${effectiveVotingAttempts}`,
                  );
                } else if (useThisCritic) {
                  // ADR-135 Track D: critic-wrapped agent.
                  agentResult = await runGaiaAgentWithCritic(sq, {
                    ...agentOpts,
                    enableCritic: true,
                  });
                  const cr = agentResult as { criticVerdict?: string };
                  log(`    critic-verdict=${cr.criticVerdict ?? '?'}`);
                } else {
                  agentResult = await runGaiaAgent(sq, agentOpts);
                }
              } catch (err) {
                solveError = err instanceof Error ? err.message : String(err);
                log(`    ERROR: ${solveError}`);
                break;
              }
              subAnswers.push(agentResult.finalAnswer ?? '');
              lastAgentResult = agentResult;
            }

            if (solveError || !lastAgentResult) {
              return {
                task_id: q.task_id,
                question: q.question,
                model: effectiveModel,
                correct: false,
                answer: null,
                expected_output: q.final_answer,
                error: solveError ?? 'no result',
                hardnessDifficulty: predictedDifficulty,
                hardnessConfidence: predictedConfidence,
                decomposed: decomposedResult?.decomposed === true,
              } as QuestionResult;
            }

            // ADR-135 Track E: synthesize sub-answers if decomposed.
            let finalAnswer: string | null = subAnswers[0] ?? null;
            if (decomposedResult?.decomposed === true && questionsToSolve.length > 1 && synthesizeFromSubAnswers) {
              try {
                const synth = await synthesizeFromSubAnswers(decomposedResult, subAnswers, { apiKey });
                finalAnswer = synth.finalAnswer ?? finalAnswer;
              } catch {
                // Graceful fallback: use first sub-answer.
              }
            }

            // Judge the answer
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let judgeResult: any;
            try {
              judgeResult = await judgeAnswer(
                { id: q.task_id, expected: q.final_answer, questionText: q.question },
                finalAnswer,
                { judgeModel },
              );
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              judgeResult = {
                questionId: q.task_id,
                passed: false,
                scoringPath: 'exact-match' as const,
                candidateAnswer: finalAnswer ?? '',
                groundTruth: q.final_answer,
                judgeReason: `Judge error: ${errorMsg}`,
              };
            }

            const verdict = judgeResult.passed ? output.success('PASS') : output.error('FAIL');
            log(
              `    ${verdict}  answer="${finalAnswer ?? 'null'}"  expected="${q.final_answer}"` +
              `  turns=${lastAgentResult.turns}  ${(lastAgentResult.wallMs / 1000).toFixed(1)}s`,
            );

            return {
              task_id: q.task_id,
              question: q.question,
              model: effectiveModel,
              correct: judgeResult.passed,
              answer: finalAnswer,
              expected_output: q.final_answer,
              error: lastAgentResult.error,
              turns: lastAgentResult.turns,
              wallMs: lastAgentResult.wallMs,
              inputTokens: lastAgentResult.totalInputTokens,
              outputTokens: lastAgentResult.totalOutputTokens,
              hardnessDifficulty: predictedDifficulty,
              hardnessConfidence: predictedConfidence,
              decomposed: decomposedResult?.decomposed === true,
            } as QuestionResult;
          }),
        );

        for (const r of batchResults) {
          results.push(r);
          totalInputTokens += r.inputTokens ?? 0;
          totalOutputTokens += r.outputTokens ?? 0;
          totalTurns += r.turns ?? 0;
          totalWallMs += r.wallMs ?? 0;
        }
      }

      const passed = results.filter((r) => r.correct).length;
      const total = results.length;
      const passRate = total > 0 ? passed / total : 0;
      const estCostUsd = estimateCost(model, totalInputTokens, totalOutputTokens);

      const modelOutput: BenchRunOutput = {
        level,
        model,
        summary: {
          total,
          passed,
          passRate,
          estCostUsd,
          meanTurns: total > 0 ? totalTurns / total : 0,
          meanWallMs: total > 0 ? totalWallMs / total : 0,
          ...(hardnessRouting ? { hardnessDist } : {}),
        },
        results,
      };
      allModelOutputs.push(modelOutput);

      log('');
      log(output.bold(`Results for ${model}:`));
      log(`  Pass rate : ${passed}/${total} (${(passRate * 100).toFixed(1)}%)`);
      log(`  Est. cost : $${estCostUsd.toFixed(4)}`);
      log(`  Mean turns: ${modelOutput.summary.meanTurns.toFixed(1)}`);
      log(`  Mean time : ${(modelOutput.summary.meanWallMs / 1000).toFixed(1)}s per question`);
      if (hardnessRouting) {
        log(`  Hardness  : easy=${hardnessDist.easy} medium=${hardnessDist.medium} hard=${hardnessDist.hard}`);
      }
      log('');
    }

    // Output results
    if (outputFormat === 'json') {
      if (allModelOutputs.length === 1) {
        // Single model: emit flat object (matches workflow contract)
        process.stdout.write(JSON.stringify(allModelOutputs[0], null, 2) + '\n');
      } else {
        // Multiple models: emit array
        process.stdout.write(JSON.stringify(allModelOutputs, null, 2) + '\n');
      }
    } else {
      // Print summary table
      output.writeln(output.bold('Summary'));
      output.writeln(output.dim('-'.repeat(60)));
      for (const m of allModelOutputs) {
        const pct = (m.summary.passRate * 100).toFixed(1);
        output.writeln(
          `${m.model.padEnd(28)} ${m.summary.passed}/${m.summary.total} (${pct}%)` +
          `  cost=$${m.summary.estCostUsd.toFixed(4)}` +
          `  turns=${m.summary.meanTurns.toFixed(1)}`,
        );
      }
    }

    return { success: true };
  },
};

// ---------------------------------------------------------------------------
// Main gaia-bench command
// ---------------------------------------------------------------------------

export const gaiaBenchCommand: Command = {
  name: 'gaia-bench',
  description: 'GAIA benchmark harness -- measure agent pass-rate on real GAIA questions',
  subcommands: [runCommand],
  examples: [
    {
      command: 'claude-flow gaia-bench run --level 1 --limit 10 --models claude-haiku-4-5 --output json',
      description: 'Mini Level-1 run with Haiku, JSON output',
    },
    {
      command: 'claude-flow gaia-bench run --smoke-only',
      description: 'Quick smoke test with built-in fixture (no HF token)',
    },
    {
      command: 'claude-flow gaia-bench run --level 1 --models claude-sonnet-4-6 --hardness-routing --output json',
      description: 'ADR-136 Track Q: tiered compute routing by predicted question difficulty',
    },
    {
      command: 'claude-flow gaia-bench run --level 1 --models claude-sonnet-4-6 --hardness-routing --enable-critic --planning-interval 4',
      description: 'Recommended config: all tracks active, ~$2/run estimated',
    },
  ],
};

export default gaiaBenchCommand;
