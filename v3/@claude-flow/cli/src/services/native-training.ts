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
}

export interface NativeTrainingOptions {
  embeddings: Float32Array[];
  epochs: number;
  batchSize: number;
  learningRate: number;
  dim: number;
  /** When set, the TRAINED pipeline checkpoints here (ruvllm >=2.5.7). */
  checkpointPath?: string;
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
  const { embeddings, epochs, batchSize, learningRate, dim, checkpointPath } = opts;
  if (embeddings.length < 2) return null;

  try {
    const req = createRequire(import.meta.url);
    const ruvllm = req('@ruvector/ruvllm');
    const pipeline = new ruvllm.TrainingPipeline({
      learningRate,
      batchSize,
      epochs,
      inputDim: dim,
      outputDim: dim,
    });

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
    const result: NativeTrainingResult = {
      epochs: r.epochs,
      steps: r.steps,
      finalLoss: r.finalLoss,
      bestValLoss: r.bestValLoss ?? null,
      durationMs: r.durationMs,
      earlyStopped: !!r.earlyStopped,
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
  } catch {
    return null;
  }
}
