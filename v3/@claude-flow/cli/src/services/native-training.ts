/**
 * Native training via @ruvector/ruvllm's TrainingPipeline (#2549 follow-up).
 *
 * `neural train` historically trained only on the RuVector WASM path
 * (MicroLoRA + InfoNCE) and its "checkpoint" was a freshly-constructed
 * adapter's weights — the native TrainingPipeline (real epochs, loss
 * history, early stopping, EWC registration, disk checkpoints since
 * ruvllm 2.5.7) was never exercised. This service routes the LoRA
 * training leg through it.
 *
 * Batch formulation: pattern-alignment pairs — input = embedding[i],
 * target = embedding[i+1 mod n], quality 1.0 — the MSE analogue of the
 * WASM path's anchor→positive contrastive objective (adjacent training
 * items belong to the same pattern family by construction).
 *
 * Graceful: returns null when @ruvector/ruvllm is absent or anything
 * throws — callers fall back to the WASM path.
 */

import { createRequire } from 'module';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

export interface NativeTrainingResult {
  epochs: number;
  steps: number;
  finalLoss: number;
  bestValLoss: number | null;
  durationMs: number;
  earlyStopped: boolean;
  checkpointPath?: string;
  checkpointBytes?: number;
  /** True when training resumed from a --resume checkpoint. */
  resumed?: boolean;
  /**
   * How the resume happened: 'resumeFrom' (ruvllm >=2.6.0 — restores epoch
   * position + optimizer state) or 'loadCheckpoint' (2.5.7 fallback —
   * weights only, training restarts from epoch 0).
   */
  resumeMode?: 'resumeFrom' | 'loadCheckpoint';
}

export interface NativeTrainingOptions {
  embeddings: Float32Array[];
  epochs: number;
  batchSize: number;
  learningRate: number;
  dim: number;
  /**
   * Validation holdout fraction (0..1). >0 makes the pipeline report
   * bestValLoss + early-stopping; 0 (or omitted) disables validation.
   * validationSplit exists in ruvllm 2.5.7 — no version gate needed.
   */
  validationSplit?: number;
  /**
   * Resume weights (and, on >=2.6.0, epoch position) from this checkpoint
   * BEFORE training. A missing/invalid path throws ResumeFailedError — an
   * explicit --resume must fail loudly, never silently fresh-train.
   */
  resumeFrom?: string;
  /** When set, the TRAINED pipeline checkpoints here (ruvllm >=2.5.7). */
  checkpointPath?: string;
}

/**
 * Thrown when an explicit --resume checkpoint cannot be found or loaded.
 * Distinct from the generic "native unavailable → null" degradation so the
 * caller can surface a loud, exit-1 failure rather than fresh training.
 */
export class ResumeFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeFailedError';
  }
}

export function nativeTrainingAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve('@ruvector/ruvllm');
    return true;
  } catch {
    return false;
  }
}

export async function runNativeTraining(
  opts: NativeTrainingOptions,
): Promise<NativeTrainingResult | null> {
  const { embeddings, epochs, batchSize, learningRate, dim, validationSplit, resumeFrom, checkpointPath } = opts;
  if (embeddings.length < 2) return null;

  try {
    const req = createRequire(import.meta.url);
    const ruvllm = req('@ruvector/ruvllm');
    const pipelineConfig: Record<string, unknown> = {
      learningRate,
      batchSize,
      epochs,
      inputDim: dim,
      outputDim: dim,
    };
    // 0 (or omitted) disables validation; only pass a real holdout through.
    if (typeof validationSplit === 'number' && validationSplit > 0) {
      pipelineConfig.validationSplit = validationSplit;
    }
    const pipeline = new ruvllm.TrainingPipeline(pipelineConfig);

    // Resume BEFORE training. Prefer resumeFrom() (2.6.0 — epoch position +
    // optimizer state); fall back to loadCheckpoint() (2.5.7 — weights only).
    // Any failure with an explicit --resume is loud (ResumeFailedError),
    // never silent fresh training.
    let resumed = false;
    let resumeMode: 'resumeFrom' | 'loadCheckpoint' | undefined;
    if (resumeFrom) {
      if (!existsSync(resumeFrom)) {
        throw new ResumeFailedError(`--resume checkpoint not found: ${resumeFrom}`);
      }
      try {
        if (typeof pipeline.resumeFrom === 'function') {
          pipeline.resumeFrom(resumeFrom);
          resumeMode = 'resumeFrom';
        } else {
          const ok = pipeline.loadCheckpoint(resumeFrom);
          if (ok === false) throw new Error('loadCheckpoint returned false');
          resumeMode = 'loadCheckpoint';
        }
        resumed = true;
      } catch (e) {
        if (e instanceof ResumeFailedError) throw e;
        throw new ResumeFailedError(
          `--resume failed to load checkpoint ${resumeFrom}: ${(e as Error).message}`,
        );
      }
    }

    // Pattern-alignment pairs, chunked into pipeline batches.
    const inputs: number[][] = [];
    const targets: number[][] = [];
    const qualities: number[] = [];
    for (let i = 0; i < embeddings.length; i++) {
      inputs.push(Array.from(embeddings[i]));
      targets.push(Array.from(embeddings[(i + 1) % embeddings.length]));
      qualities.push(1.0);
    }
    for (let i = 0; i < inputs.length; i += batchSize) {
      pipeline.addBatch(
        inputs.slice(i, i + batchSize),
        targets.slice(i, i + batchSize),
        qualities.slice(i, i + batchSize),
      );
    }

    const r = pipeline.train();
    // When validation is disabled the pipeline reports Infinity for
    // bestValLoss — normalize any non-finite value to null so downstream
    // "bestValLoss !== null ⇒ validation ran" holds for the results table.
    const bestValLoss = typeof r.bestValLoss === 'number' && Number.isFinite(r.bestValLoss)
      ? r.bestValLoss
      : null;
    const result: NativeTrainingResult = {
      epochs: r.epochs,
      steps: r.steps,
      finalLoss: r.finalLoss,
      bestValLoss,
      durationMs: r.durationMs,
      earlyStopped: !!r.earlyStopped,
      resumed,
      resumeMode,
    };

    if (checkpointPath) {
      try {
        mkdirSync(dirname(checkpointPath), { recursive: true });
        const saved = pipeline.saveCheckpoint(checkpointPath);
        // <2.5.7 returns undefined and writes nothing — verify on disk.
        if (existsSync(checkpointPath)) {
          result.checkpointPath = checkpointPath;
          result.checkpointBytes = saved?.bytes;
        }
      } catch { /* checkpoint is best-effort; training result stands */ }
    }

    return result;
  } catch (err) {
    // An explicit --resume failure must propagate as a loud error; every
    // other failure degrades to null so callers fall back to the WASM path.
    if (err instanceof ResumeFailedError) throw err;
    return null;
  }
}
