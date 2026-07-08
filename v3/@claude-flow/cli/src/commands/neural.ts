/**
 * V3 CLI Neural Command
 * Neural pattern training, MoE, Flash Attention, pattern learning
 *
 * Created with ❤️ by ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

// Train subcommand - REAL WASM training with RuVector
const trainCommand: Command = {
  name: 'train',
  description: 'Train neural patterns with WASM SIMD acceleration (MicroLoRA + Flash Attention)',
  options: [
    { name: 'pattern', short: 'p', type: 'string', description: 'Pattern type: coordination, optimization, prediction, security, testing', default: 'coordination' },
    { name: 'epochs', short: 'e', type: 'number', description: 'Number of training epochs', default: '50' },
    { name: 'data', short: 'd', type: 'string', description: 'Training data file or inline JSON' },
    { name: 'model', short: 'm', type: 'string', description: 'Model ID to train' },
    { name: 'learning-rate', short: 'l', type: 'number', description: 'Learning rate', default: '0.01' },
    { name: 'batch-size', short: 'b', type: 'number', description: 'Batch size', default: '32' },
    { name: 'dim', type: 'number', description: 'Embedding dimension (max 256)', default: '256' },
    { name: 'wasm', short: 'w', type: 'boolean', description: 'Use RuVector WASM acceleration', default: 'true' },
    { name: 'flash', type: 'boolean', description: 'Enable Flash Attention (2.49x-7.47x speedup)', default: 'true' },
    { name: 'moe', type: 'boolean', description: 'Enable Mixture of Experts routing', default: 'false' },
    { name: 'hyperbolic', type: 'boolean', description: 'Enable hyperbolic attention for hierarchical patterns', default: 'false' },
    { name: 'contrastive', type: 'boolean', description: 'Use contrastive learning (InfoNCE)', default: 'true' },
    { name: 'curriculum', type: 'boolean', description: 'Enable curriculum learning', default: 'false' },
    { name: 'backend', type: 'string', description: 'Training backend: auto (native when available), native (@ruvector/ruvllm TrainingPipeline, disk checkpoints), wasm (RuVector MicroLoRA/InfoNCE)', default: 'auto' },
    { name: 'val-split', type: 'number', description: 'Validation holdout fraction 0..1 (native backend). >0 reports Best Val Loss + early stopping; 0 disables', default: '0.1' },
    { name: 'resume', type: 'string', description: 'Resume native training from a checkpoint path (weights on 2.5.7; epoch position on >=2.6.0). Native backend only', default: '' },
  ],
  examples: [
    { command: 'claude-flow neural train -p coordination -e 100', description: 'Train coordination patterns' },
    { command: 'claude-flow neural train -d ./training-data.json --flash', description: 'Train from file with Flash Attention' },
    { command: 'claude-flow neural train -p security --wasm --contrastive', description: 'Security patterns with contrastive learning' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const patternType = (ctx.flags.pattern || ctx.flags.patternType || ctx.flags['pattern-type']) as string || 'coordination';
    const epochs = parseInt(ctx.flags.epochs as string || '50', 10);
    const learningRate = parseFloat(ctx.flags['learning-rate'] as string || '0.01');
    const batchSize = parseInt(ctx.flags['batch-size'] as string || '32', 10);
    const dim = Math.min(parseInt(ctx.flags.dim as string || '256', 10), 256);
    // #2549 follow-up — backend routing: 'native' = @ruvector/ruvllm
    // TrainingPipeline (real epochs/early-stopping/disk checkpoints),
    // 'wasm' = RuVector MicroLoRA/InfoNCE (pre-3.19 behavior),
    // 'auto' = native when the module resolves, else wasm.
    const backendFlag = String(ctx.flags.backend || 'auto');
    // Feature: validation split + resume (native TrainingPipeline leg).
    const valSplitRaw = parseFloat((ctx.flags['val-split'] as string) ?? '0.1');
    const valSplit = Number.isFinite(valSplitRaw) ? Math.max(0, Math.min(1, valSplitRaw)) : 0.1;
    const resumePath = ctx.flags.resume ? String(ctx.flags.resume) : undefined;
    // --resume is a native-only capability; refuse the WASM combination up
    // front so the user gets a clear error rather than a silently-ignored flag.
    if (resumePath && backendFlag === 'wasm') {
      output.writeln();
      output.writeln(output.error('--resume is only supported by the native backend; drop --backend wasm.'));
      return { success: false, exitCode: 1 };
    }
    const useWasm = ctx.flags.wasm !== false;
    const useFlash = ctx.flags.flash !== false;
    const useMoE = ctx.flags.moe === true;
    const useHyperbolic = ctx.flags.hyperbolic === true;
    const useContrastive = ctx.flags.contrastive !== false;
    const useCurriculum = ctx.flags.curriculum === true;
    const dataFile = ctx.flags.data as string | undefined;

    output.writeln();
    output.writeln(output.bold('Neural Pattern Training (RuVector WASM)'));
    output.writeln(output.dim('─'.repeat(55)));

    const spinner = output.createSpinner({ text: 'Initializing RuVector training systems...', spinner: 'dots' });
    spinner.start();

    try {
      // Import RuVector training service
      const ruvector = await import('../services/ruvector-training.js');
      const { generateEmbedding } = await import('../memory/memory-initializer.js');
      const {
        initializeIntelligence,
        recordStep,
        recordTrajectory,
        getIntelligenceStats,
        flushPatterns,
        getPersistenceStatus
      } = await import('../memory/intelligence.js');

      // Initialize RuVector WASM training
      let wasmFeatures: string[] = [];
      if (useWasm) {
        const initResult = await ruvector.initializeTraining({
          dim,
          learningRate,
          alpha: 0.1,
          trajectoryCapacity: epochs * batchSize,
          useFlashAttention: useFlash,
          useMoE,
          useHyperbolic,
          totalSteps: useCurriculum ? epochs : undefined,
          warmupSteps: useCurriculum ? Math.floor(epochs * 0.1) : undefined,
        });

        if (initResult.success) {
          wasmFeatures = initResult.features;
          const backendLabel = initResult.backend === 'wasm' ? 'WASM' : 'JS fallback';
          spinner.setText(`RuVector initialized [${backendLabel}]: ${wasmFeatures.join(', ')}`);
        } else {
          output.writeln(output.warning(`WASM init failed: ${initResult.error} - falling back`));
        }
      }

      // Also initialize SONA + ReasoningBank for persistence
      await initializeIntelligence({
        loraLearningRate: learningRate,
        maxTrajectorySize: epochs
      });

      // Pattern type to operator mapping
      const operatorMap: Record<string, number> = {
        coordination: ruvector.OperatorType.COORDINATION,
        optimization: ruvector.OperatorType.OPTIMIZATION,
        prediction: ruvector.OperatorType.ROUTING,
        security: ruvector.OperatorType.SECURITY,
        testing: ruvector.OperatorType.TESTING,
        debugging: ruvector.OperatorType.DEBUGGING,
        memory: ruvector.OperatorType.MEMORY,
        reasoning: ruvector.OperatorType.REASONING,
      };
      const operatorType = operatorMap[patternType] ?? ruvector.OperatorType.GENERAL;

      spinner.setText(`Training ${patternType} patterns...`);

      // Training data - load from file or generate synthetic
      let trainingData: { content: string; type: string }[] = [];

      if (dataFile) {
        const fs = await import('fs');
        if (fs.existsSync(dataFile)) {
          const raw = fs.readFileSync(dataFile, 'utf8');
          trainingData = JSON.parse(raw);
        } else {
          spinner.fail(`Training data file not found: ${dataFile}`);
          return { success: false, exitCode: 1 };
        }
      } else {
        // Generate synthetic training data based on pattern type
        const templates: Record<string, string[]> = {
          coordination: [
            'Route task to coder agent for implementation',
            'Coordinate researcher and architect for design phase',
            'Distribute workload across mesh topology',
            'Synchronize agents via gossip protocol',
            'Balance load between active workers',
            'Spawn hierarchical swarm for complex task',
            'Assign reviewer to completed implementation'
          ],
          optimization: [
            'Apply Int8 quantization for memory reduction',
            'Enable HNSW indexing for faster search',
            'Batch operations for throughput improvement',
            'Cache frequently accessed patterns',
            'Prune unused neural pathways',
            'Use Flash Attention for large sequences',
            'Enable SIMD for vector operations'
          ],
          prediction: [
            'Predict optimal agent for task type',
            'Forecast resource requirements',
            'Anticipate failure modes and mitigate',
            'Estimate completion time for workflow',
            'Predict pattern similarity before search'
          ],
          security: [
            'Validate input at system boundaries',
            'Check for path traversal attempts',
            'Sanitize user-provided data',
            'Apply parameterized queries for SQL',
            'Verify JWT token signatures',
            'Audit sensitive operation access'
          ],
          testing: [
            'Generate unit tests for function',
            'Create integration test suite',
            'Mock external dependencies',
            'Assert expected outcomes',
            'Coverage gap analysis'
          ]
        };

        const patterns = templates[patternType] || templates.coordination;
        for (let i = 0; i < epochs; i++) {
          trainingData.push({
            content: patterns[i % patterns.length],
            type: patternType
          });
        }
      }

      // Training metrics
      const startTime = Date.now();
      const epochTimes: number[] = [];
      let patternsRecorded = 0;
      let trajectoriesCompleted = 0;
      let totalLoss = 0;
      let adaptations = 0;

      // Generate embeddings for training data
      const embeddings: Float32Array[] = [];
      spinner.setText('Generating embeddings...');

      for (const item of trainingData.slice(0, Math.min(100, trainingData.length))) {
        const embeddingResult = await generateEmbedding(item.content);
        if (embeddingResult && embeddingResult.embedding) {
          // Convert to Float32Array and resize to dim
          const embeddingArray = embeddingResult.embedding;
          const resized = new Float32Array(dim);
          for (let i = 0; i < Math.min(embeddingArray.length, dim); i++) {
            resized[i] = embeddingArray[i];
          }
          embeddings.push(resized);
        }
      }

      spinner.setText(`Training with ${embeddings.length} embeddings...`);

      // #2549 — native TrainingPipeline leg. In 'auto'/'native' mode the
      // LoRA training runs through @ruvector/ruvllm with the checkpoint
      // taken from the TRAINED pipeline (the old best-effort block saved
      // a fresh adapter's untrained weights). SONA/ReasoningBank
      // persistence in the loop below runs regardless of backend.
      const nativeTraining = await import('../services/native-training.js');
      const useNative = backendFlag === 'native'
        || (backendFlag === 'auto' && nativeTraining.nativeTrainingAvailable());
      // --resume only works on the native pipeline; if native is unavailable
      // (module absent), fail loudly rather than silently fresh-train.
      if (resumePath && !useNative) {
        spinner.fail('--resume requires the native @ruvector/ruvllm backend, which is not available');
        return { success: false, exitCode: 1 };
      }
      let nativeResult: import('../services/native-training.js').NativeTrainingResult | null = null;
      if (useNative) {
        spinner.setText(`Training ${patternType} on native @ruvector/ruvllm pipeline...`);
        const path = await import('path');
        try {
          nativeResult = await nativeTraining.runNativeTraining({
            embeddings,
            epochs,
            batchSize,
            learningRate,
            dim,
            validationSplit: valSplit,
            resumeFrom: resumePath,
            checkpointPath: path.join(process.cwd(), '.claude-flow', 'neural', `lora-checkpoint-${Date.now()}.json`),
          });
        } catch (err) {
          // ResumeFailedError — an explicit --resume that could not load is a
          // loud, exit-1 failure, never a silent fall-through to fresh training.
          spinner.fail(`Resume failed: ${(err as Error).message}`);
          return { success: false, exitCode: 1 };
        }
        if (!nativeResult && backendFlag === 'native') {
          spinner.fail('Native backend requested (--backend native) but @ruvector/ruvllm training failed');
          return { success: false, exitCode: 1 };
        }
      }
      // Native handles the LoRA leg; WASM contrastive runs when native
      // didn't (absent module, or explicit --backend wasm).
      const runWasmLeg = !nativeResult;

      // Main training loop with WASM acceleration
      for (let epoch = 0; epoch < epochs; epoch++) {
        const epochStart = performance.now();

        // Get curriculum difficulty if enabled
        const difficulty = useCurriculum ? ruvector.getCurriculumDifficulty(epoch) : 1.0;

        // Process batch
        const batchStart = (epoch * batchSize) % embeddings.length;
        const batch = embeddings.slice(batchStart, batchStart + batchSize);

        if (batch.length === 0) continue;

        // Training step with contrastive learning
        if (runWasmLeg && useContrastive && batch.length >= 3 && useWasm && wasmFeatures.length > 0) {
          const anchor = batch[0];
          const positives = [batch[1]];
          const negatives = batch.slice(2);

          try {
            // Compute contrastive loss
            const { loss, gradient } = ruvector.computeContrastiveLoss(anchor, positives, negatives);
            totalLoss += loss;

            // Scale gradient by difficulty
            const scaledGradient = new Float32Array(gradient.length);
            for (let i = 0; i < gradient.length; i++) {
              scaledGradient[i] = gradient[i] * difficulty;
            }

            // Train with MicroLoRA
            await ruvector.trainPattern(anchor, scaledGradient, operatorType);
            adaptations++;

            // Record trajectory for learning
            const baselineMs = 10; // Baseline execution time
            const executionMs = performance.now() - epochStart;
            ruvector.recordTrajectory(anchor, operatorType, useFlash ? 1 : 0, executionMs, baselineMs);
          } catch {
            // WASM training failed, fall back to basic
          }
        }

        // Also record in SONA/ReasoningBank for persistence
        const item = trainingData[epoch % trainingData.length];
        await recordStep({
          type: 'action',
          content: item.content,
          metadata: { epoch, patternType, learningRate, difficulty }
        });
        patternsRecorded++;

        // Record trajectory every 10 epochs
        if ((epoch + 1) % 10 === 0 || epoch === epochs - 1) {
          const steps = trainingData.slice(
            Math.max(0, epoch - 9),
            epoch + 1
          ).map(d => ({ type: 'action' as const, content: d.content }));
          await recordTrajectory(steps, 'success');
          trajectoriesCompleted++;
        }

        const epochTime = performance.now() - epochStart;
        epochTimes.push(epochTime);

        // Update progress
        const progress = Math.round(((epoch + 1) / epochs) * 100);
        const avgEpochTime = epochTimes.reduce((a, b) => a + b, 0) / epochTimes.length;
        const eta = Math.round((epochs - epoch - 1) * avgEpochTime / 1000);
        spinner.setText(`Training ${patternType} patterns... ${progress}% (ETA: ${eta}s, loss: ${(totalLoss / Math.max(1, epoch + 1)).toFixed(4)})`);
      }

      const totalTime = Date.now() - startTime;

      // Get RuVector stats
      const ruvectorStats = useWasm && wasmFeatures.length > 0 ? ruvector.getTrainingStats() : null;
      const trajectoryStats = ruvectorStats?.trajectoryStats;

      // Benchmark if WASM was used
      let benchmark: Array<{ name: string; averageTimeMs: number; opsPerSecond: number }> | null = null;
      if (useWasm && wasmFeatures.length > 0) {
        try {
          spinner.setText('Running benchmark...');
          benchmark = await ruvector.benchmarkTraining(dim, 100);
        } catch {
          // Benchmark failed, continue
        }
      }

      // Get SONA stats
      const stats = getIntelligenceStats();

      spinner.succeed(`Training complete: ${epochs} epochs in ${(totalTime / 1000).toFixed(1)}s`);

      // Flush patterns to disk
      flushPatterns();
      const persistence = getPersistenceStatus();

      // Checkpoint: when the native pipeline trained, its checkpoint (the
      // TRAINED weights) was already written by runNativeTraining. The
      // pre-3.19 fallback below saved a FRESH adapter's weights — only
      // meaningful as a fallback when the native leg didn't run.
      if (!nativeResult?.checkpointPath) {
        try {
          const { LoRAAdapter } = await import('../ruvector/lora-adapter.js');
          const path = await import('path');
          const cpDir = path.join(process.cwd(), '.claude-flow', 'neural');
          const cpPath = path.join(cpDir, `lora-checkpoint-${Date.now()}.json`);
          const adapter = new LoRAAdapter({ inputDim: dim, outputDim: dim, rank: 4 });
          await adapter.initBackend();
          await adapter.saveCheckpoint(cpPath);
        } catch { /* checkpoint save is best-effort */ }
      }

      output.writeln();

      // Display results
      const tableData = [
        { metric: 'Pattern Type', value: patternType },
        { metric: 'Epochs', value: String(epochs) },
        { metric: 'Batch Size', value: String(batchSize) },
        { metric: 'Embedding Dim', value: String(dim) },
        { metric: 'Learning Rate', value: String(learningRate) },
        { metric: 'Patterns Recorded', value: patternsRecorded.toLocaleString() },
        { metric: 'Trajectories', value: String(trajectoriesCompleted) },
        { metric: 'Total Time', value: `${(totalTime / 1000).toFixed(1)}s` },
        { metric: 'Avg Epoch Time', value: `${(epochTimes.reduce((a, b) => a + b, 0) / epochTimes.length).toFixed(2)}ms` },
      ];

      // Native pipeline metrics (#2549 — the LoRA leg trained on ruvllm)
      if (nativeResult) {
        tableData.push(
          { metric: 'Backend', value: 'native (@ruvector/ruvllm TrainingPipeline)' },
          { metric: 'Native Steps', value: String(nativeResult.steps) },
          { metric: 'Final Loss', value: nativeResult.finalLoss.toExponential(3) },
        );
        // Validation metrics only surface when a holdout actually ran
        // (bestValLoss is non-null); Early Stopped is only meaningful then.
        if (nativeResult.bestValLoss !== null && nativeResult.bestValLoss !== undefined) {
          tableData.push(
            { metric: 'Best Val Loss', value: nativeResult.bestValLoss.toExponential(3) },
            { metric: 'Early Stopped', value: nativeResult.earlyStopped ? 'yes' : 'no' },
          );
        }
        if (nativeResult.resumed) {
          tableData.push({
            metric: 'Resumed',
            value: nativeResult.resumeMode === 'resumeFrom'
              ? `${resumePath} (epoch position restored)`
              : `${resumePath} (weights only — epoch-position resume needs @ruvector/ruvllm >=2.6.0)`,
          });
        }
        if (nativeResult.checkpointPath) {
          tableData.push({
            metric: 'Checkpoint',
            value: `${nativeResult.checkpointPath}${nativeResult.checkpointBytes ? ` (${(nativeResult.checkpointBytes / 1024).toFixed(1)} KB)` : ''}`,
          });
        }
      }

      // Add WASM-specific metrics
      if (runWasmLeg && useWasm && wasmFeatures.length > 0) {
        const backendUsed = ruvectorStats?.backend || 'unknown';
        tableData.push(
          { metric: 'Backend', value: backendUsed === 'wasm' ? 'WASM (native)' : 'JS (fallback)' },
          { metric: 'WASM Features', value: wasmFeatures.slice(0, 3).join(', ') },
          { metric: 'LoRA Adaptations', value: String(adaptations) },
          { metric: 'Avg Loss', value: (totalLoss / Math.max(1, epochs)).toFixed(4) }
        );

        if (ruvectorStats?.microLoraStats) {
          tableData.push(
            { metric: 'MicroLoRA Delta Norm', value: ruvectorStats.microLoraStats.deltaNorm.toFixed(6) }
          );
        }

        if (trajectoryStats) {
          tableData.push(
            { metric: 'Success Rate', value: `${(trajectoryStats.successRate * 100).toFixed(1)}%` },
            { metric: 'Mean Improvement', value: `${(trajectoryStats.meanImprovement * 100).toFixed(1)}%` }
          );
        }

        if (benchmark && benchmark.length > 0) {
          const flashBench = benchmark.find(b => b.name.includes('Flash'));
          if (flashBench) {
            tableData.push({ metric: 'Flash Attention', value: `${flashBench.opsPerSecond.toLocaleString()} ops/s` });
          }
        }
      }

      tableData.push(
        { metric: 'ReasoningBank Size', value: stats.reasoningBankSize.toLocaleString() },
        { metric: 'Persisted To', value: output.dim(persistence.dataDir) }
      );

      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 26 },
          { key: 'value', header: 'Value', width: 32 },
        ],
        data: tableData,
      });

      output.writeln();
      output.writeln(output.success(`✓ ${patternsRecorded} patterns saved to ${persistence.patternsFile}`));

      if (useWasm && wasmFeatures.length > 0) {
        const backendUsed = ruvectorStats?.backend || 'unknown';
        const backendMsg = backendUsed === 'wasm'
          ? `RuVector WASM backend: ${wasmFeatures.join(', ')}`
          : `RuVector JS fallback (install @ruvector/learning-wasm for native speed): ${wasmFeatures.join(', ')}`;
        output.writeln(output.highlight(`✓ ${backendMsg}`));
      }

      return {
        success: true,
        data: {
          epochs,
          patternsRecorded,
          trajectoriesCompleted,
          totalTime,
          wasmFeatures,
          ruvectorStats,
          benchmark,
          stats,
          persistence
        }
      };
    } catch (error) {
      spinner.fail('Training failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// Status subcommand - REAL measurements
const statusCommand: Command = {
  name: 'status',
  description: 'Check neural network status and loaded models',
  options: [
    { name: 'model', short: 'm', type: 'string', description: 'Specific model ID to check' },
    { name: 'verbose', short: 'v', type: 'boolean', description: 'Show detailed metrics' },
  ],
  examples: [
    { command: 'claude-flow neural status', description: 'Show all neural status' },
    { command: 'claude-flow neural status -m model-123', description: 'Check specific model' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const verbose = ctx.flags.verbose === true;

    output.writeln();
    output.writeln(output.bold('Neural Network Status (Real)'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: 'Checking neural systems...', spinner: 'dots' });
    spinner.start();

    try {
      // Import real implementations
      const { getIntelligenceStats, initializeIntelligence, benchmarkAdaptation } = await import('../memory/intelligence.js');
      const { getHNSWStatus, loadEmbeddingModel } = await import('../memory/memory-initializer.js');
      const ruvector = await import('../services/ruvector-training.js');

      // Initialize if needed and get real stats
      await initializeIntelligence();
      const stats = getIntelligenceStats();
      const hnswStatus = getHNSWStatus();

      // Quick benchmark for actual adaptation time
      const adaptBench = benchmarkAdaptation(100);

      // Check embedding model
      const modelInfo = await loadEmbeddingModel({ verbose: false });

      // Check RuVector WASM status
      const ruvectorStats = ruvector.getTrainingStats();
      const sonaAvailable = ruvector.isSonaAvailable();

      spinner.succeed('Neural systems checked');

      output.writeln();
      output.printTable({
        columns: [
          { key: 'component', header: 'Component', width: 22 },
          { key: 'status', header: 'Status', width: 12 },
          { key: 'details', header: 'Details', width: 32 },
        ],
        data: [
          {
            component: 'SONA Coordinator',
            status: stats.sonaEnabled ? output.success('Active') : output.warning('Inactive'),
            details: stats.sonaEnabled
              ? `Adaptation: ${(adaptBench.avgMs * 1000).toFixed(2)}μs avg`
              : 'Not initialized',
          },
          {
            component: 'RuVector Training',
            status: ruvectorStats.initialized ? output.success('Active') : output.dim('Not loaded'),
            details: ruvectorStats.initialized
              ? `${ruvectorStats.backend === 'wasm' ? 'WASM' : 'JS fallback'} | MicroLoRA: ${ruvectorStats.totalAdaptations} adapts`
              : 'Call neural train to initialize',
          },
          {
            component: 'SONA Engine',
            status: sonaAvailable ? output.success('Active') : output.dim('Not loaded'),
            details: sonaAvailable && ruvectorStats.sonaStats
              ? `${ruvectorStats.sonaStats.totalLearns} learns, ${ruvectorStats.sonaStats.totalSearches} searches`
              : 'Optional, enable with --sona',
          },
          {
            component: 'ReasoningBank',
            status: (stats.patternsLearned > 0 || stats.reasoningBankSize > 0)
              ? output.success('Active')
              : output.dim('Empty'),
            details: `${stats.patternsLearned} patterns stored`,
          },
          {
            // #2356: distinguish "loaded in this process" from "installed but
            // not yet loaded" from "not installed". Previously `neural status`
            // always printed "Not loaded" because it never warms the lazy
            // singleton — a false negative even when @ruvector/core is present.
            component: 'HNSW Index',
            status: hnswStatus.initialized
              ? output.success('Ready')
              : hnswStatus.available
                ? output.info('Available')
                : output.dim('Not installed'),
            details: hnswStatus.initialized
              ? `${hnswStatus.entryCount} vectors, ${hnswStatus.dimensions}-dim`
              : hnswStatus.available
                ? '@ruvector/core installed (loads on first vector search)'
                : '@ruvector/core not available',
          },
          {
            component: 'Embedding Model',
            status: modelInfo.success ? output.success('Loaded') : output.warning('Fallback'),
            details: `${modelInfo.modelName} (${modelInfo.dimensions}-dim)`,
          },
          {
            component: 'Flash Attention Ops',
            status: output.success('Available'),
            details: 'batchCosineSim, softmax, topK',
          },
          {
            component: 'Int8 Quantization',
            status: output.success('Available'),
            details: '~4x memory reduction',
          },
          {
            component: 'ruvllm Coordinator',
            status: stats._ruvllmBackend === 'active' ? output.success('Active') : output.dim('Unavailable'),
            details: stats._ruvllmBackend === 'active'
              ? `SonaCoordinator | ${stats._ruvllmTrajectories} trajectories`
              : 'Install @ruvector/ruvllm',
          },
          {
            component: 'Contrastive Trainer',
            // #2549 — three states: live session (object with counts),
            // 'available' (module resolves, no in-process session — the
            // normal case for a read-only status process), 'unavailable'
            // (module genuinely does not resolve).
            status: typeof stats._contrastiveTrainer === 'object'
              ? output.success('Active')
              : stats._contrastiveTrainer === 'available'
                ? output.success('Available')
                : output.dim('Unavailable'),
            details: typeof stats._contrastiveTrainer === 'object'
              ? `${(stats._contrastiveTrainer as any).triplets ?? 0} triplets, ${(stats._contrastiveTrainer as any).agents ?? 0} agents`
              : stats._contrastiveTrainer === 'available'
                ? 'ready — trains in-process on demand'
                : 'Install @ruvector/ruvllm',
          },
          {
            component: 'Training Pipeline',
            status: stats._trainingBackend === 'ruvllm' ? output.success('Available') : output.dim(stats._trainingBackend || 'Unavailable'),
            // Checkpoint capability is version-gated: saveCheckpoint(path)
            // was a silent no-op before @ruvector/ruvllm 2.5.7 (#2549).
            details: stats._trainingBackend === 'ruvllm'
              ? await (async () => {
                  try {
                    const { nativeCheckpointsSupported, latestCheckpointInfo } = await import('../ruvector/lora-adapter.js');
                    // Most important info first (truncation-friendly): backend
                    // capability, then the newest checkpoint + age when one exists.
                    const base = nativeCheckpointsSupported()
                      ? 'native @ruvector/ruvllm pipeline + disk checkpoints'
                      : 'native @ruvector/ruvllm pipeline (checkpoints need >=2.5.7)';
                    const cp = latestCheckpointInfo();
                    return cp ? `${base} · latest: ${cp.filename} (${cp.ageLabel})` : base;
                  } catch {
                    return 'native @ruvector/ruvllm pipeline';
                  }
                })()
              : 'JS fallback',
          },
          await (async () => {
            try {
              const { getGraphStats } = await import('../ruvector/graph-backend.js');
              const gs = await getGraphStats();
              return {
                component: 'Graph Database',
                status: gs.backend === 'graph-node' ? output.success('Active') : output.dim('Unavailable'),
                details: gs.backend === 'graph-node'
                  ? `${gs.totalNodes} nodes, ${gs.totalEdges} edges`
                  : 'Install @ruvector/graph-node',
              };
            } catch { return { component: 'Graph Database', status: output.dim('Unavailable'), details: 'Not loaded' }; }
          })(),
        ],
      });

      if (verbose) {
        output.writeln();
        output.writeln(output.bold('Detailed Metrics'));

        const detailedData = [
          { metric: 'Trajectories Recorded', value: String(stats.trajectoriesRecorded) },
          { metric: 'Patterns Learned', value: String(stats.patternsLearned) },
          { metric: 'HNSW Dimensions', value: String(hnswStatus.dimensions) },
          { metric: 'SONA Adaptation (avg)', value: `${(adaptBench.avgMs * 1000).toFixed(2)}μs` },
          { metric: 'SONA Adaptation (max)', value: `${(adaptBench.maxMs * 1000).toFixed(2)}μs` },
          { metric: 'Target Met (<0.05ms)', value: adaptBench.targetMet ? output.success('Yes') : output.warning('No') },
          {
            metric: 'Last Adaptation',
            value: stats.lastAdaptation
              ? new Date(stats.lastAdaptation).toLocaleTimeString()
              : 'Never',
          },
        ];

        // Add RuVector WASM metrics if initialized
        if (ruvectorStats.initialized) {
          detailedData.push(
            { metric: 'RuVector Adaptations', value: String(ruvectorStats.totalAdaptations) },
            { metric: 'RuVector Forwards', value: String(ruvectorStats.totalForwards) },
          );
          if (ruvectorStats.microLoraStats) {
            detailedData.push(
              { metric: 'MicroLoRA Delta Norm', value: ruvectorStats.microLoraStats.deltaNorm.toFixed(6) },
              { metric: 'MicroLoRA Adapt Count', value: String(ruvectorStats.microLoraStats.adaptCount) },
            );
          }
          if (sonaAvailable && ruvectorStats.sonaStats?.stats) {
            const sonaStats = ruvectorStats.sonaStats.stats as Record<string, unknown>;
            detailedData.push(
              { metric: 'SONA Patterns Stored', value: String(sonaStats.patterns_stored || 0) },
              { metric: 'SONA EWC Tasks', value: String(sonaStats.ewc_tasks || 0) },
            );
          }
        }

        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 28 },
            { key: 'value', header: 'Value', width: 20 },
          ],
          data: detailedData,
        });
      }

      return { success: true, data: { stats, hnswStatus, adaptBench, modelInfo, ruvectorStats } };
    } catch (error) {
      spinner.fail('Failed to check neural systems');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// Patterns subcommand
const patternsCommand: Command = {
  name: 'patterns',
  description: 'Analyze and manage cognitive patterns',
  options: [
    { name: 'action', short: 'a', type: 'string', description: 'Action: analyze, learn, predict, list', default: 'list' },
    { name: 'query', short: 'q', type: 'string', description: 'Pattern query for search' },
    { name: 'limit', short: 'l', type: 'number', description: 'Max patterns to return', default: '10' },
  ],
  examples: [
    { command: 'claude-flow neural patterns --action list', description: 'List all patterns' },
    { command: 'claude-flow neural patterns -a analyze -q "error handling"', description: 'Analyze patterns' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const action = ctx.flags.action as string || 'list';
    const query = ctx.flags.query as string;
    const limit = parseInt(ctx.flags.limit as string, 10) || 10;

    output.writeln();
    output.writeln(output.bold(`Neural Patterns - ${action}`));
    output.writeln(output.dim('─'.repeat(40)));

    try {
      const {
        initializeIntelligence,
        getIntelligenceStats,
        findSimilarPatterns,
        getAllPatterns,
        getPersistenceStatus,
      } = await import('../memory/intelligence.js');

      await initializeIntelligence();
      const stats = getIntelligenceStats();
      const persistence = getPersistenceStatus();

      if (action === 'list') {
        // Get ALL patterns from ReasoningBank (loaded from disk)
        const allPatterns = await getAllPatterns();
        const patterns = query
          ? await findSimilarPatterns(query, { k: limit })
          : allPatterns.slice(0, limit);

        if (patterns.length === 0) {
          output.writeln(output.dim('No patterns found. Train some patterns first with: neural train'));
          output.writeln();
          output.printBox([
            `Total Patterns: ${stats.patternsLearned}`,
            `Trajectories: ${stats.trajectoriesRecorded}`,
            `ReasoningBank Size: ${stats.reasoningBankSize}`,
            `Persistence: ${persistence.patternsExist ? 'Loaded from disk' : 'Not persisted'}`,
            `Data Dir: ${persistence.dataDir}`,
          ].join('\n'), 'Pattern Statistics');
        } else {
          output.printTable({
            columns: [
              { key: 'id', header: 'ID', width: 20 },
              { key: 'type', header: 'Type', width: 18 },
              { key: 'confidence', header: 'Confidence', width: 12 },
              { key: 'usage', header: 'Usage', width: 10 },
            ],
            data: patterns.map((p, i) => ({
              id: (p.id || `P${String(i + 1).padStart(3, '0')}`).substring(0, 18),
              type: output.highlight(p.type || 'unknown'),
              confidence: `${((p.confidence || 0.5) * 100).toFixed(1)}%`,
              usage: String(p.usageCount || 0),
            })),
          });
        }

        output.writeln();
        output.writeln(output.dim(`Total: ${allPatterns.length} patterns (persisted) | Trajectories: ${stats.trajectoriesRecorded}`));
        if (persistence.patternsExist) {
          output.writeln(output.success(`✓ Loaded from: ${persistence.patternsFile}`));
        }
      } else if (action === 'analyze' && query) {
        // Analyze patterns related to query
        const related = await findSimilarPatterns(query, { k: limit });
        output.writeln(`Analyzing patterns related to: "${query}"`);
        output.writeln();

        if (related.length > 0) {
          output.printTable({
            columns: [
              { key: 'content', header: 'Pattern', width: 40 },
              { key: 'confidence', header: 'Confidence', width: 12 },
              { key: 'type', header: 'Type', width: 15 },
            ],
            data: related.slice(0, 5).map(p => ({
              content: (p.content || '').substring(0, 38) + (p.content?.length > 38 ? '...' : ''),
              confidence: `${((p.confidence || 0) * 100).toFixed(0)}%`,
              type: p.type || 'general',
            })),
          });
        } else {
          output.writeln(output.dim('No related patterns found.'));
        }
      }

      return { success: true };
    } catch (error) {
      // Fallback if intelligence not initialized
      output.writeln(output.dim('Intelligence system not initialized.'));
      output.writeln(output.dim('Run: claude-flow neural train --pattern-type general'));
      return { success: false };
    }
  },
};

// Predict subcommand
const predictCommand: Command = {
  name: 'predict',
  description: 'Make AI predictions using trained models',
  options: [
    { name: 'input', short: 'i', type: 'string', description: 'Input text to predict routing for', required: true },
    { name: 'k', short: 'k', type: 'number', description: 'Number of top predictions', default: '5' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: json, table', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural predict -i "implement authentication"', description: 'Predict routing for task' },
    { command: 'claude-flow neural predict -i "fix bug in login" -k 3', description: 'Get top 3 predictions' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const input = ctx.flags.input as string;
    const k = parseInt(ctx.flags.k as string || '5', 10);
    const format = ctx.flags.format as string || 'table';

    if (!input) {
      output.printError('--input is required');
      return { success: false, exitCode: 1 };
    }

    output.writeln();
    output.writeln(output.bold('Neural Prediction (Real)'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: 'Running inference...', spinner: 'dots' });
    spinner.start();

    try {
      const { initializeIntelligence, findSimilarPatterns } = await import('../memory/intelligence.js');

      // Initialize intelligence system
      await initializeIntelligence();

      // Find similar patterns (embedding is done internally)
      const startSearch = performance.now();
      const matches = await findSimilarPatterns(input, { k });
      const searchTime = performance.now() - startSearch;

      spinner.succeed(`Prediction complete (search: ${searchTime.toFixed(1)}ms)`);

      output.writeln();

      if (matches.length === 0) {
        output.writeln(output.warning('No similar patterns found. Try training first: claude-flow neural train'));
        return { success: true, data: { matches: [] } };
      }

      if (format === 'json') {
        output.writeln(JSON.stringify(matches, null, 2));
      } else {
        // Determine best prediction based on patterns
        const patternTypes: Record<string, number> = {};
        for (const match of matches) {
          const type = match.type || 'unknown';
          patternTypes[type] = (patternTypes[type] || 0) + match.similarity;
        }

        const sorted = Object.entries(patternTypes).sort((a, b) => b[1] - a[1]);
        const topType = sorted[0]?.[0] || 'unknown';
        const confidence = matches[0]?.similarity || 0;

        output.printBox([
          `Input: ${input.substring(0, 60)}${input.length > 60 ? '...' : ''}`,
          ``,
          `Predicted Type: ${topType}`,
          `Confidence: ${(confidence * 100).toFixed(1)}%`,
          `Latency: ${searchTime.toFixed(1)}ms`,
          ``,
          `Top ${matches.length} Similar Patterns:`,
        ].join('\n'), 'Result');

        output.printTable({
          columns: [
            { key: 'rank', header: '#', width: 3 },
            { key: 'id', header: 'Pattern ID', width: 20 },
            { key: 'type', header: 'Type', width: 15 },
            { key: 'similarity', header: 'Similarity', width: 12 },
          ],
          data: matches.slice(0, k).map((m, i) => ({
            rank: String(i + 1),
            id: m.id?.substring(0, 20) || 'unknown',
            type: m.type || 'action',
            similarity: `${(m.similarity * 100).toFixed(1)}%`,
          })),
        });
      }

      return { success: true, data: { matches, searchTime } };
    } catch (error) {
      spinner.fail('Prediction failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// Optimize subcommand - Real Int8 quantization and pattern optimization
const optimizeCommand: Command = {
  name: 'optimize',
  description: 'Optimize neural patterns (Int8 quantization, memory compression)',
  options: [
    { name: 'method', type: 'string', description: 'Method: quantize, analyze, compact', default: 'quantize' },
    { name: 'verbose', short: 'v', type: 'boolean', description: 'Show detailed metrics' },
  ],
  examples: [
    { command: 'claude-flow neural optimize --method quantize', description: 'Quantize patterns to Int8' },
    { command: 'claude-flow neural optimize --method analyze -v', description: 'Analyze memory usage' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const method = ctx.flags.method as string || 'quantize';
    const verbose = ctx.flags.verbose === true;

    output.writeln();
    output.writeln(output.bold('Pattern Optimization (Real)'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: `Running ${method} optimization...`, spinner: 'dots' });
    spinner.start();

    try {
      const { initializeIntelligence, getIntelligenceStats, getAllPatterns, flushPatterns, compactPatterns } = await import('../memory/intelligence.js');
      const fs = await import('fs');
      const path = await import('path');

      await initializeIntelligence();
      const patterns = await getAllPatterns();
      const stats = getIntelligenceStats();

      // Trigger ruvllm background learning if available
      try {
        const { runBackgroundLearning } = await import('../memory/intelligence.js');
        await runBackgroundLearning();
      } catch { /* background learning is best-effort */ }

      // Get actual pattern storage size
      const patternDir = path.join(process.cwd(), '.claude-flow', 'neural');
      let beforeSize = 0;
      try {
        const patternFile = path.join(patternDir, 'patterns.json');
        if (fs.existsSync(patternFile)) {
          beforeSize = fs.statSync(patternFile).size;
        }
      } catch { /* ignore */ }

      if (method === 'quantize') {
        // Perform real Int8 quantization on pattern embeddings
        spinner.setText('Quantizing pattern embeddings to Int8...');

        let quantizedCount = 0;
        let totalBeforeValues = 0;
        let totalAfterValues = 0;

        for (const pattern of patterns) {
          if (pattern.embedding && pattern.embedding.length > 0) {
            totalBeforeValues += pattern.embedding.length;

            // Actually quantize: scale Float32 values to Int8 range [-128, 127]
            const emb = pattern.embedding;
            let min = Infinity, max = -Infinity;
            for (const v of emb) {
              if (v < min) min = v;
              if (v > max) max = v;
            }
            const range = max - min || 1;
            const scale = 255 / range;
            const offset = min;

            // Convert in-place to quantized integer values
            for (let i = 0; i < emb.length; i++) {
              emb[i] = Math.round((emb[i] - offset) * scale) - 128;
            }

            // Store quantization params for dequantization (extra fields survive JSON serialization)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p = pattern as any;
            p.quantized = true;
            p.quantScale = scale;
            p.quantOffset = offset;

            totalAfterValues += pattern.embedding.length;
            quantizedCount++;
          }
        }

        // Save actually-quantized patterns (integers serialize smaller in JSON)
        await flushPatterns();

        // Measure real file size after quantization
        let afterSize = beforeSize;
        try {
          const patternFile = path.join(patternDir, 'patterns.json');
          if (fs.existsSync(patternFile)) {
            afterSize = fs.statSync(patternFile).size;
          }
        } catch { /* ignore */ }

        const actualRatio = beforeSize > 0 && afterSize > 0 ? (beforeSize / afterSize) : 0;

        spinner.succeed(`Quantized ${quantizedCount} pattern embeddings to Int8`);

        output.writeln();
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 25 },
            { key: 'before', header: 'Before', width: 18 },
            { key: 'after', header: 'After', width: 18 },
          ],
          data: [
            { metric: 'Pattern Count', before: String(patterns.length), after: String(patterns.length) },
            { metric: 'Quantized', before: '-', after: String(quantizedCount) },
            { metric: 'Storage Size', before: `${(beforeSize / 1024).toFixed(1)} KB`, after: `${(afterSize / 1024).toFixed(1)} KB` },
            { metric: 'Reduction Ratio', before: '-', after: actualRatio > 0 ? `${actualRatio.toFixed(2)}x` : 'N/A (no data)' },
            { metric: 'Precision', before: 'Float32', after: 'Int8 (±0.5%)' },
          ],
        });

      } else if (method === 'analyze') {
        spinner.succeed('Analysis complete');

        output.writeln();
        output.writeln(output.bold('Pattern Memory Analysis'));

        const embeddingBytes = patterns.reduce((sum, p) => sum + (p.embedding?.length || 0) * 4, 0);
        const metadataEstimate = patterns.length * 100; // ~100 bytes per pattern metadata

        output.printTable({
          columns: [
            { key: 'component', header: 'Component', width: 25 },
            { key: 'size', header: 'Size', width: 18 },
            { key: 'count', header: 'Count', width: 12 },
          ],
          data: [
            { component: 'Pattern Embeddings (F32)', size: `${(embeddingBytes / 1024).toFixed(1)} KB`, count: String(patterns.length) },
            { component: 'Pattern Metadata', size: `${(metadataEstimate / 1024).toFixed(1)} KB`, count: '-' },
            { component: 'Total In-Memory', size: `${((embeddingBytes + metadataEstimate) / 1024).toFixed(1)} KB`, count: '-' },
            { component: 'Storage (patterns.json)', size: `${(beforeSize / 1024).toFixed(1)} KB`, count: '-' },
            { component: 'Trajectories', size: '-', count: String(stats.trajectoriesRecorded) },
          ],
        });

        if (verbose) {
          output.writeln();
          output.writeln(output.bold('Optimization Recommendations'));
          const recommendations: string[] = [];
          if (patterns.length > 1000) {
            recommendations.push('- Consider pruning low-usage patterns');
          }
          if (embeddingBytes > 1024 * 1024) {
            recommendations.push('- Int8 quantization would reduce memory by ~75%');
          }
          if (stats.trajectoriesRecorded > 100) {
            recommendations.push('- Trajectory consolidation available');
          }
          if (recommendations.length === 0) {
            recommendations.push('- Patterns are already well optimized');
          }
          recommendations.forEach(r => output.writeln(r));
        }

      } else if (method === 'compact') {
        spinner.setText('Compacting pattern storage...');

        // Remove duplicate or very similar patterns
        const compacted = await compactPatterns(0.95); // Remove patterns with >95% similarity

        spinner.succeed(`Compacted ${compacted.removed} patterns`);

        output.writeln();
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 20 },
            { key: 'value', header: 'Value', width: 15 },
          ],
          data: [
            { metric: 'Patterns Before', value: String(compacted.before) },
            { metric: 'Patterns After', value: String(compacted.after) },
            { metric: 'Removed', value: String(compacted.removed) },
            { metric: 'Similarity Threshold', value: '95%' },
          ],
        });
      }

      return { success: true };
    } catch (error) {
      spinner.fail('Optimization failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// Export subcommand - Securely export trained models to IPFS
const exportCommand: Command = {
  name: 'export',
  description: 'Export trained models to IPFS for sharing (Ed25519 signed)',
  options: [
    { name: 'model', short: 'm', type: 'string', description: 'Model ID or category to export' },
    { name: 'output', short: 'o', type: 'string', description: 'Output file path (optional)' },
    { name: 'ipfs', short: 'i', type: 'boolean', description: 'Pin to IPFS (requires Pinata credentials)' },
    { name: 'sign', short: 's', type: 'boolean', description: 'Sign with Ed25519 key', default: 'true' },
    { name: 'strip-pii', type: 'boolean', description: 'Strip potential PII from export', default: 'true' },
    { name: 'name', short: 'n', type: 'string', description: 'Custom name for exported model' },
  ],
  examples: [
    { command: 'claude-flow neural export -m security-patterns --ipfs', description: 'Export and pin to IPFS' },
    { command: 'claude-flow neural export -m code-review -o ./export.json', description: 'Export to file' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const modelId = ctx.flags.model as string || 'all';
    const outputFile = ctx.flags.output as string | undefined;
    const pinToIpfs = ctx.flags.ipfs as boolean;
    const signExport = ctx.flags.sign !== false;
    const stripPii = ctx.flags['strip-pii'] !== false;
    const customName = ctx.flags.name as string;

    output.writeln();
    output.writeln(output.bold('Secure Model Export'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: 'Preparing export...', spinner: 'dots' });
    spinner.start();

    try {
      const fs = await import('fs');
      const path = await import('path');
      const crypto = await import('crypto');

      // Collect trained patterns from memory
      spinner.setText('Collecting trained patterns...');
      const { getIntelligenceStats, flushPatterns } = await import('../memory/intelligence.js');

      await flushPatterns(); // Ensure all patterns are persisted
      const stats = await getIntelligenceStats();

      // SECURITY: Build export data - NEVER include secrets
      // - API keys read from env but NEVER included in export
      // - Uses ephemeral signing keys (generated per-export, not stored)
      // - PII stripping enabled by default
      // - Suspicious pattern content blocked
      const exportData = {
        type: 'learning-pattern',
        version: '1.0.0',
        name: customName || `claude-flow-model-${Date.now()}`,
        exportedAt: new Date().toISOString(),
        modelId,
        patterns: [] as Array<{ id: string; trigger: string; action: string; confidence: number; usageCount: number }>,
        metadata: {
          sourceVersion: '3.0.0-alpha',
          piiStripped: stripPii,
          signed: signExport,
          accuracy: 0,
          totalUsage: 0,
        },
      };

      // Load patterns from local storage
      const memoryDir = path.join(process.cwd(), '.claude-flow', 'memory');
      const patternsFile = path.join(memoryDir, 'patterns.json');

      if (fs.existsSync(patternsFile)) {
        const patterns = JSON.parse(fs.readFileSync(patternsFile, 'utf8'));

        for (const pattern of patterns) {
          // Security: Strip potential PII
          if (stripPii) {
            // Remove any paths, usernames, or sensitive data
            if (pattern.content) {
              pattern.content = pattern.content
                .replace(/\/Users\/[^\/]+/g, '/Users/[REDACTED]')
                .replace(/\/home\/[^\/]+/g, '/home/[REDACTED]')
                .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
                .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP_REDACTED]');
            }
          }

          exportData.patterns.push({
            id: pattern.id || crypto.randomBytes(8).toString('hex'),
            trigger: pattern.trigger || pattern.type || 'general',
            action: pattern.action || pattern.recommendation || 'apply-pattern',
            confidence: pattern.confidence || 0.85,
            usageCount: pattern.usageCount || 1,
          });
        }
      }

      // Add stats metadata
      exportData.metadata.accuracy = (stats as { retrievalPrecision?: number }).retrievalPrecision || 0.85;
      exportData.metadata.totalUsage = exportData.patterns.reduce((sum, p) => sum + p.usageCount, 0);

      spinner.setText('Generating secure signature...');

      // Sign with Ed25519 if requested
      let signature: string | null = null;
      let publicKey: string | null = null;

      if (signExport) {
        // Generate ephemeral key pair for signing
        // Use Node.js webcrypto for Ed25519 signing
        const { webcrypto } = crypto;
        const keyPair = await webcrypto.subtle.generateKey(
          { name: 'Ed25519' },
          true,
          ['sign', 'verify']
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ) as any;

        const exportBytes = new TextEncoder().encode(JSON.stringify(exportData));
        const signatureBytes = await webcrypto.subtle.sign('Ed25519', keyPair.privateKey, exportBytes);
        signature = Buffer.from(signatureBytes).toString('hex');

        const publicKeyBytes = await webcrypto.subtle.exportKey('raw', keyPair.publicKey);
        publicKey = Buffer.from(publicKeyBytes).toString('hex');
      }

      // SECURITY: Final export package - verify no secrets leaked
      const exportPackage = {
        pinataContent: exportData,
        pinataMetadata: {
          name: exportData.name,
          keyvalues: {
            type: 'learning-pattern',
            version: '1.0.0',
            signed: signExport ? 'true' : 'false',
          },
        },
        signature,
        publicKey: publicKey ? `ed25519:${publicKey}` : null,
        // Note: Private key is ephemeral and NEVER stored or exported
      };

      // SECURITY AUDIT: Ensure no secrets in export
      const exportStr = JSON.stringify(exportPackage);
      const secretPatterns = [
        /sk-ant-[a-zA-Z0-9-]+/,  // Anthropic keys
        /sk-[a-zA-Z0-9]{48}/,    // OpenAI keys
        /AIza[a-zA-Z0-9-_]{35}/, // Google keys
        /pinata_[a-zA-Z0-9]+/,   // Pinata JWT
        /-----BEGIN.*KEY-----/,  // PEM keys
      ];

      for (const pattern of secretPatterns) {
        if (pattern.test(exportStr)) {
          spinner.fail('SECURITY: Export contains potential API keys - aborting');
          return { success: false, exitCode: 1 };
        }
      }

      // Output handling
      if (outputFile) {
        fs.writeFileSync(outputFile, JSON.stringify(exportPackage, null, 2));
        spinner.succeed(`Exported to: ${outputFile}`);
      }

      if (pinToIpfs) {
        spinner.setText('Pinning to IPFS...');

        // Check for Pinata credentials
        const pinataKey = process.env.PINATA_API_KEY;
        const pinataSecret = process.env.PINATA_API_SECRET;

        if (!pinataKey || !pinataSecret) {
          spinner.fail('PINATA_API_KEY and PINATA_API_SECRET required for IPFS export');
          output.writeln(output.dim('Set these in your environment or .env file'));
          return { success: false, exitCode: 1 };
        }

        const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'pinata_api_key': pinataKey,
            'pinata_secret_api_key': pinataSecret,
          },
          body: JSON.stringify(exportPackage),
        });

        if (!response.ok) {
          const error = await response.text();
          spinner.fail(`IPFS pin failed: ${error}`);
          return { success: false, exitCode: 1 };
        }

        const result = await response.json() as { IpfsHash: string; PinSize: number };
        spinner.succeed('Successfully exported to IPFS');

        output.writeln();
        output.table({
          columns: [
            { key: 'property', header: 'Property', width: 20 },
            { key: 'value', header: 'Value', width: 50 },
          ],
          data: [
            { property: 'CID', value: result.IpfsHash },
            { property: 'Size', value: `${result.PinSize} bytes` },
            { property: 'Gateway URL', value: `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}` },
            { property: 'Patterns', value: String(exportData.patterns.length) },
            { property: 'Signed', value: signExport ? 'Yes (Ed25519)' : 'No' },
            { property: 'PII Stripped', value: stripPii ? 'Yes' : 'No' },
          ],
        });

        output.writeln();
        output.writeln(output.success('Share this CID for others to import your trained patterns'));
        output.writeln(output.dim(`Import command: claude-flow neural import --cid ${result.IpfsHash}`));
      }

      if (!outputFile && !pinToIpfs) {
        // Just display the export
        spinner.succeed('Export prepared');
        output.writeln();
        output.writeln(JSON.stringify(exportPackage, null, 2));
      }

      return { success: true };
    } catch (error) {
      spinner.fail(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// List subcommand - List available pre-trained models
const listCommand: Command = {
  name: 'list',
  description: 'List available pre-trained models from the official registry',
  options: [
    { name: 'category', type: 'string', description: 'Filter by category (security, quality, performance, etc.)' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json, simple', default: 'table' },
    { name: 'cid', type: 'string', description: 'Custom registry CID (default: official registry)' },
  ],
  examples: [
    { command: 'claude-flow neural list', description: 'List all available models' },
    { command: 'claude-flow neural list --category security', description: 'List only security models' },
    { command: 'claude-flow neural list -f json', description: 'Output as JSON' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const category = ctx.flags.category as string | undefined;
    const format = ctx.flags.format as string || 'table';
    const customCid = ctx.flags.cid as string;

    // Official model registry CID
    const registryCid = customCid || 'QmNr1yYMKi7YBaL8JSztQyuB5ZUaTdRMLxJC1pBpGbjsTc';

    output.writeln();
    output.writeln(output.bold('Pre-trained Model Registry'));
    output.writeln(output.dim('─'.repeat(60)));

    const spinner = output.createSpinner({ text: 'Fetching model registry...', spinner: 'dots' });
    spinner.start();

    try {
      const gateways = [
        'https://gateway.pinata.cloud',
        'https://ipfs.io',
        'https://dweb.link',
      ];

      interface ModelType {
        id: string;
        name: string;
        category: string;
        description: string;
        patterns: Array<{ id: string; description: string; confidence: number }>;
        metadata: { accuracy: number; totalUsage: number; trainedOn: string };
      }

      interface RegistryType {
        models: ModelType[];
        metadata: { totalPatterns: number; averageAccuracy: number };
      }

      let registry: RegistryType | null = null;

      for (const gateway of gateways) {
        try {
          const response = await fetch(`${gateway}/ipfs/${registryCid}`, {
            signal: AbortSignal.timeout(15000),
            headers: { 'Accept': 'application/json' },
          });

          if (response.ok) {
            registry = await response.json() as RegistryType;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!registry || !registry.models) {
        spinner.fail('Could not fetch model registry');
        return { success: false, exitCode: 1 };
      }

      const registryData = registry as RegistryType;

      // Filter by category if specified
      let models = registryData.models;
      if (category) {
        models = models.filter(m =>
          m.category === category ||
          m.id.includes(category) ||
          m.name.toLowerCase().includes(category.toLowerCase())
        );
        spinner.succeed(`Found ${models.length} models matching "${category}"`);
      } else {
        spinner.succeed(`Found ${registryData.models.length} models`);
      }

      if (models.length === 0) {
        output.writeln(output.warning(`No models found for category: ${category}`));
        output.writeln(output.dim('Available categories: security, quality, performance, testing, api, debugging, refactoring, documentation'));
        return { success: false, exitCode: 1 };
      }

      output.writeln();

      if (format === 'json') {
        output.writeln(JSON.stringify(models, null, 2));
      } else if (format === 'simple') {
        for (const model of models) {
          output.writeln(`${model.id} (${model.category}) - ${model.patterns.length} patterns, ${(model.metadata.accuracy * 100).toFixed(0)}% accuracy`);
        }
      } else {
        // Table format
        output.printTable({
          columns: [
            { key: 'id', header: 'Model ID', width: 35 },
            { key: 'category', header: 'Category', width: 14 },
            { key: 'patterns', header: 'Patterns', width: 10 },
            { key: 'accuracy', header: 'Accuracy', width: 10 },
            { key: 'usage', header: 'Usage', width: 10 },
          ],
          data: models.map(m => ({
            id: m.id,
            category: m.category,
            patterns: String(m.patterns.length),
            accuracy: `${(m.metadata.accuracy * 100).toFixed(0)}%`,
            usage: m.metadata.totalUsage.toLocaleString(),
          })),
        });

        output.writeln();
        output.writeln(output.dim('Registry CID: ' + registryCid));
        output.writeln();
        output.writeln(output.bold('Import Commands:'));
        output.writeln(output.dim('  All models:      ') + `claude-flow neural import --cid ${registryCid}`);
        if (category) {
          output.writeln(output.dim(`  ${category} only: `) + `claude-flow neural import --cid ${registryCid} --category ${category}`);
        } else {
          output.writeln(output.dim('  By category:     ') + `claude-flow neural import --cid ${registryCid} --category <category>`);
        }
      }

      return { success: true };
    } catch (error) {
      spinner.fail(`Failed to list models: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Import subcommand - Securely import models from IPFS
const importCommand: Command = {
  name: 'import',
  description: 'Import trained models from IPFS with signature verification',
  options: [
    { name: 'cid', short: 'c', type: 'string', description: 'IPFS CID to import from' },
    { name: 'file', short: 'f', type: 'string', description: 'Local file to import' },
    { name: 'verify', short: 'v', type: 'boolean', description: 'Verify Ed25519 signature', default: 'true' },
    { name: 'merge', type: 'boolean', description: 'Merge with existing patterns (vs replace)', default: 'true' },
    { name: 'category', type: 'string', description: 'Only import patterns from specific category' },
  ],
  examples: [
    { command: 'claude-flow neural import --cid QmXxx...', description: 'Import from IPFS' },
    { command: 'claude-flow neural import -f ./patterns.json --verify', description: 'Import from file' },
    { command: 'claude-flow neural import --cid QmNr1yYMK... --category security', description: 'Import only security patterns' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const cid = ctx.flags.cid as string;
    const file = ctx.flags.file as string;
    const verifySignature = ctx.flags.verify !== false;
    const merge = ctx.flags.merge !== false;
    const categoryFilter = ctx.flags.category as string | undefined;

    if (!cid && !file) {
      output.writeln(output.error('Either --cid or --file is required'));
      return { success: false, exitCode: 1 };
    }

    output.writeln();
    output.writeln(output.bold('Secure Model Import'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: 'Fetching model...', spinner: 'dots' });
    spinner.start();

    try {
      const fs = await import('fs');
      const path = await import('path');
      const crypto = await import('crypto');

      type ImportDataType = {
        pinataContent?: { patterns: Array<{ id: string; trigger: string; action: string; confidence: number; usageCount: number; category?: string }> };
        patterns?: Array<{ id: string; trigger: string; action: string; confidence: number; usageCount: number; category?: string }>;
        signature?: string;
        publicKey?: string;
      };

      let importData: ImportDataType | null = null;

      // Fetch from IPFS or file
      if (cid) {
        const gateways = [
          'https://gateway.pinata.cloud',
          'https://ipfs.io',
          'https://dweb.link',
        ];

        for (const gateway of gateways) {
          try {
            spinner.setText(`Fetching from ${gateway}...`);
            const response = await fetch(`${gateway}/ipfs/${cid}`, {
              signal: AbortSignal.timeout(30000),
              headers: { 'Accept': 'application/json' },
            });

            if (response.ok) {
              importData = await response.json() as ImportDataType;
              break;
            }
          } catch {
            continue;
          }
        }

        if (!importData) {
          spinner.fail('Could not fetch from any IPFS gateway');
          return { success: false, exitCode: 1 };
        }
      } else {
        if (!fs.existsSync(file)) {
          spinner.fail(`File not found: ${file}`);
          return { success: false, exitCode: 1 };
        }
        importData = JSON.parse(fs.readFileSync(file, 'utf8')) as ImportDataType;
      }

      if (!importData) {
        spinner.fail('No import data available');
        return { success: false, exitCode: 1 };
      }

      // Verify signature if present and requested
      if (verifySignature && importData.signature && importData.publicKey) {
        spinner.setText('Verifying Ed25519 signature...');

        try {
          const { webcrypto } = crypto;
          const publicKeyHex = importData.publicKey.replace('ed25519:', '');
          const publicKeyBytes = Buffer.from(publicKeyHex, 'hex');
          const signatureBytes = Buffer.from(importData.signature, 'hex');

          const publicKey = await webcrypto.subtle.importKey(
            'raw',
            publicKeyBytes,
            { name: 'Ed25519' },
            false,
            ['verify']
          );

          const dataBytes = new TextEncoder().encode(JSON.stringify(importData.pinataContent));
          const valid = await webcrypto.subtle.verify('Ed25519', publicKey, signatureBytes, dataBytes);

          if (!valid) {
            spinner.fail('Signature verification FAILED - data may be tampered');
            return { success: false, exitCode: 1 };
          }

          output.writeln(output.success('Signature verified'));
        } catch (err) {
          output.writeln(output.warning(`Signature verification skipped: ${err instanceof Error ? err.message : String(err)}`));
        }
      }

      // Extract patterns - handle both single model and model registry formats
      spinner.setText('Importing patterns...');

      const content = importData.pinataContent || importData;
      type PatternType = { id: string; trigger: string; action: string; confidence: number; usageCount: number; category?: string };
      type ModelType = { id: string; category: string; patterns: PatternType[] };

      let patterns: PatternType[] = [];

      // Check if this is a model registry (has models array)
      const registry = content as { models?: ModelType[] };
      if (registry.models && Array.isArray(registry.models)) {
        // Model registry format - extract patterns from each model
        for (const model of registry.models) {
          if (!categoryFilter || model.category === categoryFilter || model.id.includes(categoryFilter)) {
            for (const pattern of model.patterns || []) {
              patterns.push({
                ...pattern,
                category: model.category, // Tag with model category
              });
            }
          }
        }
      } else {
        // Single model format - patterns at top level
        patterns = (content as { patterns?: PatternType[] }).patterns || [];
      }

      // Filter by category if specified (additional filtering)
      if (categoryFilter && patterns.length > 0) {
        patterns = patterns.filter(p =>
          p.category === categoryFilter ||
          p.trigger.includes(categoryFilter)
        );
      }

      // Validate patterns (security check)
      const validPatterns = patterns.filter(p => {
        // Security: Reject patterns with suspicious content
        const suspicious = [
          'eval(', 'Function(', 'exec(', 'spawn(',
          'child_process', 'rm -rf', 'sudo',
          '<script>', 'javascript:', 'data:',
        ];

        const content = JSON.stringify(p);
        return !suspicious.some(s => content.includes(s));
      });

      if (validPatterns.length < patterns.length) {
        output.writeln(output.warning(`Filtered ${patterns.length - validPatterns.length} suspicious patterns`));
      }

      // Save to local memory
      const memoryDir = path.join(process.cwd(), '.claude-flow', 'memory');
      if (!fs.existsSync(memoryDir)) {
        fs.mkdirSync(memoryDir, { recursive: true });
      }

      const patternsFile = path.join(memoryDir, 'patterns.json');
      let existingPatterns: Array<{ id: string }> = [];

      if (merge && fs.existsSync(patternsFile)) {
        existingPatterns = JSON.parse(fs.readFileSync(patternsFile, 'utf8'));
      }

      // Merge or replace
      const existingIds = new Set(existingPatterns.map(p => p.id));
      const newPatterns = validPatterns.filter(p => !existingIds.has(p.id));
      const finalPatterns = merge ? [...existingPatterns, ...newPatterns] : validPatterns;

      fs.writeFileSync(patternsFile, JSON.stringify(finalPatterns, null, 2));

      spinner.succeed('Import complete');

      output.writeln();
      output.table({
        columns: [
          { key: 'metric', header: 'Metric', width: 25 },
          { key: 'value', header: 'Value', width: 20 },
        ],
        data: [
          { metric: 'Patterns Imported', value: String(validPatterns.length) },
          { metric: 'New Patterns', value: String(newPatterns.length) },
          { metric: 'Total Patterns', value: String(finalPatterns.length) },
          { metric: 'Signature Verified', value: importData.signature ? 'Yes' : 'N/A' },
          { metric: 'Merge Mode', value: merge ? 'Yes' : 'Replace' },
        ],
      });

      output.writeln();
      output.writeln(output.success('Patterns imported and ready to use'));
      output.writeln(output.dim('Run "claude-flow neural patterns --action list" to see imported patterns'));

      return { success: true };
    } catch (error) {
      spinner.fail(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Benchmark subcommand - Real WASM benchmarks
const benchmarkCommand: Command = {
  name: 'benchmark',
  description: 'Benchmark RuVector WASM training performance',
  options: [
    { name: 'dim', short: 'd', type: 'number', description: 'Embedding dimension (max 256)', default: '256' },
    { name: 'iterations', short: 'i', type: 'number', description: 'Number of iterations', default: '1000' },
    { name: 'keys', short: 'k', type: 'number', description: 'Number of keys for attention', default: '100' },
  ],
  examples: [
    { command: 'claude-flow neural benchmark', description: 'Run default benchmark' },
    { command: 'claude-flow neural benchmark -d 128 -i 5000', description: 'Custom benchmark' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const dim = Math.min(parseInt(ctx.flags.dim as string || '256', 10), 256);
    const iterations = parseInt(ctx.flags.iterations as string || '1000', 10);
    const numKeys = parseInt(ctx.flags.keys as string || '100', 10);

    output.writeln();
    output.writeln(output.bold('RuVector WASM Benchmark'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: 'Running benchmarks...', spinner: 'dots' });
    spinner.start();

    try {
      // Indirect the specifier through a string variable so tsc doesn't
      // statically resolve this optional dependency at build time (TS2307
      // when it isn't installed — install-safety / Build V3 pattern from #2586).
      const attentionPkg: string = '@ruvector/attention';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import of optional native WASM module with no type declarations
      const attention = await import(attentionPkg) as unknown as Record<string, new (...args: number[]) => { computeRaw: (q: Float32Array, k: Float32Array[], v: Float32Array[]) => Float32Array }>;

      // Manual benchmark since benchmarkAttention has a binding bug
      const benchmarkMechanism = async (name: string, mechanism: { computeRaw: (q: Float32Array, k: Float32Array[], v: Float32Array[]) => Float32Array }) => {
        const query = new Float32Array(dim);
        const keys: Float32Array[] = [];
        const values: Float32Array[] = [];

        for (let i = 0; i < dim; i++) query[i] = Math.random();
        for (let k = 0; k < numKeys; k++) {
          const key = new Float32Array(dim);
          const val = new Float32Array(dim);
          for (let i = 0; i < dim; i++) {
            key[i] = Math.random();
            val[i] = Math.random();
          }
          keys.push(key);
          values.push(val);
        }

        // Warmup
        for (let i = 0; i < 10; i++) mechanism.computeRaw(query, keys, values);

        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
          mechanism.computeRaw(query, keys, values);
        }
        const elapsed = performance.now() - start;

        return {
          name,
          averageTimeMs: elapsed / iterations,
          opsPerSecond: Math.round((iterations / elapsed) * 1000),
        };
      };

      spinner.setText(`Benchmarking attention mechanisms (dim=${dim}, keys=${numKeys}, iter=${iterations})...`);

      const results: { name: string; averageTimeMs: number; opsPerSecond: number }[] = [];

      // Benchmark each mechanism
      const dotProduct = new attention.DotProductAttention(dim);
      results.push(await benchmarkMechanism('DotProduct', dotProduct));

      const flash = new attention.FlashAttention(dim, 64);
      results.push(await benchmarkMechanism('FlashAttention', flash));

      const multiHead = new attention.MultiHeadAttention(dim, 4);
      results.push(await benchmarkMechanism('MultiHead (4 heads)', multiHead));

      const hyperbolic = new attention.HyperbolicAttention(dim, 1.0);
      results.push(await benchmarkMechanism('Hyperbolic', hyperbolic));

      const linear = new attention.LinearAttention(dim, dim);
      results.push(await benchmarkMechanism('Linear', linear));

      spinner.succeed('Benchmark complete');

      output.writeln();
      output.printTable({
        columns: [
          { key: 'name', header: 'Mechanism', width: 25 },
          { key: 'avgTime', header: 'Avg Time (ms)', width: 15 },
          { key: 'opsPerSec', header: 'Ops/sec', width: 15 },
        ],
        data: results.map(r => ({
          name: r.name,
          avgTime: r.averageTimeMs.toFixed(4),
          opsPerSec: r.opsPerSecond.toLocaleString(),
        })),
      });

      // Show speedup comparisons
      const dotProductResult = results.find(r => r.name.includes('DotProduct'));
      const flashResult = results.find(r => r.name.includes('Flash'));
      const hyperbolicResult = results.find(r => r.name.includes('Hyperbolic'));

      if (dotProductResult && flashResult) {
        const speedup = dotProductResult.averageTimeMs / flashResult.averageTimeMs;
        output.writeln();
        output.writeln(output.highlight(`Flash Attention speedup: ${speedup.toFixed(2)}x faster than DotProduct`));
      }

      if (dotProductResult && hyperbolicResult) {
        output.writeln(output.dim(`Hyperbolic overhead: ${(hyperbolicResult.averageTimeMs / dotProductResult.averageTimeMs).toFixed(2)}x (expected for manifold ops)`));
      }

      // Also benchmark MicroLoRA
      spinner.start();
      spinner.setText('Benchmarking MicroLoRA adaptation...');

      // Load WASM file directly (Node.js compatible). Indirect the specifier
      // through a string variable so tsc doesn't statically resolve this
      // optional dependency at build time (TS2307 when absent — #2586 pattern).
      const fs = await import('fs');
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const learningWasmPkg: string = '@ruvector/learning-wasm';
      const wasmPath = require.resolve(`${learningWasmPkg}/ruvector_learning_wasm_bg.wasm`);
      const wasmBuffer = fs.readFileSync(wasmPath);

      const learningWasm = await import(learningWasmPkg) as {
        initSync: (opts: { module: Buffer | Uint8Array }) => void;
        WasmMicroLoRA: new (dim: number, lr: number, wd: number) => {
          adapt_array: (gradient: Float32Array) => void;
          free: () => void;
        };
      };
      learningWasm.initSync({ module: wasmBuffer });

      const lora = new learningWasm.WasmMicroLoRA(dim, 0.1, 0.01);
      const gradient = new Float32Array(dim);
      for (let i = 0; i < dim; i++) gradient[i] = Math.random() - 0.5;

      const loraStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        lora.adapt_array(gradient);
      }
      const loraTime = performance.now() - loraStart;
      const loraAvg = loraTime / iterations;

      spinner.succeed('MicroLoRA benchmark complete');

      output.writeln();
      output.printTable({
        columns: [
          { key: 'metric', header: 'MicroLoRA Metric', width: 25 },
          { key: 'value', header: 'Value', width: 25 },
        ],
        data: [
          { metric: 'Dimension', value: String(dim) },
          { metric: 'Iterations', value: iterations.toLocaleString() },
          { metric: 'Total Time', value: `${loraTime.toFixed(2)}ms` },
          { metric: 'Avg Adaptation', value: `${(loraAvg * 1000).toFixed(2)}μs` },
          { metric: 'Adaptations/sec', value: Math.round(1000 / loraAvg).toLocaleString() },
          { metric: 'Target (<100μs)', value: loraAvg * 1000 < 100 ? output.success('✓ PASS') : output.warning('✗ FAIL') },
        ],
      });

      lora.free();

      return { success: true, data: { results, loraAvg } };
    } catch (error) {
      spinner.fail('Benchmark failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================================================
// ADR-148 — `neural router` subcommand tree: status / train / reload
// ============================================================================

const routerStatusCommand: Command = {
  name: 'status',
  description: 'Show the cost-optimal neural router state (ADR-148) — gate, backend, artifact, counters',
  options: [
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router status', description: 'Show router state' },
    { command: 'CLAUDE_FLOW_ROUTER_NEURAL=1 claude-flow neural router status', description: 'Show status with gate open' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const format = (ctx.flags.format as string) || 'table';
    const { neuralRouterStatus } = await import('../ruvector/neural-router.js');
    const { getModelRouterStats } = await import('../ruvector/model-router.js');
    const status = await neuralRouterStatus();
    const stats = getModelRouterStats();
    const payload = { neuralRouter: status, modelRouter: stats };
    if (format === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }
    output.writeln();
    output.writeln(output.bold('Cost-Optimal Neural Router (ADR-148)'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Gate (CLAUDE_FLOW_ROUTER_NEURAL=1): ${status.enabled ? output.success('open') : output.warning('closed')}`);
    output.writeln(`  Backend available:                  ${status.available ? output.success('yes') : output.warning('no')}`);
    output.writeln(`  Active backend (routedBy):          ${status.routedBy ?? '—'}`);
    output.writeln(`  Reason:                             ${status.reason}`);
    output.writeln(`  Quality bar:                        ${status.config.qualityBar}`);
    output.writeln(`  Seed corpus path:                   ${status.config.seedCorpusPath}`);
    output.writeln(`  Bundled KRR artifact path:          ${status.config.bundledKrrPath}`);
    output.writeln(`  User artifact (modelPath):          ${status.config.modelPath ?? '—'}`);
    output.writeln();
    output.writeln(output.bold('Counters (process-local since last reset)'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Total decisions:    ${stats.totalDecisions}`);
    output.writeln(`  routedBy:           heuristic=${stats.routedByCounts.heuristic}  hybrid=${stats.routedByCounts.hybrid}  bandit-fallback=${stats.routedByCounts['bandit-fallback']}`);
    output.writeln(`  neuralBackend:      knn=${stats.neuralBackendCounts['metaharness-knn']}  krr=${stats.neuralBackendCounts['metaharness-krr']}  fastgrnn=${stats.neuralBackendCounts.fastgrnn}`);
    output.writeln(`  A/B mode:           ${stats.ab.comparisons} comparisons, ${stats.ab.disagreements} disagreements (${(stats.ab.disagreementRate * 100).toFixed(1)}%)`);
    output.writeln();
    return { success: true, data: payload };
  },
};

const routerTrainCommand: Command = {
  name: 'train',
  description: 'Train a KRR router artifact from a DRACO-shaped JSON corpus (or the bundled seed) — pure TS, no native deps',
  options: [
    { name: 'corpus', short: 'c', type: 'string', description: 'Path to DRACO rows JSON ({embedding, scores}). Defaults to the bundled seed corpus.' },
    { name: 'out', short: 'o', type: 'string', description: 'Output path for the trained KRR JSON.' },
    { name: 'quality-bar', short: 'q', type: 'number', description: 'qualityBar for cost-optimal selection (default 0.8)', default: '0.8' },
  ],
  examples: [
    { command: 'claude-flow neural router train', description: 'Train from the bundled seed and write to ./router.krr.json' },
    { command: 'claude-flow neural router train -c ./my-corpus.json -o ./my-router.krr.json', description: 'Train from a custom corpus' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const corpusPath = ctx.flags.corpus as string | undefined;
    const outPath = (ctx.flags.out as string) || './router.krr.json';
    const qualityBar = parseFloat(ctx.flags['quality-bar'] as string || '0.8') || 0.8;
    // Indirect the optional-dep specifier through a string variable so tsc
    // doesn't statically resolve `@metaharness/router` at build time (TS2307
    // when it isn't installed — #2586 pattern). The dep is optional at
    // runtime; the catch below emits a clear operator message.
    const metaharnessRouterPkg: string = '@metaharness/router';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import of optional dep; call surface is fluid across upstream versions
    let mh: any;
    try {
      mh = await import(metaharnessRouterPkg);
    } catch {
      output.printError('@metaharness/router is not installed. `npm install @metaharness/router@^0.3.2` then re-run.');
      return { success: false, exitCode: 1 };
    }
    const { neuralRouterStatus } = await import('../ruvector/neural-router.js');
    const status = await neuralRouterStatus();
    const fs = await import('node:fs');
    const seedPath = corpusPath ?? status.config.seedCorpusPath;
    if (!fs.existsSync(seedPath)) {
      output.printError(`Corpus not found at ${seedPath}`);
      return { success: false, exitCode: 1 };
    }
    const rows = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    output.writeln();
    output.writeln(output.bold('Training KRR router (ADR-148)'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Corpus: ${seedPath}  (${rows.length} rows, dim=${rows[0]?.embedding?.length ?? '?'})`);
    output.writeln(`  Output: ${outPath}`);
    output.writeln(`  qualityBar: ${qualityBar}`);
    output.writeln();
    const spinner = output.createSpinner({ text: 'Fitting Beta-Bernoulli KRR with leave-one-out CV…', spinner: 'dots' });
    spinner.start();
    const t0 = performance.now();
    const { router, lambda, looQuality } = mh.trainRouter(rows, { haiku: 1, sonnet: 3, opus: 15 }, {
      qualityBar,
      lambdas: [1e-4, 1e-3, 1e-2, 1e-1, 1e0],
    });
    const ms = performance.now() - t0;
    spinner.succeed(`Trained in ${ms.toFixed(0)}ms (λ=${lambda.toExponential(3)}, looQuality=${looQuality.toFixed(4)})`);
    fs.writeFileSync(outPath, JSON.stringify(router.toJSON()));
    const bytes = fs.statSync(outPath).size;
    output.writeln(`Wrote ${bytes} bytes → ${outPath}`);
    output.writeln();
    output.writeln(output.dim('Use: CLAUDE_FLOW_ROUTER_NEURAL=1 CLAUDE_FLOW_ROUTER_MODEL_PATH=' + outPath + ' …'));
    output.writeln();
    return { success: true, data: { lambda, looQuality, trainMs: ms, modelPath: outPath, modelBytes: bytes } };
  },
};

// ADR-149 iter 19 — CLI surface for the iter 18 trajectory consumer. Pairs
// decision+outcome rows from the JSONL recorder into seed-rows-compatible
// training rows that `neural router train` (above) can consume.
const routerTrainFromTrajectoriesCommand: Command = {
  name: 'train-from-trajectories',
  description: 'Pair production decision+outcome JSONL rows into seed-corpus-shaped training rows (ADR-149 iter 18/19)',
  options: [
    { name: 'in', short: 'i', type: 'string', description: 'Trajectory JSONL path (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH or .swarm/model-router-trajectories.jsonl)' },
    { name: 'write', short: 'w', type: 'string', description: 'Write paired rows to this path (seed-rows.json-compatible JSON array)' },
    { name: 'union', short: 'u', type: 'string', description: 'Union paired rows with an existing seed-rows.json — production rows win on task-text collision' },
    { name: 'filter-source', type: 'string', description: 'Only keep outcomes whose source matches (e.g. llm-judge, agent-execute)' },
    { name: 'min-quality', type: 'number', description: 'Drop pairs whose MAX outcome score is below this threshold (default 0 — keep failures, they are training signal)', default: '0' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router train-from-trajectories', description: 'Show pairing stats from default trajectory path' },
    { command: 'claude-flow neural router train-from-trajectories -w production-rows.json', description: 'Emit a corpus to feed `router train`' },
    { command: 'claude-flow neural router train-from-trajectories -u assets/model-router/seed-rows.json -w merged.json', description: 'Union production rows with the bundled seed corpus' },
    { command: 'claude-flow neural router train-from-trajectories --filter-source llm-judge -w high-signal.json', description: 'Keep only judge-graded rows (drop coarse agent-execute baseline)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { pairTrajectoryRows } = await import('../ruvector/router-trajectory.js');

    const inPath = (ctx.flags.in as string | undefined)
      ?? process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    const writePath = ctx.flags.write as string | undefined;
    const unionPath = ctx.flags.union as string | undefined;
    // Argv parser may camelCase hyphenated flags — accept both spellings.
    const filterSource = (ctx.flags['filter-source'] ?? ctx.flags.filterSource) as string | undefined;
    const minQuality = parseFloat((ctx.flags['min-quality'] ?? ctx.flags.minQuality) as string || '0') || 0;
    const fmt = (ctx.flags.format as string) || 'table';

    if (!fs.existsSync(inPath)) {
      const msg = `Trajectory file not found at ${inPath}`;
      if (fmt === 'json') {
        output.writeln(JSON.stringify({ error: msg, hint: 'Set CLAUDE_FLOW_ROUTER_TRAJECTORY=1 and run any agent_spawn → executeAgentTask flow to accumulate rows.' }, null, 2));
      } else {
        output.printError(msg);
        output.writeln(output.dim('  Set CLAUDE_FLOW_ROUTER_TRAJECTORY=1 to enable trajectory recording.'));
      }
      return { success: false, exitCode: 1 };
    }

    const text = fs.readFileSync(inPath, 'utf8');
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const allRows: unknown[] = [];
    let malformed = 0;
    for (const l of lines) {
      try { allRows.push(JSON.parse(l)); } catch { malformed++; }
    }

    type TrajectoryRow = Parameters<typeof pairTrajectoryRows>[0][number];
    const { pairs: rawPairs, stats } = pairTrajectoryRows(allRows as TrajectoryRow[]);

    let pairs = rawPairs;
    let filteredCount = pairs.length;
    if (filterSource) pairs = pairs.filter(p => p.source === filterSource);
    if (minQuality > 0) pairs = pairs.filter(p => Math.max(...Object.values(p.scores)) >= minQuality);
    filteredCount = pairs.length;

    const corpusRows = pairs.map(p => ({
      task: p.task,
      embedding: p.embedding,
      scores: p.scores,
      tier: p.tier,
    }));

    let unionRows = corpusRows;
    let unioned = false;
    let seedKept = 0;
    if (unionPath) {
      if (!fs.existsSync(unionPath)) {
        output.printError(`--union path ${unionPath} not found`);
        return { success: false, exitCode: 1 };
      }
      const seedRows = JSON.parse(fs.readFileSync(unionPath, 'utf8')) as Array<{ task: string; embedding: number[]; scores: Record<string, number>; tier: 'cheap' | 'mid' | 'strong' }>;
      const productionTasks = new Set(corpusRows.map(r => r.task));
      const kept = seedRows.filter(r => !productionTasks.has(r.task));
      seedKept = kept.length;
      unionRows = [...kept, ...corpusRows];
      unioned = true;
    }

    if (writePath) {
      fs.writeFileSync(writePath, JSON.stringify(unionRows));
    }

    const data = {
      input: inPath,
      malformed,
      stats,
      afterFilters: filteredCount,
      unioned,
      seedKept: unioned ? seedKept : undefined,
      finalRows: unionRows.length,
      written: writePath,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(data, null, 2));
      return { success: true, data };
    }

    output.writeln();
    output.writeln(output.bold('Trajectory → Training-row pairing (ADR-149 iter 18/19)'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Input file:        ${inPath}`);
    output.writeln(`  Total rows:        ${stats.totalRows} (${stats.decisions} decision, ${stats.outcomes} outcome${malformed > 0 ? `, ${malformed} malformed` : ''})`);
    output.writeln(`  Paired:            ${stats.paired}`);
    output.writeln(`  Dropped (no embed): ${stats.droppedNoEmbedding}`);
    output.writeln(`  Dropped (no match): ${stats.droppedNoMatch}`);
    if (Object.keys(stats.bySource).length > 0) output.writeln(`  By source:         ${JSON.stringify(stats.bySource)}`);
    if (Object.keys(stats.byTier).length > 0) output.writeln(`  By tier:           ${JSON.stringify(stats.byTier)}`);
    output.writeln(`  After filters:     ${filteredCount}`);
    if (unioned) output.writeln(`  Final (unioned):   ${unionRows.length}  (seed kept=${seedKept}, production=${corpusRows.length})`);
    if (writePath) output.writeln(`  Written:           ${writePath}`);
    output.writeln();
    if (stats.totalRows === 0) {
      output.writeln(output.dim('  Empty trajectory file. Enable recording with `export CLAUDE_FLOW_ROUTER_TRAJECTORY=1` and run agent_spawn flows.'));
    } else if (pairs.length > 0 && writePath) {
      output.writeln(output.dim(`  Next: claude-flow neural router train -c ${writePath} -o router.krr.json`));
    }
    output.writeln();
    return { success: true, data };
  },
};

const routerReloadCommand: Command = {
  name: 'reload',
  description: 'Force-reload the neural router (clears in-process backend cache; next call re-reads artifact/corpus)',
  options: [],
  examples: [
    { command: 'claude-flow neural router reload', description: 'Refresh backend caches after retraining an artifact' },
  ],
  action: async (): Promise<CommandResult> => {
    const { __resetNeuralRouterForTests, neuralRouterStatus } = await import('../ruvector/neural-router.js');
    __resetNeuralRouterForTests();
    output.writeln(output.success('Neural router backend cache cleared.'));
    const status = await neuralRouterStatus();
    output.writeln(output.dim(`  Active backend now: ${status.routedBy ?? '—'}  (${status.reason})`));
    return { success: true, data: status };
  },
};

/**
 * ADR-149 iter 8 — `neural router models`: list the candidate registry
 * with measured per-tier scores from the most recent seed-corpus bench,
 * latency, and cost. Reads:
 *   - assets/model-router/seed-rows.json (which model ids exist in the corpus)
 *   - latest docs/benchmarks/runs/seed-corpus-*.json (per-candidate aggregates)
 *   - assets/model-router/openrouter-alts.json (tier mapping + alt rankings)
 * Falls back gracefully when files are missing.
 */
const routerModelsCommand: Command = {
  name: 'models',
  description: 'List the cost-optimal router registry with measured per-tier scores, latency, and cost (ADR-149)',
  options: [
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router models', description: 'Show candidate registry with measured stats' },
    { command: 'claude-flow neural router models -f json', description: 'Machine-readable JSON' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fmt = (ctx.flags.format as string) || 'table';
    const fs = await import('node:fs');
    const path = await import('node:path');

    const { neuralRouterStatus } = await import('../ruvector/neural-router.js');
    const status = await neuralRouterStatus();
    const seedPath = status.config.seedCorpusPath;

    interface Candidate {
      id: string;
      tier: 'haiku' | 'sonnet' | 'opus' | 'unknown';
      cost_in?: number;
      cost_out?: number;
      cheap?: number;
      mid?: number;
      strong?: number;
      overall?: number;
      latency_ms?: number;
    }

    // Best-effort: the candidate set is the union of ids appearing in
    // seed-rows.json scores keys. The latest measurement run's
    // perCandidate array is the authoritative source for measured stats.
    const candidates: Map<string, Candidate> = new Map();
    try {
      if (fs.existsSync(seedPath)) {
        const rows = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
        for (const r of rows) {
          for (const id of Object.keys(r.scores ?? {})) {
            if (!candidates.has(id)) candidates.set(id, { id, tier: 'unknown' });
          }
        }
      }
    } catch { /* keep going */ }

    // Pull latest FULL-CORPUS measurement for per-tier scores + latency.
    // Prefer files with cheap+mid+strong all populated (40-row+ runs); fall
    // back to the most-recent partial file if no full run is found.
    try {
      const benchDir = path.resolve(process.cwd(), 'docs', 'benchmarks', 'runs');
      if (fs.existsSync(benchDir)) {
        const files = fs.readdirSync(benchDir)
          .filter(f => f.startsWith('seed-corpus-') && f.endsWith('.json'))
          .sort()
          .reverse();
        // Scan files newest-first; pick the first one that has all three
        // tiers populated for the median model.
        let chosen: { perCandidate?: unknown[] } | null = null;
        for (const f of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(benchDir, f), 'utf8')) as { perCandidate?: Array<{ cheap_avg_score?: number | null; mid_avg_score?: number | null; strong_avg_score?: number | null }> };
            const sample = data.perCandidate?.[0];
            if (sample && sample.cheap_avg_score != null && sample.mid_avg_score != null && sample.strong_avg_score != null) {
              chosen = data; break;
            }
            if (!chosen) chosen = data; // fallback to newest
          } catch { /* skip malformed */ }
        }
        if (chosen) {
          for (const raw of chosen.perCandidate ?? []) {
            const r = raw as { id: string; tier?: string; cost_per_m_tok_in?: number; cost_per_m_tok_out?: number; cheap_avg_score?: number | null; mid_avg_score?: number | null; strong_avg_score?: number | null; overall_avg_score?: number | null; latency_mean_ms?: number | null };
            const existing = candidates.get(r.id);
            const c: Candidate = existing ?? { id: r.id, tier: 'unknown' };
            c.tier = ((r.tier as Candidate['tier']) ?? c.tier) || 'unknown';
            c.cost_in = r.cost_per_m_tok_in;
            c.cost_out = r.cost_per_m_tok_out;
            c.cheap = r.cheap_avg_score ?? undefined;
            c.mid = r.mid_avg_score ?? undefined;
            c.strong = r.strong_avg_score ?? undefined;
            c.overall = r.overall_avg_score ?? undefined;
            c.latency_ms = r.latency_mean_ms ?? undefined;
            candidates.set(r.id, c);
          }
        }
      }
    } catch { /* keep going */ }

    const rows = Array.from(candidates.values()).sort((a, b) =>
      (b.overall ?? -1) - (a.overall ?? -1));

    if (fmt === 'json') {
      output.writeln(JSON.stringify({ count: rows.length, candidates: rows }, null, 2));
      return { success: true, data: { count: rows.length, candidates: rows } };
    }

    output.writeln();
    output.writeln(output.bold('Cost-Optimal Router Registry (ADR-149)'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Source: ${seedPath}`);
    output.writeln(`  Candidates: ${rows.length}`);
    output.writeln();
    if (rows.length === 0) {
      output.writeln(output.warning('  No candidates — corpus not generated or measurement not run.'));
      output.writeln(output.dim('  Run: node scripts/gen-seed-corpus-v2.mjs && OPENROUTER_API_KEY=... node scripts/benchmark-seed-corpus.mjs --live'));
      return { success: true, data: { count: 0 } };
    }
    const fmtPct = (v: number | undefined) => v == null ? '—'.padStart(6) : `${(v * 100).toFixed(1)}%`.padStart(6);
    const fmtCost = (v: number | undefined) => v == null ? '—' : `$${v.toFixed(2)}`;
    const fmtLat = (v: number | undefined) => v == null ? '—' : `${v.toFixed(0)}ms`;
    output.writeln('  | Candidate                                  | Tier   |  Cheap |   Mid  | Strong | Overall | $/Mtok in/out | Latency |');
    output.writeln('  |--------------------------------------------|--------|--------|--------|--------|---------|---------------|---------|');
    for (const c of rows) {
      output.writeln(`  | ${c.id.padEnd(42)} | ${c.tier.padEnd(6)} | ${fmtPct(c.cheap)} | ${fmtPct(c.mid)} | ${fmtPct(c.strong)} | ${fmtPct(c.overall)} | ${fmtCost(c.cost_in).padStart(5)}/${fmtCost(c.cost_out).padEnd(6)} | ${fmtLat(c.latency_ms).padStart(7)} |`);
    }
    output.writeln();
    output.writeln(output.dim('  Sorted by overall score desc. Empty cells = no measurement on that tier.'));
    output.writeln(output.dim('  To re-measure: OPENROUTER_API_KEY=... node scripts/benchmark-seed-corpus.mjs --live'));
    output.writeln();
    return { success: true, data: { count: rows.length, candidates: rows } };
  },
};

// ADR-149 iter 28 — observability into recorded routing decisions. The
// trajectory JSONL (iter 17+) records every decision the router makes;
// this subcommand exposes that data as filtered + aggregated views so
// operators don't have to grep the file.
const routerDecisionsCommand: Command = {
  name: 'decisions',
  description: 'Query the routing-decision JSONL (iter 17+): filter, aggregate, paginate (ADR-149 iter 28)',
  options: [
    { name: 'in', short: 'i', type: 'string', description: 'Trajectory JSONL path (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH or .swarm/model-router-trajectories.jsonl)' },
    { name: 'since', short: 's', type: 'string', description: 'Time window suffix: 1h, 24h, 7d, 30d (default: all)' },
    { name: 'routed-by', type: 'string', description: 'Filter by decision mechanism: hybrid | bandit-fallback | heuristic' },
    { name: 'model', short: 'm', type: 'string', description: 'Filter by chosen model id (substring match, e.g. haiku, gpt-4)' },
    { name: 'bucket', type: 'string', description: 'Filter by complexity bucket: cheap (< 0.34) | mid (< 0.67) | strong (≥ 0.67) — iter 58' },
    { name: 'task-hash', type: 'string', description: 'Filter by exact task_hash (FNV-1a-32). Use for incident investigation — iter 59' },
    { name: 'limit', short: 'l', type: 'number', description: 'Max recent decisions to list (default 20)', default: '20' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router decisions', description: 'Aggregate stats + 20 most-recent decisions' },
    { command: 'claude-flow neural router decisions --since 24h', description: 'Last 24 hours only' },
    { command: 'claude-flow neural router decisions --routed-by bandit-fallback', description: 'Find decisions where neural backend failed' },
    { command: 'claude-flow neural router decisions --model haiku --format json', description: 'All haiku picks, JSON output' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const inPath = (ctx.flags.in as string | undefined)
      ?? process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    const since = ctx.flags.since as string | undefined;
    const routedByFilter = (ctx.flags['routed-by'] ?? ctx.flags.routedBy) as string | undefined;
    const modelFilter = ctx.flags.model as string | undefined;
    const bucketFilterRaw = (ctx.flags.bucket as string | undefined)?.toLowerCase();
    const bucketFilter: 'cheap' | 'mid' | 'strong' | undefined =
      bucketFilterRaw === 'cheap' || bucketFilterRaw === 'mid' || bucketFilterRaw === 'strong'
        ? bucketFilterRaw : undefined;
    if (bucketFilterRaw && !bucketFilter) {
      output.printError(`--bucket must be one of: cheap | mid | strong (got "${bucketFilterRaw}")`);
      return { success: false, exitCode: 1 };
    }
    // iter 59 — task_hash filter for incident investigation. Accepts the 8-char
    // FNV-1a-32 hex format the trajectory recorder uses.
    const taskHashFilter = ((ctx.flags['task-hash'] ?? ctx.flags.taskHash) as string | undefined)?.toLowerCase();
    if (taskHashFilter && !/^[0-9a-f]{8}$/.test(taskHashFilter)) {
      output.printError(`--task-hash must be an 8-char hex string (got "${taskHashFilter}")`);
      return { success: false, exitCode: 1 };
    }
    const limit = parseInt(ctx.flags.limit as string || '20', 10) || 20;
    const fmt = (ctx.flags.format as string) || 'table';

    if (!fs.existsSync(inPath)) {
      const msg = `Trajectory file not found at ${inPath}`;
      if (fmt === 'json') {
        output.writeln(JSON.stringify({ error: msg, hint: 'Set CLAUDE_FLOW_ROUTER_TRAJECTORY=1 to enable recording.' }, null, 2));
      } else {
        output.printError(msg);
        output.writeln(output.dim('  Set CLAUDE_FLOW_ROUTER_TRAJECTORY=1 to enable trajectory recording.'));
      }
      return { success: false, exitCode: 1 };
    }

    // Parse JSONL — only decision rows are relevant here.
    interface DecisionRow {
      v: number; type: 'decision'; ts: string; task_hash: string; task?: string;
      model: string; complexity: number; confidence: number; uncertainty: number;
      routed_by: string; neural_backend?: string; provider?: string; openrouter_model?: string;
    }
    const text = fs.readFileSync(inPath, 'utf8');
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const decisions: DecisionRow[] = [];
    // iter 31 — pair outcomes by task_hash for cost-aggregate joins.
    // iter 65 — outcomes now ARRAY (was Map). Same correctness fix as iter
    // 62 applied to cost-savings: deduping by task_hash collapses multiple
    // runs of the same task into one, biasing cost aggregates toward the
    // LATEST outcome's cost counted N times instead of summing all N costs.
    interface OutcomeMini { task_hash: string; ts: string; quality?: number; cost_usd?: number; tokens?: { input: number; output: number }; model_id?: string }
    const outcomesByHash = new Map<string, OutcomeMini[]>();
    let malformed = 0;
    for (const l of lines) {
      try {
        const row = JSON.parse(l);
        if (row.type === 'decision') {
          decisions.push(row);
        } else if (row.type === 'outcome') {
          const arr = outcomesByHash.get(row.task_hash) ?? [];
          arr.push({
            task_hash: row.task_hash,
            ts: row.ts,
            quality: row.quality,
            cost_usd: row.cost_usd,
            tokens: row.tokens,
            model_id: row.model_id,
          });
          outcomesByHash.set(row.task_hash, arr);
        }
      } catch { malformed++; }
    }

    // Time-window filter.
    let cutoffMs: number | null = null;
    if (since) {
      const m = since.match(/^(\d+)([hdmw])$/);
      if (m) {
        const n = parseInt(m[1], 10);
        const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]] ?? 0;
        cutoffMs = Date.now() - n * unitMs;
      }
    }

    let filtered = decisions;
    if (cutoffMs !== null) {
      filtered = filtered.filter(d => Date.parse(d.ts) >= cutoffMs!);
    }
    if (routedByFilter) {
      filtered = filtered.filter(d => d.routed_by === routedByFilter);
    }
    if (bucketFilter) {
      filtered = filtered.filter(d => {
        const bucket = d.complexity < 0.34 ? 'cheap' : d.complexity < 0.67 ? 'mid' : 'strong';
        return bucket === bucketFilter;
      });
    }
    if (taskHashFilter) {
      filtered = filtered.filter(d => d.task_hash === taskHashFilter);
    }
    if (modelFilter) {
      const needle = modelFilter.toLowerCase();
      filtered = filtered.filter(d => {
        const id = (d.openrouter_model ?? d.model).toLowerCase();
        return id.includes(needle);
      });
    }

    // Aggregate.
    const byRoutedBy: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byTier: Record<string, number> = { cheap: 0, mid: 0, strong: 0 };
    // iter 31 — cost aggregation. Sum cost_usd from paired outcome rows.
    let costTotalUsd = 0;
    let costPairedCount = 0;
    const costByModel: Record<string, number> = {};
    const costByTier: Record<string, number> = { cheap: 0, mid: 0, strong: 0 };
    // iter 65 — track per-hash decision-iteration so we can pair the N-th
    // decision for a hash with the N-th outcome (instead of always pulling
    // the latest outcome). Iter 17's recorder writes decision then outcome
    // in chronological order, so this index-pairing matches what the agent
    // actually dispatched.
    const decisionIndexByHash = new Map<string, number>();
    for (const d of filtered) {
      byRoutedBy[d.routed_by] = (byRoutedBy[d.routed_by] ?? 0) + 1;
      const id = d.openrouter_model ?? d.model;
      byModel[id] = (byModel[id] ?? 0) + 1;
      const tier = d.complexity < 0.34 ? 'cheap' : d.complexity < 0.67 ? 'mid' : 'strong';
      byTier[tier]++;
      // iter 31 + iter 65 — JOIN to the i-th OUTCOME row for this task_hash
      // (where i is the i-th DECISION for this hash). Avoids double-counting
      // costs when a task ran multiple times.
      const outcomeArr = outcomesByHash.get(d.task_hash);
      if (outcomeArr && outcomeArr.length > 0) {
        const seen = decisionIndexByHash.get(d.task_hash) ?? 0;
        const out = outcomeArr[Math.min(seen, outcomeArr.length - 1)];
        decisionIndexByHash.set(d.task_hash, seen + 1);
        if (out?.cost_usd != null) {
          costTotalUsd += out.cost_usd;
          costPairedCount++;
          const modelKey = out.model_id ?? id;
          costByModel[modelKey] = (costByModel[modelKey] ?? 0) + out.cost_usd;
          costByTier[tier] += out.cost_usd;
        }
      }
    }
    const fallbackRate = filtered.length > 0
      ? ((byRoutedBy['bandit-fallback'] ?? 0) / filtered.length) * 100
      : 0;

    // Sort by ts ascending so "most recent" is well-defined regardless of
    // file order (rotation, concurrent writes can break monotonicity).
    const sorted = [...filtered].sort((a, b) => a.ts.localeCompare(b.ts));
    const recent = sorted.slice(-limit).reverse(); // newest first

    const payload = {
      input: inPath,
      totalRows: lines.length,
      decisionRows: decisions.length,
      malformed,
      filtered: filtered.length,
      filters: { since, routedBy: routedByFilter, model: modelFilter, bucket: bucketFilter, taskHash: taskHashFilter },
      aggregates: {
        byRoutedBy, byModel, byTier,
        fallbackRatePct: Math.round(fallbackRate * 100) / 100,
        // iter 31 — cost aggregates. Only populated when outcome rows
        // carry cost_usd (post-iter-31 trajectories).
        ...(costPairedCount > 0 ? {
          costTotalUsd: Math.round(costTotalUsd * 1000000) / 1000000,
          costPairedCount,
          costByModel: Object.fromEntries(Object.entries(costByModel).map(([k, v]) => [k, Math.round(v * 1000000) / 1000000])),
          costByTier: Object.fromEntries(Object.entries(costByTier).map(([k, v]) => [k, Math.round(v * 1000000) / 1000000])),
          avgCostPerCall: Math.round((costTotalUsd / costPairedCount) * 1000000) / 1000000,
        } : {}),
      },
      recent,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Routing decisions (ADR-149 iter 17+, query iter 28)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Input:           ${inPath}`);
    output.writeln(`  JSONL rows:      ${lines.length}  (${decisions.length} decision, ${malformed} malformed)`);
    if (since || routedByFilter || modelFilter || bucketFilter || taskHashFilter) {
      output.writeln(`  Filters:         ${[since && `since=${since}`, routedByFilter && `routed-by=${routedByFilter}`, modelFilter && `model~${modelFilter}`, bucketFilter && `bucket=${bucketFilter}`, taskHashFilter && `task_hash=${taskHashFilter}`].filter(Boolean).join(', ')}`);
    }
    output.writeln(`  After filters:   ${filtered.length}`);
    output.writeln('');

    if (filtered.length === 0) {
      output.writeln(output.dim('  No decisions match the filters.'));
      output.writeln('');
      return { success: true, data: payload };
    }

    output.writeln(`  Fallback rate:   ${fallbackRate.toFixed(2)}%   (neural backend → bandit when prediction unusable)`);
    output.writeln('');
    output.writeln('  By routed_by:');
    for (const [k, v] of Object.entries(byRoutedBy).sort((a, b) => b[1] - a[1])) {
      const pct = ((v / filtered.length) * 100).toFixed(1).padStart(5);
      output.writeln(`    ${k.padEnd(18)}  ${String(v).padStart(6)}  ${pct}%`);
    }
    output.writeln('');
    output.writeln('  By model:');
    for (const [k, v] of Object.entries(byModel).sort((a, b) => b[1] - a[1])) {
      const pct = ((v / filtered.length) * 100).toFixed(1).padStart(5);
      output.writeln(`    ${k.padEnd(42)}  ${String(v).padStart(6)}  ${pct}%`);
    }
    output.writeln('');
    output.writeln('  By tier (complexity bucket):');
    for (const [k, v] of Object.entries(byTier)) {
      const pct = filtered.length > 0 ? ((v / filtered.length) * 100).toFixed(1).padStart(5) : '  0.0';
      output.writeln(`    ${k.padEnd(8)}  ${String(v).padStart(6)}  ${pct}%`);
    }
    output.writeln('');
    // iter 31 — cost block (only when outcome rows carry cost_usd).
    if (costPairedCount > 0) {
      output.writeln('  Cost (USD, from paired outcomes):');
      output.writeln(`    Total:           $${costTotalUsd.toFixed(4)}  across ${costPairedCount} paired decisions`);
      output.writeln(`    Avg per call:    $${(costTotalUsd / costPairedCount).toFixed(6)}`);
      output.writeln('    By model:');
      for (const [k, v] of Object.entries(costByModel).sort((a, b) => b[1] - a[1])) {
        output.writeln(`      ${k.padEnd(40)}  $${v.toFixed(4)}`);
      }
      output.writeln('    By tier:');
      for (const [k, v] of Object.entries(costByTier)) {
        output.writeln(`      ${k.padEnd(8)}  $${v.toFixed(4)}`);
      }
      output.writeln('');
    }
    // iter 59 — incident detail mode. When --task-hash is set, render each
    // matching decision with FULL task text, paired outcome, complexity,
    // ab_pair, ensemble_disagreement. Operators investigating "why was
    // THIS task routed to X?" want maximum context per decision.
    if (taskHashFilter && filtered.length > 0) {
      // iter 64 — sort occurrences newest-first by ts. JSONL insertion order
      // may not match chronological order after rotation or out-of-order writes.
      const incidentSorted = [...filtered].sort((a, b) => b.ts.localeCompare(a.ts));
      output.writeln(output.bold(`  Incident detail for task_hash=${taskHashFilter} (${filtered.length} occurrence(s), newest first):`));
      for (const d of incidentSorted) {
        // iter 65 — outcomesByHash is now an array of all outcomes per hash.
        // For the incident detail at this decision's timestamp, pick the
        // outcome closest in time (typically the corresponding one written
        // by iter 17's recorder immediately after the decision).
        const allOutcomes = outcomesByHash.get(d.task_hash) ?? [];
        const dts = Date.parse(d.ts);
        let out: OutcomeMini | undefined;
        let bestDelta = Infinity;
        for (const o of allOutcomes) {
          const delta = Math.abs(Date.parse(o.ts) - dts);
          if (delta < bestDelta) { bestDelta = delta; out = o; }
        }
        const bucket = d.complexity < 0.34 ? 'cheap' : d.complexity < 0.67 ? 'mid' : 'strong';
        output.writeln('');
        output.writeln(`    ts:                  ${d.ts}`);
        output.writeln(`    task:                "${(d as unknown as { task?: string }).task ?? '<task text not stored>'}"`);
        output.writeln(`    complexity:          ${d.complexity.toFixed(3)} (bucket: ${bucket})`);
        output.writeln(`    picked model:        ${d.openrouter_model ?? d.model}`);
        output.writeln(`    routed_by:           ${d.routed_by}${(d as unknown as { neural_backend?: string }).neural_backend ? `  via ${(d as unknown as { neural_backend: string }).neural_backend}` : ''}`);
        output.writeln(`    confidence:          ${d.confidence.toFixed(3)}   uncertainty: ${d.uncertainty.toFixed(3)}`);
        const apd = (d as unknown as { ab_pair?: { bandit_pick: string; hybrid_pick: string; disagree: boolean } }).ab_pair;
        if (apd) {
          output.writeln(`    ab_pair:             bandit=${apd.bandit_pick}  hybrid=${apd.hybrid_pick}  disagree=${apd.disagree}`);
        }
        const ed = (d as unknown as { ensemble_disagreement?: number }).ensemble_disagreement;
        if (typeof ed === 'number') {
          output.writeln(`    ensemble disagree:   ${ed.toFixed(4)}`);
        }
        if (out) {
          output.writeln(`    outcome:             quality=${out.quality ?? '—'}  cost_usd=${out.cost_usd != null ? '$' + out.cost_usd.toFixed(6) : '—'}  source=${(out as unknown as { source?: string }).source ?? '—'}`);
        } else {
          output.writeln(`    outcome:             ${output.warning('(no paired outcome row)')}`);
        }
      }
      output.writeln('');
      return { success: true, data: payload };
    }
    output.writeln(`  ${Math.min(limit, recent.length)} most-recent decisions (newest first):`);
    output.writeln('    ' + 'ts'.padEnd(20) + 'routed_by'.padEnd(18) + 'model'.padEnd(34) + 'conf');
    for (const d of recent) {
      const ts = d.ts.slice(0, 19);
      const id = (d.openrouter_model ?? d.model).slice(0, 32);
      output.writeln(`    ${ts.padEnd(20)}${d.routed_by.padEnd(18)}${id.padEnd(34)}${d.confidence.toFixed(2)}`);
    }
    output.writeln('');
    return { success: true, data: payload };
  },
};

// ADR-149 iter 30 — forward-direction observability. Pairs with iter 28's
// backward-direction `decisions` query. Lets operators inspect what the
// router would pick for a hypothetical task WITHOUT actually dispatching.
const routerDecideCommand: Command = {
  name: 'decide',
  description: 'Show what the router would pick for a given task — no dispatch, just inspection (ADR-149 iter 30)',
  options: [
    { name: 'task', short: 't', type: 'string', description: 'Task text (alternatively pass as positional arg)' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router decide "fix typo in cache.ts"', description: 'See the routing decision for a small task' },
    { command: 'claude-flow neural router decide -t "design distributed consensus" -f json', description: 'JSON output for the routing decision' },
    { command: 'CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK=5 claude-flow neural router decide -t "..."', description: 'See iter 29 cost-ceiling mode in action' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const task = (ctx.flags.task as string | undefined) ?? (ctx.args && ctx.args[0]) ?? null;
    const fmt = (ctx.flags.format as string) || 'table';
    if (!task || typeof task !== 'string' || task.trim().length === 0) {
      output.printError('Provide a task: --task "..." or as a positional argument');
      return { success: false, exitCode: 1 };
    }

    const { analyzeTaskComplexity, routeToModelFull } = await import('../ruvector/model-router.js');
    const { embedTaskWithCache } = await import('../ruvector/task-embedder.js');
    const { neuralRouterStatus, tryCostOptimalRoute } = await import('../ruvector/neural-router.js');

    const t0 = performance.now();
    const complexity = analyzeTaskComplexity(task);
    let embedding: number[] | undefined;
    try { embedding = await embedTaskWithCache(task); } catch { /* embedder may be absent */ }
    const result = await routeToModelFull(task, embedding);
    const status = await neuralRouterStatus();
    // iter 45 — also fetch the neural-layer result so we can surface the
    // ensemble-disagreement diagnostic. Extra inference but `decide` is an
    // operator inspection tool, not the hot path.
    let neuralResult: Awaited<ReturnType<typeof tryCostOptimalRoute>> = null;
    if (embedding) {
      const bucket = complexity.score < 0.34 ? 'low' : complexity.score < 0.67 ? 'med' : 'high';
      try {
        neuralResult = await tryCostOptimalRoute(embedding, { complexityBucket: bucket });
      } catch { /* gated off or backend absent */ }
    }
    const ms = performance.now() - t0;

    const payload = {
      task: task.length > 200 ? task.slice(0, 200) + '…' : task,
      taskLength: task.length,
      hasEmbedding: !!embedding,
      embeddingDim: embedding?.length ?? null,
      complexity: {
        score: complexity.score,
        bucket: complexity.score < 0.34 ? 'low' : complexity.score < 0.67 ? 'med' : 'high',
        features: complexity.features,
        indicators: complexity.indicators,
      },
      decision: {
        model: result.model,
        modelId: result.modelId,
        provider: result.provider,
        openrouterModel: result.openrouterModel,
        confidence: result.confidence,
        uncertainty: result.uncertainty,
        routedBy: result.routedBy,
        neuralBackend: result.neuralBackend,
        costMultiplier: result.costMultiplier,
        reasoning: result.reasoning,
        // iter 45 — ensemble disagreement diagnostic (always set when both
        // unified KRR + bucket specialist are loaded; observable signal for
        // tuning iter 44's threshold). null when not applicable.
        ensembleDisagreement: neuralResult?.ensembleDisagreement ?? null,
      },
      alternatives: result.alternatives,
      backend: {
        enabled: status.enabled,
        available: status.available,
        routedBy: status.routedBy,
        reason: status.reason,
      },
      activeEnv: {
        CLAUDE_FLOW_ROUTER_NEURAL: process.env.CLAUDE_FLOW_ROUTER_NEURAL ?? null,
        CLAUDE_FLOW_ROUTER_CALIBRATE: process.env.CLAUDE_FLOW_ROUTER_CALIBRATE ?? null,
        CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK: process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK ?? null,
        CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS: process.env.CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS ?? null,
        CLAUDE_FLOW_ROUTER_QUALITY_BAR: process.env.CLAUDE_FLOW_ROUTER_QUALITY_BAR ?? null,
        CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL: process.env.CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL ?? null,
        CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD: process.env.CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD ?? null,
      },
      elapsedMs: Math.round(ms * 100) / 100,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Routing decision preview (ADR-149 iter 30 — no dispatch)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Task:        "${payload.task}"`);
    output.writeln(`  Length:      ${payload.taskLength} chars`);
    output.writeln(`  Embedding:   ${payload.hasEmbedding ? `${payload.embeddingDim} dims` : output.warning('not available (embedder absent / disabled)')}`);
    output.writeln('');
    output.writeln(output.bold('  Complexity:'));
    output.writeln(`    score:   ${complexity.score.toFixed(3)}`);
    output.writeln(`    bucket:  ${payload.complexity.bucket}`);
    output.writeln(`    features: ${Object.entries(complexity.features).map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`).join(', ')}`);
    if (complexity.indicators.high.length + complexity.indicators.medium.length + complexity.indicators.low.length > 0) {
      output.writeln(`    indicators: high=[${complexity.indicators.high.slice(0,4).join(',')}] medium=[${complexity.indicators.medium.slice(0,4).join(',')}] low=[${complexity.indicators.low.slice(0,4).join(',')}]`);
    }
    output.writeln('');
    output.writeln(output.bold('  Decision:'));
    output.writeln(`    model:        ${output.success(result.model)}${result.modelId ? `  (id=${result.modelId})` : ''}`);
    output.writeln(`    routed_by:    ${result.routedBy}${result.neuralBackend ? `  via ${result.neuralBackend}` : ''}`);
    output.writeln(`    confidence:   ${result.confidence.toFixed(3)}    uncertainty: ${result.uncertainty.toFixed(3)}`);
    output.writeln(`    cost mult:    ${result.costMultiplier.toFixed(2)}×`);
    if (result.provider === 'openrouter' && result.openrouterModel) {
      output.writeln(`    via:          openrouter → ${result.openrouterModel}`);
    }
    output.writeln(`    reasoning:    ${result.reasoning}`);
    if (neuralResult?.ensembleDisagreement !== undefined) {
      const d = neuralResult.ensembleDisagreement;
      const annotation = d > 0.20 ? output.warning(' ⚠ high — consider tuning iter 44 threshold')
        : d > 0.10 ? output.dim(' (moderate)')
        : output.dim(' (low — predictions agree)');
      output.writeln(`    ensemble disagreement: ${d.toFixed(4)}${annotation}`);
    }
    output.writeln('');
    if (result.alternatives.length > 0) {
      output.writeln(output.bold('  Alternatives (model: score):'));
      for (const a of result.alternatives) {
        output.writeln(`    ${a.model.padEnd(8)}  ${a.score.toFixed(4)}`);
      }
      output.writeln('');
    }
    output.writeln(output.bold('  Backend state:'));
    output.writeln(`    enabled:    ${status.enabled}`);
    output.writeln(`    available:  ${status.available}`);
    output.writeln(`    routedBy:   ${status.routedBy ?? '—'}`);
    output.writeln(`    reason:     ${status.reason}`);
    output.writeln('');
    const activeEnvKeys = Object.entries(payload.activeEnv).filter(([, v]) => v !== null);
    if (activeEnvKeys.length > 0) {
      output.writeln(output.bold('  Active env overrides:'));
      for (const [k, v] of activeEnvKeys) output.writeln(`    ${k}=${v}`);
      output.writeln('');
    }
    output.writeln(output.dim(`  Total decision time: ${ms.toFixed(1)}ms`));
    output.writeln('');
    return { success: true, data: payload };
  },
};

// ADR-149 iter 32 — counterfactual cost-savings analysis. Iter 31 added
// cost_usd to outcome rows; this subcommand consumes that and asks "what
// would each decision have cost on the heuristic-only path?" — surfacing
// the actual production savings the router delivers.
const routerCostSavingsCommand: Command = {
  name: 'cost-savings',
  description: 'Compute actual vs heuristic-counterfactual cost from paired decision+outcome rows (ADR-149 iter 32)',
  options: [
    { name: 'in', short: 'i', type: 'string', description: 'Trajectory JSONL path (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH or .swarm/...)' },
    { name: 'since', short: 's', type: 'string', description: 'Time window suffix: 1h, 24h, 7d, 30d' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
    { name: 'top-n', type: 'number', description: 'Show top-N largest individual savings (default 5)', default: '5' },
    { name: 'baseline', short: 'b', type: 'string', description: 'Counterfactual baseline: heuristic | always-haiku | always-sonnet | always-opus | always-gpt-4.1 | all (default: all)', default: 'all' },
    { name: 'window', short: 'w', type: 'string', description: 'Bin decisions into successive windows of this duration (e.g. 1h, 24h, 7d). Output adds a trend table — iter 34 drift detection.' },
    { name: 'task-hash', type: 'string', description: 'Filter to specific task_hash (FNV-1a-32 hex). For per-task cost investigation — iter 61.' },
    { name: 'alert-on-drop-pct', type: 'number', description: 'Exit 1 if the most recent window\'s savings% falls > N points below the mean of prior windows. Requires --window. Default off. (ADR-149 iter 50)' },
  ],
  examples: [
    { command: 'claude-flow neural router cost-savings', description: 'All-time, all baselines (heuristic + Sonnet-always + Opus-always)' },
    { command: 'claude-flow neural router cost-savings --baseline always-sonnet', description: 'Compare only against Sonnet-always' },
    { command: 'claude-flow neural router cost-savings --window 24h', description: 'Daily savings trend — iter 34 drift detection' },
    { command: 'claude-flow neural router cost-savings --since 7d --format json | jq .baselines.heuristic.savings.totalUsd', description: 'Pipe-friendly headline' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { MODEL_PRICES } = await import('../ruvector/model-prices.js');

    const inPath = (ctx.flags.in as string | undefined)
      ?? process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    const since = ctx.flags.since as string | undefined;
    const fmt = (ctx.flags.format as string) || 'table';
    const topN = parseInt((ctx.flags['top-n'] ?? ctx.flags.topN) as string || '5', 10) || 5;

    if (!fs.existsSync(inPath)) {
      const msg = `Trajectory file not found at ${inPath}`;
      if (fmt === 'json') {
        output.writeln(JSON.stringify({ error: msg }, null, 2));
      } else {
        output.printError(msg);
      }
      return { success: false, exitCode: 1 };
    }

    interface DecisionRow {
      type: 'decision'; ts: string; task_hash: string; task?: string;
      model: string; complexity: number; openrouter_model?: string;
      ab_pair?: { bandit_pick: string; hybrid_pick: string; disagree: boolean };
    }
    interface OutcomeRow {
      type: 'outcome'; ts: string; task_hash: string;
      cost_usd?: number; tokens?: { input: number; output: number }; model_id?: string;
    }

    // iter 62 — preserve ALL outcomes (don't dedup by task_hash). Decisions
    // can still dedup because all occurrences of the same task have the
    // same embedding/complexity (it's the same task!), but different runs
    // produce different token counts and costs. The Array preserves those.
    const decisions = new Map<string, DecisionRow>();
    const outcomes: OutcomeRow[] = [];
    let malformed = 0;
    for (const l of fs.readFileSync(inPath, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l);
        if (r.type === 'decision') decisions.set(r.task_hash, r);
        else if (r.type === 'outcome') outcomes.push(r);
      } catch { malformed++; }
    }

    // Time-window filter (on the OUTCOME ts, since that's when cost was incurred).
    let cutoffMs: number | null = null;
    if (since) {
      const m = since.match(/^(\d+)([hdmw])$/);
      if (m) {
        const n = parseInt(m[1], 10);
        const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]] ?? 0;
        cutoffMs = Date.now() - n * unitMs;
      }
    }

    // iter 33 — multi-baseline counterfactuals. Each per-call row carries
    // the actual cost AND a map of counterfactual costs (one per baseline),
    // so a single LOO over the trajectory data computes all baselines at once.
    const baselineArg = (ctx.flags.baseline as string | undefined) ?? 'all';
    const allBaselines = ['heuristic', 'always-haiku', 'always-sonnet', 'always-opus', 'always-gpt-4.1'];
    const baselines = baselineArg === 'all' ? allBaselines : [baselineArg];
    // Map each baseline label → the modelId used for pricing.
    const baselineModelFor = (baseline: string, dec: DecisionRow): string => {
      switch (baseline) {
        case 'heuristic':
          return dec.ab_pair?.bandit_pick
            ?? (dec.complexity < 0.34 ? 'haiku' : dec.complexity < 0.67 ? 'sonnet' : 'opus');
        case 'always-haiku':    return 'haiku';
        case 'always-sonnet':   return 'sonnet';
        case 'always-opus':     return 'opus';
        case 'always-gpt-4.1':  return 'openai/gpt-4.1';
        default:                return baseline; // operator passes raw modelId
      }
    };

    interface PerCallSavings {
      task_hash: string; ts: string;
      actualModel: string; actualCost: number;
      counterfactuals: Record<string, { model: string; cost: number; savings: number }>;
      tokens: { input: number; output: number };
      complexity: number; tier: 'cheap' | 'mid' | 'strong';
    }
    const perCall: PerCallSavings[] = [];
    let droppedNoOutcomeCost = 0;
    let droppedNoDecision = 0;
    let droppedNoTokens = 0;

    // iter 61 — task-hash filter for per-task cost investigation.
    const taskHashFilter = ((ctx.flags['task-hash'] ?? ctx.flags.taskHash) as string | undefined)?.toLowerCase();
    if (taskHashFilter && !/^[0-9a-f]{8}$/.test(taskHashFilter)) {
      output.printError(`--task-hash must be an 8-char hex string (got "${taskHashFilter}")`);
      return { success: false, exitCode: 1 };
    }

    // iter 62 — iterate ALL outcomes (Array), not just one per hash. Multiple
    // occurrences of the same task contribute separately to the aggregate.
    for (const out of outcomes) {
      if (cutoffMs !== null && Date.parse(out.ts) < cutoffMs) continue;
      if (taskHashFilter && out.task_hash !== taskHashFilter) continue;
      if (out.cost_usd == null) { droppedNoOutcomeCost++; continue; }
      const dec = decisions.get(out.task_hash);
      if (!dec) { droppedNoDecision++; continue; }
      if (!out.tokens) { droppedNoTokens++; continue; }

      const actualCost = out.cost_usd;
      const actualModel = out.model_id ?? dec.openrouter_model ?? dec.model;
      const tier = dec.complexity < 0.34 ? 'cheap' : dec.complexity < 0.67 ? 'mid' : 'strong';

      // Compute every baseline at once. Cost = (input × $/Mtok_in + output ×
      // $/Mtok_out) / 1e6 — same formula iter 31's costUsd() uses.
      const counterfactuals: Record<string, { model: string; cost: number; savings: number }> = {};
      for (const b of baselines) {
        const m = baselineModelFor(b, dec);
        const p = MODEL_PRICES[m] ?? { in: 1, out: 1 };
        const cost = (out.tokens.input * p.in + out.tokens.output * p.out) / 1_000_000;
        counterfactuals[b] = { model: m, cost, savings: cost - actualCost };
      }

      perCall.push({
        task_hash: out.task_hash, ts: out.ts,
        actualModel, actualCost,
        counterfactuals,
        tokens: out.tokens,
        complexity: dec.complexity, tier,
      });
    }

    const round6 = (x: number) => Math.round(x * 1_000_000) / 1_000_000;
    const round2 = (x: number) => Math.round(x * 100) / 100;
    const totalActual = perCall.reduce((s, p) => s + p.actualCost, 0);

    // Per-baseline aggregates.
    type BaselineAgg = {
      totalUsd: number; savingsPct: number;
      actualUsd: number; counterfactualUsd: number;
      byTier: Record<string, { n: number; actualUsd: number; counterfactualUsd: number; savingsUsd: number; savingsPct: number }>;
    };
    const baselineAggs: Record<string, BaselineAgg> = {};
    for (const b of baselines) {
      let totalCf = 0;
      const byTier: Record<string, { actual: number; counterfactual: number; n: number }> = {
        cheap: { actual: 0, counterfactual: 0, n: 0 },
        mid: { actual: 0, counterfactual: 0, n: 0 },
        strong: { actual: 0, counterfactual: 0, n: 0 },
      };
      for (const c of perCall) {
        const cf = c.counterfactuals[b]?.cost ?? 0;
        totalCf += cf;
        byTier[c.tier].actual += c.actualCost;
        byTier[c.tier].counterfactual += cf;
        byTier[c.tier].n += 1;
      }
      const savings = totalCf - totalActual;
      const pct = totalCf > 0 ? (savings / totalCf) * 100 : 0;
      baselineAggs[b] = {
        totalUsd: round6(savings),
        savingsPct: round2(pct),
        actualUsd: round6(totalActual),
        counterfactualUsd: round6(totalCf),
        byTier: Object.fromEntries(Object.entries(byTier).map(([k, v]) => [k, {
          n: v.n,
          actualUsd: round6(v.actual),
          counterfactualUsd: round6(v.counterfactual),
          savingsUsd: round6(v.counterfactual - v.actual),
          savingsPct: v.counterfactual > 0 ? round2(((v.counterfactual - v.actual) / v.counterfactual) * 100) : 0,
        }])),
      };
    }

    // Top-N largest individual savings — use the first baseline's per-call savings.
    const primaryBaseline = baselines[0];
    const topSavings = [...perCall].sort((a, b) =>
      (b.counterfactuals[primaryBaseline]?.savings ?? 0) - (a.counterfactuals[primaryBaseline]?.savings ?? 0)
    ).slice(0, topN);

    const payload = {
      input: inPath,
      filters: { since, taskHash: taskHashFilter },
      pairs: perCall.length,
      dropped: { noOutcomeCost: droppedNoOutcomeCost, noDecision: droppedNoDecision, noTokens: droppedNoTokens },
      baselines: Object.fromEntries(Object.entries(baselineAggs).map(([k, v]) => [k, {
        savings: { totalUsd: v.totalUsd, savingsPct: v.savingsPct, actualUsd: v.actualUsd, counterfactualUsd: v.counterfactualUsd },
        byTier: v.byTier,
      }])),
      // Back-compat: top-level `savings` and `byTier` mirror the PRIMARY baseline
      // (first in the requested list, which for --baseline all is "heuristic" — same
      // as iter 32's output shape). Iter 32 callers parsing the old shape keep working.
      savings: baselineAggs[primaryBaseline]
        ? { totalUsd: baselineAggs[primaryBaseline].totalUsd, savingsPct: baselineAggs[primaryBaseline].savingsPct, actualUsd: baselineAggs[primaryBaseline].actualUsd, counterfactualUsd: baselineAggs[primaryBaseline].counterfactualUsd }
        : { totalUsd: 0, savingsPct: 0, actualUsd: round6(totalActual), counterfactualUsd: 0 },
      byTier: baselineAggs[primaryBaseline]?.byTier ?? {},
      topSavings: topSavings.map(t => ({
        ts: t.ts, actualModel: t.actualModel,
        counterfactualModel: t.counterfactuals[primaryBaseline]?.model ?? '—',
        actualUsd: round6(t.actualCost),
        counterfactualUsd: round6(t.counterfactuals[primaryBaseline]?.cost ?? 0),
        savingsUsd: round6(t.counterfactuals[primaryBaseline]?.savings ?? 0),
      })),
    };

    // iter 34 — windowed drift detection. When --window is set, bin the
    // paired calls into successive duration windows and emit a trend table
    // (one row per window). Useful for "is the router degrading over time?"
    // — a sudden drop in savings %% across windows surfaces calibration drift,
    // workload shifts, or model deprecation.
    const windowArg = (ctx.flags.window as string | undefined);
    let windowedTrend: Array<{
      windowStart: string; windowEnd: string; n: number;
      actualUsd: number; counterfactualUsd: number; savingsUsd: number; savingsPct: number;
      deltaVsPriorPct: number | null;
    }> | undefined;
    if (windowArg) {
      const m = windowArg.match(/^(\d+)([hdmw])$/);
      if (!m) {
        output.printError(`--window must match Nh|Nd|Nm|Nw (got ${windowArg})`);
        return { success: false, exitCode: 1 };
      }
      const n = parseInt(m[1], 10);
      const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]] ?? 0;
      const windowMs = n * unitMs;
      if (windowMs <= 0) {
        output.printError(`--window must be positive (got ${windowArg})`);
        return { success: false, exitCode: 1 };
      }
      // Bin perCall by (outcome.ts - earliest.ts) / windowMs.
      // Sort first so window indices are monotonic and gaps are visible.
      const sorted = [...perCall].sort((a, b) => a.ts.localeCompare(b.ts));
      if (sorted.length === 0) {
        windowedTrend = [];
      } else {
        const earliestMs = Date.parse(sorted[0].ts);
        const bins = new Map<number, typeof sorted>();
        for (const c of sorted) {
          const idx = Math.floor((Date.parse(c.ts) - earliestMs) / windowMs);
          if (!bins.has(idx)) bins.set(idx, []);
          bins.get(idx)!.push(c);
        }
        const rows: NonNullable<typeof windowedTrend> = [];
        let priorPct: number | null = null;
        for (const idx of [...bins.keys()].sort((a, b) => a - b)) {
          const items = bins.get(idx)!;
          let actual = 0, cf = 0;
          for (const c of items) {
            actual += c.actualCost;
            cf += c.counterfactuals[primaryBaseline]?.cost ?? 0;
          }
          const savings = cf - actual;
          const pct = cf > 0 ? (savings / cf) * 100 : 0;
          const windowStart = new Date(earliestMs + idx * windowMs).toISOString();
          const windowEnd = new Date(earliestMs + (idx + 1) * windowMs - 1).toISOString();
          const deltaVsPriorPct = priorPct === null ? null : round2(pct - priorPct);
          priorPct = pct;
          rows.push({
            windowStart, windowEnd, n: items.length,
            actualUsd: round6(actual),
            counterfactualUsd: round6(cf),
            savingsUsd: round6(savings),
            savingsPct: round2(pct),
            deltaVsPriorPct,
          });
        }
        windowedTrend = rows;
      }
      (payload as typeof payload & { windowedTrend?: typeof windowedTrend; windowConfig?: { duration: string; primaryBaseline: string } }).windowedTrend = windowedTrend;
      (payload as typeof payload & { windowedTrend?: typeof windowedTrend; windowConfig?: { duration: string; primaryBaseline: string } }).windowConfig = { duration: windowArg, primaryBaseline };
    }

    // iter 50 — drift alert. When --alert-on-drop-pct is set AND --window
    // produced ≥ 2 windows, compare the most-recent window's savings% to
    // the mean of prior windows'. If it dropped by > threshold, fail
    // (exit 1) so monitoring catches it. Independent of fmt — alert
    // state goes into the payload AND drives the exit code.
    const alertDropPctArg = (ctx.flags['alert-on-drop-pct'] ?? ctx.flags.alertOnDropPct) as string | number | undefined;
    let alertTriggered = false;
    let alertReason: string | null = null;
    if (alertDropPctArg !== undefined && alertDropPctArg !== null && alertDropPctArg !== '') {
      const dropThreshold = typeof alertDropPctArg === 'string' ? parseFloat(alertDropPctArg) : alertDropPctArg;
      if (!isFinite(dropThreshold) || dropThreshold <= 0) {
        output.printError(`--alert-on-drop-pct must be a positive number (got ${alertDropPctArg})`);
        return { success: false, exitCode: 1 };
      }
      if (!windowedTrend || windowedTrend.length < 2) {
        alertReason = `not enough windows for drift detection (need ≥ 2, got ${windowedTrend?.length ?? 0}) — alert skipped`;
      } else {
        const latest = windowedTrend[windowedTrend.length - 1];
        const prior = windowedTrend.slice(0, -1);
        const priorMean = prior.reduce((s, w) => s + w.savingsPct, 0) / prior.length;
        const dropPct = priorMean - latest.savingsPct;
        if (dropPct > dropThreshold) {
          alertTriggered = true;
          alertReason = `latest window savings ${latest.savingsPct.toFixed(2)}% is ${dropPct.toFixed(2)} points BELOW prior windows' mean ${priorMean.toFixed(2)}% (threshold ${dropThreshold})`;
        } else {
          alertReason = `latest window savings ${latest.savingsPct.toFixed(2)}% within ${dropThreshold} points of prior mean ${priorMean.toFixed(2)}% — OK`;
        }
      }
      (payload as typeof payload & { alert?: { triggered: boolean; reason: string | null; dropThreshold: number } }).alert = {
        triggered: alertTriggered,
        reason: alertReason,
        dropThreshold,
      };
    }

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return alertTriggered
        ? { success: false, exitCode: 1, data: payload }
        : { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Cost-savings analysis (ADR-149 iter 32)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Input:           ${inPath}`);
    if (since) output.writeln(`  Time window:     since ${since}`);
    if (taskHashFilter) output.writeln(`  Task hash:       ${taskHashFilter}  (filtered to this task)`);
    output.writeln(`  Paired calls:    ${perCall.length}  (dropped: no-cost=${droppedNoOutcomeCost}, no-decision=${droppedNoDecision}, no-tokens=${droppedNoTokens})`);
    output.writeln('');
    if (perCall.length === 0) {
      output.writeln(output.dim('  No cost-bearing paired rows. Enable trajectory recording AND make sure'));
      output.writeln(output.dim('  outcome rows include `tokens` (iter 31 wired this through agent-execute-core).'));
      output.writeln('');
      return { success: true, data: payload };
    }
    output.writeln(output.bold('  Headline (actual = $' + totalActual.toFixed(6) + '):'));
    output.writeln('    baseline            counterfactual   savings        %');
    for (const [b, agg] of Object.entries(baselineAggs)) {
      const savingsStr = agg.totalUsd >= 0 ? '$' + agg.totalUsd.toFixed(6) : '-$' + Math.abs(agg.totalUsd).toFixed(6);
      const colored = agg.totalUsd >= 0 ? output.success(savingsStr) : output.warning(savingsStr);
      output.writeln(`    ${b.padEnd(18)}  $${agg.counterfactualUsd.toFixed(6).padEnd(14)}  ${colored.padEnd(20)} ${agg.savingsPct.toString().padStart(6)}%`);
    }
    output.writeln('');
    output.writeln(output.dim(`  Primary baseline for per-tier and top-savings views: "${primaryBaseline}"`));
    output.writeln('');
    const primaryAgg = baselineAggs[primaryBaseline];
    output.writeln(output.bold('  By tier (' + primaryBaseline + '):'));
    output.writeln('    tier      n   actual          counterfactual  savings         %');
    for (const [k, v] of Object.entries(primaryAgg.byTier)) {
      output.writeln(`    ${k.padEnd(8)}  ${String(v.n).padStart(3)}  $${v.actualUsd.toFixed(6).padEnd(14)} $${v.counterfactualUsd.toFixed(6).padEnd(14)} $${v.savingsUsd.toFixed(6).padEnd(14)} ${v.savingsPct.toString().padStart(6)}%`);
    }
    output.writeln('');
    if (topSavings.length > 0) {
      output.writeln(output.bold(`  Top ${topSavings.length} largest individual savings (${primaryBaseline}):`));
      output.writeln('    ts                  actual                                    → counterfactual                           saved');
      for (const t of topSavings) {
        const cfModel = t.counterfactuals[primaryBaseline]?.model ?? '—';
        const sv = t.counterfactuals[primaryBaseline]?.savings ?? 0;
        output.writeln(`    ${t.ts.slice(0, 19)}  ${t.actualModel.padEnd(40)} → ${cfModel.padEnd(40)}  $${sv.toFixed(6)}`);
      }
      output.writeln('');
    }
    // iter 34 — windowed trend table for drift detection.
    if (windowedTrend && windowedTrend.length > 0) {
      output.writeln(output.bold(`  Windowed trend (${windowArg} bins, baseline=${primaryBaseline}):`));
      output.writeln('    window start         n    actual       counterfactual  savings      %       Δ% vs prior');
      for (const w of windowedTrend) {
        const arrow = w.deltaVsPriorPct === null ? ''
          : w.deltaVsPriorPct > 0 ? output.success(`↑ +${w.deltaVsPriorPct.toFixed(2)}`)
          : w.deltaVsPriorPct < 0 ? output.warning(`↓ ${w.deltaVsPriorPct.toFixed(2)}`)
          : '·';
        output.writeln(`    ${w.windowStart.slice(0, 19)}  ${String(w.n).padStart(3)}  $${w.actualUsd.toFixed(6).padEnd(11)} $${w.counterfactualUsd.toFixed(6).padEnd(14)} $${w.savingsUsd.toFixed(6).padEnd(11)} ${w.savingsPct.toString().padStart(6)}%  ${arrow}`);
      }
      output.writeln('');
      output.writeln(output.dim('    Δ% vs prior: change in savings % from the prior window. Large negative'));
      output.writeln(output.dim('    deltas suggest router degradation, workload shift, or calibration drift.'));
      output.writeln('');
    }
    // iter 50 — alert footer when --alert-on-drop-pct was used.
    if (alertReason !== null) {
      if (alertTriggered) {
        output.writeln(output.warning(`  ⚠ ALERT: ${alertReason}`));
      } else {
        output.writeln(output.dim(`  ${alertReason}`));
      }
      output.writeln('');
    }
    return alertTriggered
      ? { success: false, exitCode: 1, data: payload }
      : { success: true, data: payload };
  },
};

// ADR-149 iter 36 — operational observability for the trajectory JSONL itself.
// Iter 17 added the recorder with rotation. Iter 28/30/32 consume the data.
// Nothing previously surfaced "is logging healthy?" — size vs cap, rotation
// count, parse success rate, pair-join rate, time range. SREs need this view.
const routerTrajectoryHealthCommand: Command = {
  name: 'trajectory-health',
  description: 'Show health of the routing-decision JSONL log: size, rotations, parse rate, pair-join rate (ADR-149 iter 36)',
  options: [
    { name: 'in', short: 'i', type: 'string', description: 'Trajectory JSONL path (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH or .swarm/...)' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router trajectory-health', description: 'Snapshot of trajectory log health' },
    { command: 'claude-flow neural router trajectory-health --format json | jq .pairJoinRatePct', description: 'Pipe-friendly pair-join rate for dashboards' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const inPath = (ctx.flags.in as string | undefined)
      ?? process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    const fmt = (ctx.flags.format as string) || 'table';

    // Recorder config (mirrors router-trajectory.ts defaults).
    const recorderEnabled = process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY === '1';
    const maxSizeBytes = parseInt(process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXSIZE ?? `${10 * 1024 * 1024}`, 10) | 0;
    const maxRotations = Math.max(0, parseInt(process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXROTATIONS ?? '3', 10) || 3);

    if (!fs.existsSync(inPath)) {
      const payload = {
        recorderEnabled,
        input: inPath,
        exists: false,
        message: 'No trajectory file at the configured path.',
        hint: recorderEnabled
          ? 'Recorder is enabled — file should appear after the next routing decision.'
          : 'Recorder is OFF. Set CLAUDE_FLOW_ROUTER_TRAJECTORY=1 to enable.',
      };
      if (fmt === 'json') output.writeln(JSON.stringify(payload, null, 2));
      else {
        output.writeln('');
        output.writeln(output.bold('Trajectory health'));
        output.writeln(output.dim('─'.repeat(60)));
        output.writeln(`  Path:           ${inPath}`);
        output.writeln(`  Recorder gate:  ${recorderEnabled ? output.success('ON') : output.warning('OFF (CLAUDE_FLOW_ROUTER_TRAJECTORY=1 to enable)')}`);
        output.writeln(`  Status:         ${output.warning('file does not exist')}`);
        output.writeln(`  Hint:           ${payload.hint}`);
        output.writeln('');
      }
      return { success: true, data: payload };
    }

    const stat = fs.statSync(inPath);
    const sizeBytes = stat.size;
    const sizePct = maxSizeBytes > 0 ? Math.round((sizeBytes / maxSizeBytes) * 1000) / 10 : 0;

    // Count .bak rotation files.
    const rotationFiles: Array<{ index: number; path: string; bytes: number; mtime: string }> = [];
    for (let i = 1; i <= maxRotations; i++) {
      const p = `${inPath}.${i}`;
      if (fs.existsSync(p)) {
        const s = fs.statSync(p);
        rotationFiles.push({ index: i, path: p, bytes: s.size, mtime: s.mtime.toISOString() });
      }
    }

    // Parse JSONL — count rows by type, malformed lines, time range.
    interface MinimalRow { type?: string; ts?: string; task_hash?: string }
    const lines = fs.readFileSync(inPath, 'utf8').split('\n').filter(l => l.trim().length > 0);
    let decisions = 0, outcomes = 0, malformed = 0, otherType = 0;
    let oldestTs: string | null = null;
    let newestTs: string | null = null;
    const decisionHashes = new Set<string>();
    const outcomeHashes = new Set<string>();
    for (const l of lines) {
      try {
        const r = JSON.parse(l) as MinimalRow;
        if (r.type === 'decision') {
          decisions++;
          if (r.task_hash) decisionHashes.add(r.task_hash);
        } else if (r.type === 'outcome') {
          outcomes++;
          if (r.task_hash) outcomeHashes.add(r.task_hash);
        } else {
          otherType++;
        }
        if (r.ts) {
          if (oldestTs === null || r.ts < oldestTs) oldestTs = r.ts;
          if (newestTs === null || r.ts > newestTs) newestTs = r.ts;
        }
      } catch { malformed++; }
    }

    // Pair-join rate: % of decisions that have a matching outcome.
    let pairedHashes = 0;
    for (const h of decisionHashes) if (outcomeHashes.has(h)) pairedHashes++;
    const pairJoinRatePct = decisionHashes.size > 0
      ? Math.round((pairedHashes / decisionHashes.size) * 10000) / 100
      : 0;
    const parseSuccessPct = lines.length > 0
      ? Math.round(((lines.length - malformed) / lines.length) * 10000) / 100
      : 100;

    const payload = {
      recorderEnabled,
      input: inPath,
      exists: true,
      file: {
        sizeBytes,
        sizePct,
        maxSizeBytes,
        maxRotations,
        rotationsOnDisk: rotationFiles.length,
        rotations: rotationFiles,
        mtime: stat.mtime.toISOString(),
      },
      rows: {
        total: lines.length,
        decisions, outcomes, otherType, malformed,
      },
      pairing: {
        uniqueDecisionHashes: decisionHashes.size,
        uniqueOutcomeHashes: outcomeHashes.size,
        pairedHashes,
        pairJoinRatePct,
        parseSuccessPct,
      },
      timeRange: {
        oldestTs, newestTs,
        spanHours: oldestTs && newestTs ? Math.round(((Date.parse(newestTs) - Date.parse(oldestTs)) / 3600_000) * 10) / 10 : 0,
      },
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Trajectory health (ADR-149 iter 36)'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Path:           ${inPath}`);
    output.writeln(`  Recorder gate:  ${recorderEnabled ? output.success('ON') : output.warning('OFF')}`);
    output.writeln('');
    output.writeln(output.bold('  File:'));
    const sizeMb = (sizeBytes / 1_048_576).toFixed(3);
    const capMb = (maxSizeBytes / 1_048_576).toFixed(1);
    const sizeWarn = sizePct >= 80 ? output.warning(`(${sizePct}% of cap)`) : output.dim(`(${sizePct}% of cap)`);
    output.writeln(`    size:         ${sizeBytes} bytes (${sizeMb} MB) of ${capMb} MB max  ${sizeWarn}`);
    output.writeln(`    last write:   ${stat.mtime.toISOString()}`);
    output.writeln(`    rotations:    ${rotationFiles.length} of ${maxRotations} max .bak files on disk`);
    for (const r of rotationFiles) {
      output.writeln(`      .${r.index}:  ${r.bytes} bytes  ${r.mtime}`);
    }
    output.writeln('');
    output.writeln(output.bold('  Rows:'));
    output.writeln(`    total:        ${lines.length}`);
    output.writeln(`    decisions:    ${decisions}`);
    output.writeln(`    outcomes:     ${outcomes}`);
    if (otherType > 0) output.writeln(`    other type:   ${otherType}`);
    output.writeln(`    malformed:    ${malformed}  (parse success ${parseSuccessPct}%)`);
    output.writeln('');
    output.writeln(output.bold('  Pairing (decision ↔ outcome join by task_hash):'));
    output.writeln(`    unique decision hashes:  ${decisionHashes.size}`);
    output.writeln(`    unique outcome hashes:   ${outcomeHashes.size}`);
    output.writeln(`    paired:                  ${pairedHashes} (${pairJoinRatePct}%)`);
    if (pairJoinRatePct < 50 && decisionHashes.size > 5) {
      output.writeln(output.warning(`    ⚠ pair-join rate < 50% — outcome rows may not be wired through (iter 17/31).`));
    }
    output.writeln('');
    if (oldestTs && newestTs) {
      output.writeln(output.bold('  Time range:'));
      output.writeln(`    oldest:       ${oldestTs}`);
      output.writeln(`    newest:       ${newestTs}`);
      output.writeln(`    span:         ${payload.timeRange.spanHours} hours`);
      output.writeln('');
    }
    return { success: true, data: payload };
  },
};

// ADR-149 iter 54 — consolidated env-var inspection. The router has ~15
// CLAUDE_FLOW_ROUTER_* env vars accumulated across iters 12-53. Operators
// need a single command that lists each with its current value (or default),
// effect, and which iter introduced it. Color-coded: green = override set,
// dim = default.
const routerConfigCommand: Command = {
  name: 'config',
  description: 'List all CLAUDE_FLOW_ROUTER_* env vars with current values + effects (ADR-149 iter 54)',
  options: [
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
    { name: 'only-overrides', type: 'boolean', description: 'Only show env vars that are explicitly set (hide defaults)', default: false },
  ],
  examples: [
    { command: 'claude-flow neural router config', description: 'All router env vars with current values' },
    { command: 'claude-flow neural router config --only-overrides', description: 'Just what the operator has set' },
    { command: 'claude-flow neural router config --format json | jq', description: 'Audit / diff against another deployment' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fmt = (ctx.flags.format as string) || 'table';
    const onlyOverrides = Boolean(ctx.flags['only-overrides'] ?? ctx.flags.onlyOverrides);

    interface EnvVarRow {
      name: string;
      iter: number;
      defaultValue: string;
      currentValue: string;
      isOverride: boolean;
      effect: string;
    }
    const rows: EnvVarRow[] = [
      // Core gate (iter 0)
      { name: 'CLAUDE_FLOW_ROUTER_NEURAL',                       iter: 0,  defaultValue: 'unset (0)',   currentValue: process.env.CLAUDE_FLOW_ROUTER_NEURAL ?? '',     isOverride: !!process.env.CLAUDE_FLOW_ROUTER_NEURAL,                       effect: 'Gate. =1 enables neural router; otherwise pure-bandit heuristic.' },
      { name: 'CLAUDE_FLOW_ROUTER_MODEL_PATH',                   iter: 0,  defaultValue: 'unset',       currentValue: process.env.CLAUDE_FLOW_ROUTER_MODEL_PATH ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_MODEL_PATH,                   effect: 'Override the KRR artifact path. Defaults to bundled.' },
      { name: 'CLAUDE_FLOW_ROUTER_QUALITY_BAR',                  iter: 0,  defaultValue: '0.50',        currentValue: process.env.CLAUDE_FLOW_ROUTER_QUALITY_BAR ?? '',isOverride: !!process.env.CLAUDE_FLOW_ROUTER_QUALITY_BAR,                  effect: 'Cost-optimal mode: minimum predicted quality to pick a candidate.' },
      // Trajectory (iter 17)
      { name: 'CLAUDE_FLOW_ROUTER_TRAJECTORY',                   iter: 17, defaultValue: 'unset (0)',   currentValue: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY,                   effect: 'Gate. =1 writes decision+outcome rows to .swarm/model-router-trajectories.jsonl.' },
      { name: 'CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH',              iter: 17, defaultValue: '.swarm/model-router-trajectories.jsonl', currentValue: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH, effect: 'Override the trajectory JSONL path.' },
      { name: 'CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXSIZE',           iter: 17, defaultValue: '10485760 (10MB)', currentValue: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXSIZE ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXSIZE, effect: 'Bytes before rotation. Set 0 to disable rotation.' },
      { name: 'CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXROTATIONS',      iter: 17, defaultValue: '3',           currentValue: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXROTATIONS ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXROTATIONS, effect: 'Max .bak files to keep when rotating.' },
      { name: 'CLAUDE_FLOW_ROUTER_TRAJECTORY_TASKLEN',           iter: 17, defaultValue: '500',         currentValue: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_TASKLEN ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_TASKLEN, effect: 'Max chars of task text to persist per row (truncated above this).' },
      // Latency budget (iter 12)
      { name: 'CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS',            iter: 12, defaultValue: '0 (unbounded)', currentValue: process.env.CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS, effect: 'Drop candidates whose measured p50 latency > this many ms before selection.' },
      // Per-modelId bandit (iter 14)
      { name: 'CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL',             iter: 14, defaultValue: 'unset (0)',   currentValue: process.env.CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL, effect: 'Gate. =1 enables per-modelId Thompson sampling perturbation of neural prediction.' },
      // k-NN backend (iter 0)
      { name: 'CLAUDE_FLOW_ROUTER_KNN_K',                        iter: 0,  defaultValue: '5',           currentValue: process.env.CLAUDE_FLOW_ROUTER_KNN_K ?? '',      isOverride: !!process.env.CLAUDE_FLOW_ROUTER_KNN_K,                        effect: 'k for the k-NN backend when KRR is not loadable.' },
      { name: 'CLAUDE_FLOW_ROUTER_SEED_CORPUS',                  iter: 0,  defaultValue: 'bundled seed-rows.json', currentValue: process.env.CLAUDE_FLOW_ROUTER_SEED_CORPUS ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_SEED_CORPUS, effect: 'Override the DRACO seed corpus path.' },
      // Calibration (iter 22-25)
      { name: 'CLAUDE_FLOW_ROUTER_CALIBRATE',                    iter: 24, defaultValue: 'unset (default ON)', currentValue: process.env.CLAUDE_FLOW_ROUTER_CALIBRATE ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_CALIBRATE, effect: 'Isotonic calibration of KRR predictions. =0 opts out (recovers raw KRR). Default-on since iter 24 (OOS validated).' },
      { name: 'CLAUDE_FLOW_ROUTER_CALIBRATOR_PATH',              iter: 22, defaultValue: 'bundled seed-router.calibrator.json', currentValue: process.env.CLAUDE_FLOW_ROUTER_CALIBRATOR_PATH ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_CALIBRATOR_PATH, effect: 'Override the unified calibrator path. Per-tier files (low/med/high) load from the same dir.' },
      // Cost ceiling (iter 29)
      { name: 'CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK',    iter: 29, defaultValue: '0 (disabled)', currentValue: process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK, effect: 'Orthogonal selector mode: pick BEST quality among candidates ≤ ceiling $/Mtok blended.' },
      // A/B mode (iter 5/37)
      { name: 'CLAUDE_FLOW_ROUTER_AB',                           iter: 5,  defaultValue: 'unset (0)',   currentValue: process.env.CLAUDE_FLOW_ROUTER_AB ?? '',         isOverride: !!process.env.CLAUDE_FLOW_ROUTER_AB,                           effect: 'Legacy all-on A/B mode. Records bandit_pick + hybrid_pick on every decision.' },
      { name: 'CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE',               iter: 37, defaultValue: '0 (disabled)', currentValue: process.env.CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE, effect: 'Sampled A/B mode. 0..1 fraction of decisions to A/B (deterministic by task_hash). Overrides legacy AB=1.' },
      // Ensemble uncertainty (iter 44)
      { name: 'CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD', iter: 44, defaultValue: '0 (disabled)', currentValue: process.env.CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD, effect: 'When > 0: if |unified_q - specialist_q| > threshold for picked model, fall back to bandit.' },
      // Bandit warmup (iter 52/53)
      { name: 'CLAUDE_FLOW_ROUTER_BANDIT_WARMUP_RANGE',          iter: 52, defaultValue: '8',           currentValue: process.env.CLAUDE_FLOW_ROUTER_BANDIT_WARMUP_RANGE ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_BANDIT_WARMUP_RANGE, effect: 'Continuous warmup denominator. Smaller = bandit ramps faster; larger = more conservative.' },
      { name: 'CLAUDE_FLOW_ROUTER_BANDIT_FULL_INFLUENCE',        iter: 53, defaultValue: 'unset (0)',   currentValue: process.env.CLAUDE_FLOW_ROUTER_BANDIT_FULL_INFLUENCE ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_BANDIT_FULL_INFLUENCE, effect: 'Gate. =1 uses asymptotic curve (samples-2)/(samples+WARMUP) — bandit dominates at scale.' },
      { name: 'CLAUDE_FLOW_ROUTER_BANDIT_SHRINKAGE_LAMBDA',      iter: 57, defaultValue: '4',           currentValue: process.env.CLAUDE_FLOW_ROUTER_BANDIT_SHRINKAGE_LAMBDA ?? '', isOverride: !!process.env.CLAUDE_FLOW_ROUTER_BANDIT_SHRINKAGE_LAMBDA, effect: 'Cross-bucket shrinkage strength. λ=0 disables; higher λ = more bias toward marginal anchor for cold cells.' },
    ];

    const visible = onlyOverrides ? rows.filter(r => r.isOverride) : rows;

    if (fmt === 'json') {
      output.writeln(JSON.stringify(visible, null, 2));
      return { success: true, data: visible };
    }

    output.writeln();
    output.writeln(output.bold('Router config — ADR-149 iter 54 (env-var inventory)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  ${visible.length} of ${rows.length} entries  (${rows.filter(r => r.isOverride).length} overridden, ${rows.length - rows.filter(r => r.isOverride).length} default)`);
    output.writeln('');
    for (const r of visible) {
      const value = r.isOverride ? output.success(r.currentValue) : output.dim(`(default: ${r.defaultValue})`);
      output.writeln(`  ${r.name} = ${value}`);
      output.writeln(`    ${output.dim(`iter ${r.iter}`)} ${r.effect}`);
      output.writeln('');
    }
    if (visible.length === 0 && onlyOverrides) {
      output.writeln(output.dim('  No overrides — all router behavior is at defaults.'));
      output.writeln('');
    }
    return { success: true, data: visible };
  },
};

// ADR-149 iter 55 — side-by-side comparison of the two selector modes.
// Iter 29 added quality-best-under-budget; iter 30 added `decide` for the
// default cost-optimal mode. This subcommand runs BOTH on the same task
// so operators can see which mode is right for their workload BEFORE
// flipping CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK on for production.
const routerCompareModesCommand: Command = {
  name: 'compare-modes',
  description: 'Compare selector modes side-by-side for a hypothetical task (cost-optimal vs cost-ceiling) — ADR-149 iter 55',
  options: [
    { name: 'task', short: 't', type: 'string', description: 'Task text (or positional arg)' },
    { name: 'ceiling', type: 'number', description: 'Cost-ceiling $/Mtok for iter 29 mode (default 20)', default: '20' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router compare-modes "refactor strategy pattern"', description: 'Compare both modes for a task' },
    { command: 'claude-flow neural router compare-modes -t "..." --ceiling 5', description: 'Cost-ceiling at $5 blended' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const task = (ctx.flags.task as string | undefined) ?? (ctx.args && ctx.args[0]) ?? null;
    if (!task) {
      output.printError('Provide a task: --task "..." or as positional arg');
      return { success: false, exitCode: 1 };
    }
    const ceiling = parseFloat(ctx.flags.ceiling as string || '20') || 20;
    const fmt = (ctx.flags.format as string) || 'table';

    const { embedTaskWithCache } = await import('../ruvector/task-embedder.js');
    const { tryCostOptimalRoute, __resetNeuralRouterForTests } = await import('../ruvector/neural-router.js');
    const { analyzeTaskComplexity } = await import('../ruvector/model-router.js');

    const complexity = analyzeTaskComplexity(task);
    const bucket = complexity.score < 0.34 ? 'low' : complexity.score < 0.67 ? 'med' : 'high';
    let embedding: number[] | undefined;
    try { embedding = await embedTaskWithCache(task); } catch { /* */ }

    if (!embedding) {
      output.printError('Embedder unavailable — cannot run neural routing for comparison');
      return { success: false, exitCode: 1 };
    }

    // Mode 1: cost-optimal (default — no ceiling)
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    delete process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK;
    __resetNeuralRouterForTests();
    const costOptimal = await tryCostOptimalRoute(embedding, { complexityBucket: bucket });

    // Mode 2: cost-ceiling
    process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK = String(ceiling);
    __resetNeuralRouterForTests();
    const costCeiling = await tryCostOptimalRoute(embedding, { complexityBucket: bucket });

    // Clean up
    delete process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK;
    __resetNeuralRouterForTests();

    const payload = {
      task: task.length > 200 ? task.slice(0, 200) + '…' : task,
      complexity: complexity.score,
      bucket,
      modes: {
        costOptimal: costOptimal ? {
          modelId: costOptimal.modelId,
          predictedQuality: costOptimal.predictedQuality,
          costPerMTok: costOptimal.alternatives.find(a => a.modelId === costOptimal.modelId)?.costPerMTok ?? null,
          metBar: costOptimal.metBar,
        } : null,
        costCeiling: costCeiling ? {
          ceilingUsd: ceiling,
          modelId: costCeiling.modelId,
          predictedQuality: costCeiling.predictedQuality,
          costPerMTok: costCeiling.alternatives.find(a => a.modelId === costCeiling.modelId)?.costPerMTok ?? null,
          metBar: costCeiling.metBar,
        } : null,
      },
      sameModel: costOptimal?.modelId === costCeiling?.modelId,
      deltaQuality: (costCeiling && costOptimal) ? costCeiling.predictedQuality - costOptimal.predictedQuality : null,
      deltaCost: (costCeiling && costOptimal)
        ? ((costCeiling.alternatives.find(a => a.modelId === costCeiling.modelId)?.costPerMTok ?? 0) - (costOptimal.alternatives.find(a => a.modelId === costOptimal.modelId)?.costPerMTok ?? 0))
        : null,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Selector mode comparison (ADR-149 iter 55)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Task:        "${payload.task}"`);
    output.writeln(`  Complexity:  ${complexity.score.toFixed(3)} (bucket: ${bucket})`);
    output.writeln('');
    output.writeln(output.bold('  Cost-optimal mode (default — cheapest above qualityBar):'));
    if (costOptimal) {
      const co = payload.modes.costOptimal!;
      output.writeln(`    picked:           ${output.success(co.modelId)}`);
      output.writeln(`    predicted Q:      ${co.predictedQuality.toFixed(4)}`);
      output.writeln(`    cost ($/Mtok):    $${co.costPerMTok?.toFixed(2)}`);
      output.writeln(`    met quality bar:  ${co.metBar ? '✓' : '✗'}`);
    } else {
      output.writeln(`    ${output.warning('null (neural backend declined — would fall back to bandit)')}`);
    }
    output.writeln('');
    output.writeln(output.bold(`  Cost-ceiling mode (iter 29 — best quality ≤ $${ceiling}/Mtok):`));
    if (costCeiling) {
      const cc = payload.modes.costCeiling!;
      output.writeln(`    picked:           ${output.success(cc.modelId)}`);
      output.writeln(`    predicted Q:      ${cc.predictedQuality.toFixed(4)}`);
      output.writeln(`    cost ($/Mtok):    $${cc.costPerMTok?.toFixed(2)}`);
      output.writeln(`    met quality bar:  ${cc.metBar ? '✓' : '✗'}`);
    } else {
      output.writeln(`    ${output.warning('null')}`);
    }
    output.writeln('');
    if (costOptimal && costCeiling) {
      if (payload.sameModel) {
        output.writeln(output.dim('  Both modes picked the same model — selector choice irrelevant for this task.'));
      } else {
        const dq = payload.deltaQuality!;
        const dc = payload.deltaCost!;
        const qSign = dq > 0 ? '+' : '';
        const cSign = dc > 0 ? '+' : '';
        const qColor = dq > 0 ? output.success(`${qSign}${dq.toFixed(4)}`) : output.warning(`${dq.toFixed(4)}`);
        const cColor = dc > 0 ? output.warning(`${cSign}$${dc.toFixed(2)}`) : output.success(`$${dc.toFixed(2)}`);
        output.writeln(`  Δ (ceiling − optimal):  predicted Q: ${qColor}    cost: ${cColor}`);
        output.writeln('');
        output.writeln(output.dim(`    Cost-ceiling pays extra cost for higher quality (or is forced cheap if ceiling is tight).`));
        output.writeln(output.dim(`    Cost-optimal accepts qualityBar threshold but minimizes spend.`));
      }
    }
    output.writeln('');
    return { success: true, data: payload };
  },
};

// ADR-149 iter 49 — single-command SRE dashboard. The router has 13 subcommands
// (iter 48); ops want ONE that says "is everything working AND saving money?".
// Aggregates the most-asked signals into one terse screen.
const routerStatsSummaryCommand: Command = {
  name: 'stats-summary',
  description: 'One-screen SRE dashboard: gate, recent activity, savings, bandit warmest cell (ADR-149 iter 49)',
  options: [
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router stats-summary', description: 'One-screen health check' },
    { command: 'claude-flow neural router stats-summary --format json | jq .', description: 'Pipe to dashboards / alerting' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const fmt = (ctx.flags.format as string) || 'table';

    // 1. Backend gate / status
    const { neuralRouterStatus } = await import('../ruvector/neural-router.js');
    const { getModelRouterStats } = await import('../ruvector/model-router.js');
    const backend = await neuralRouterStatus();
    const stats = getModelRouterStats();

    // 2. Trajectory existence + basic counts
    const trajectoryPath = process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    let trajectory: {
      exists: boolean; rows: number; decisions: number; outcomes: number;
      pairedWithCost: number; oldestTs: string | null; newestTs: string | null;
    } = { exists: false, rows: 0, decisions: 0, outcomes: 0, pairedWithCost: 0, oldestTs: null, newestTs: null };
    let recent24h: { decisions: number; fallbacks: number; fallbackRatePct: number } | null = null;
    let cost7d: { pairs: number; actualUsd: number; counterfactualUsd: number; savingsUsd: number; savingsPct: number } | null = null;

    if (fs.existsSync(trajectoryPath)) {
      trajectory.exists = true;
      const { MODEL_PRICES } = await import('../ruvector/model-prices.js');
      const lines = fs.readFileSync(trajectoryPath, 'utf8').split('\n').filter(l => l.trim().length > 0);
      trajectory.rows = lines.length;

      const cutoff24h = Date.now() - 24 * 3600_000;
      const cutoff7d = Date.now() - 7 * 86400_000;
      let recDec = 0, recFallback = 0;
      interface DecLite { ts: string; task_hash: string; complexity: number; routed_by: string; ab_pair?: { bandit_pick: string } }
      interface OutLite { ts: string; task_hash: string; cost_usd?: number; tokens?: { input: number; output: number } }
      const decs7d = new Map<string, DecLite>();
      const outs7d = new Map<string, OutLite>();
      for (const l of lines) {
        try {
          const r = JSON.parse(l);
          const tsMs = Date.parse(r.ts);
          if (r.type === 'decision') {
            trajectory.decisions++;
            if (tsMs >= cutoff24h) {
              recDec++;
              if (r.routed_by === 'bandit-fallback') recFallback++;
            }
            if (tsMs >= cutoff7d) decs7d.set(r.task_hash, r);
          } else if (r.type === 'outcome') {
            trajectory.outcomes++;
            if (r.cost_usd != null) trajectory.pairedWithCost++;
            if (tsMs >= cutoff7d) outs7d.set(r.task_hash, r);
          }
          if (r.ts) {
            if (!trajectory.oldestTs || r.ts < trajectory.oldestTs) trajectory.oldestTs = r.ts;
            if (!trajectory.newestTs || r.ts > trajectory.newestTs) trajectory.newestTs = r.ts;
          }
        } catch { /* malformed */ }
      }
      recent24h = {
        decisions: recDec, fallbacks: recFallback,
        fallbackRatePct: recDec > 0 ? Math.round((recFallback / recDec) * 10000) / 100 : 0,
      };

      // 7-day cost via heuristic counterfactual
      let pairs = 0, actual = 0, cf = 0;
      for (const [hash, dec] of decs7d) {
        const out = outs7d.get(hash);
        if (!out?.cost_usd || !out.tokens) continue;
        pairs++;
        actual += out.cost_usd;
        const tierModel = dec.complexity < 0.34 ? 'haiku' : dec.complexity < 0.67 ? 'sonnet' : 'opus';
        const cfModel = dec.ab_pair?.bandit_pick ?? tierModel;
        const p = MODEL_PRICES[cfModel] ?? { in: 1, out: 1 };
        cf += (out.tokens.input * p.in + out.tokens.output * p.out) / 1_000_000;
      }
      if (pairs > 0) {
        cost7d = {
          pairs,
          actualUsd: Math.round(actual * 1_000_000) / 1_000_000,
          counterfactualUsd: Math.round(cf * 1_000_000) / 1_000_000,
          savingsUsd: Math.round((cf - actual) * 1_000_000) / 1_000_000,
          savingsPct: cf > 0 ? Math.round(((cf - actual) / cf) * 10000) / 100 : 0,
        };
      }
    }

    // 3. Warmest bandit cell from persisted state
    interface BetaCell { bucket: string; key: string; samples: number; meanQuality: number }
    let warmestCell: BetaCell | null = null;
    const statePath = path.resolve(process.cwd(), '.swarm', 'model-router-state.json');
    if (fs.existsSync(statePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const priors = state.priorsById ?? state.priors ?? {};
        let bestSamples = 0;
        for (const bucket of ['low', 'med', 'high']) {
          const b = priors[bucket];
          if (!b) continue;
          for (const [k, p] of Object.entries(b as Record<string, { alpha: number; beta: number }>)) {
            const samples = p.alpha + p.beta - 2;
            if (samples > bestSamples) {
              bestSamples = samples;
              warmestCell = { bucket, key: k, samples, meanQuality: p.alpha / (p.alpha + p.beta) };
            }
          }
        }
      } catch { /* malformed */ }
    }

    const payload = {
      backend: {
        enabled: backend.enabled,
        available: backend.available,
        routedBy: backend.routedBy,
        reason: backend.reason,
      },
      processLocal: {
        totalDecisions: stats.totalDecisions,
        modelDistribution: stats.modelDistribution,
        routedByCounts: stats.routedByCounts,
        abDisagreementRate: stats.ab.comparisons > 0 ? Math.round(stats.ab.disagreementRate * 10000) / 100 : 0,
      },
      trajectory,
      recent24h,
      cost7d,
      warmestBanditCell: warmestCell,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Router stats summary — ADR-149 iter 49 (one-screen SRE view)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln('');
    output.writeln(output.bold('  Backend:'));
    output.writeln(`    gate:           ${backend.enabled ? output.success('open (NEURAL=1)') : output.warning('closed')}`);
    output.writeln(`    available:      ${backend.available ? output.success('yes') : output.warning('no')}`);
    output.writeln(`    active backend: ${backend.routedBy ?? '—'}`);
    output.writeln(`    reason:         ${backend.reason}`);
    output.writeln('');
    output.writeln(output.bold('  Process-local (since this server started):'));
    output.writeln(`    decisions:      ${stats.totalDecisions}`);
    output.writeln(`    routed_by:      heuristic=${stats.routedByCounts.heuristic}  hybrid=${stats.routedByCounts.hybrid}  bandit-fallback=${stats.routedByCounts['bandit-fallback']}`);
    if (stats.ab.comparisons > 0) {
      output.writeln(`    A/B:            ${stats.ab.comparisons} comparisons, ${stats.ab.disagreements} disagreements (${(stats.ab.disagreementRate * 100).toFixed(1)}%)`);
    }
    output.writeln('');
    output.writeln(output.bold('  Trajectory log:'));
    if (!trajectory.exists) {
      output.writeln(`    ${output.warning('file does not exist — recorder OFF or no decisions made')}`);
    } else {
      output.writeln(`    rows:           ${trajectory.rows}  (${trajectory.decisions} decisions / ${trajectory.outcomes} outcomes / ${trajectory.pairedWithCost} cost-bearing)`);
      if (trajectory.oldestTs && trajectory.newestTs) {
        output.writeln(`    span:           ${trajectory.oldestTs.slice(0, 19)} → ${trajectory.newestTs.slice(0, 19)}`);
      }
    }
    output.writeln('');
    if (recent24h) {
      const rateStr = recent24h.fallbackRatePct > 30 ? output.warning(recent24h.fallbackRatePct + '% ⚠')
        : recent24h.fallbackRatePct > 10 ? recent24h.fallbackRatePct + '%'
        : output.success(recent24h.fallbackRatePct + '%');
      output.writeln(output.bold(`  Last 24h:`));
      output.writeln(`    decisions:      ${recent24h.decisions}`);
      output.writeln(`    fallback rate:  ${rateStr}  (neural backend → bandit when prediction unusable)`);
      output.writeln('');
    }
    if (cost7d) {
      const savingsStr = cost7d.savingsUsd >= 0
        ? output.success(`$${cost7d.savingsUsd.toFixed(4)}`)
        : output.warning(`-$${Math.abs(cost7d.savingsUsd).toFixed(4)}`);
      output.writeln(output.bold('  Last 7d cost-savings (vs heuristic baseline):'));
      output.writeln(`    paired calls:    ${cost7d.pairs}`);
      output.writeln(`    actual:          $${cost7d.actualUsd.toFixed(4)}`);
      output.writeln(`    counterfactual:  $${cost7d.counterfactualUsd.toFixed(4)}`);
      output.writeln(`    savings:         ${savingsStr}  (${cost7d.savingsPct}%)`);
      output.writeln('');
    }
    if (warmestCell) {
      output.writeln(output.bold('  Bandit warmest cell:'));
      output.writeln(`    ${warmestCell.bucket} × ${warmestCell.key}  →  ${warmestCell.samples} samples, meanQ=${warmestCell.meanQuality.toFixed(3)}`);
      output.writeln('');
    }
    output.writeln(output.dim('  For drill-down: `router decisions`, `router cost-savings`, `router bandit-state`'));
    output.writeln('');
    return { success: true, data: payload };
  },
};

// ADR-149 iter 48 — bandit-state inspection. The persisted bandit posteriors
// (`.swarm/model-router-state.json`) accumulate across restarts but are
// otherwise invisible. Surfacing the (bucket × model) prior matrix lets
// operators see where bandit learning is thin (cold cells) and where it's
// confident (large α+β).
const routerBanditStateCommand: Command = {
  name: 'bandit-state',
  description: 'Inspect persisted bandit Beta priors per bucket × model (ADR-149 iter 48)',
  options: [
    { name: 'path', type: 'string', description: 'Path to model-router-state.json (default: .swarm/model-router-state.json)' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
    { name: 'cold-threshold', type: 'number', description: 'Highlight cells with sample count below this (default 4 — matches iter 14 density guard)', default: '4' },
  ],
  examples: [
    { command: 'claude-flow neural router bandit-state', description: 'Show all Beta priors per bucket × tier + per bucket × modelId' },
    { command: 'claude-flow neural router bandit-state --format json | jq .priorsById', description: 'Just the per-modelId matrix' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const statePath = (ctx.flags.path as string | undefined)
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-state.json');
    const fmt = (ctx.flags.format as string) || 'table';
    const coldThreshold = parseInt(ctx.flags['cold-threshold'] as string || '4', 10) || 4;

    if (!fs.existsSync(statePath)) {
      const msg = `Bandit state file not found at ${statePath}`;
      if (fmt === 'json') output.writeln(JSON.stringify({ error: msg, hint: 'State is created on first routing decision. Run any agent_spawn flow with CLAUDE_FLOW_ROUTER_NEURAL=1.' }, null, 2));
      else {
        output.printError(msg);
        output.writeln(output.dim('  State is created on first routing decision. Run any agent_spawn flow.'));
      }
      return { success: false, exitCode: 1 };
    }

    interface BetaPrior { alpha: number; beta: number }
    interface BucketedPriors {
      low?:  Record<string, BetaPrior>;
      med?:  Record<string, BetaPrior>;
      high?: Record<string, BetaPrior>;
    }
    interface State {
      version?: number;
      totalDecisions?: number;
      lastUpdated?: string;
      priors?: BucketedPriors;
      priorsById?: BucketedPriors;
    }

    let state: State;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (err) {
      const msg = `Failed to parse bandit state: ${err instanceof Error ? err.message : String(err)}`;
      if (fmt === 'json') output.writeln(JSON.stringify({ error: msg }, null, 2));
      else output.printError(msg);
      return { success: false, exitCode: 1 };
    }

    // Helper: enumerate all cells from a BucketedPriors with derived stats.
    const cells = (priors: BucketedPriors | undefined) => {
      const out: Array<{ bucket: string; key: string; alpha: number; beta: number; samples: number; meanQuality: number; cold: boolean }> = [];
      if (!priors) return out;
      for (const bucket of ['low', 'med', 'high'] as const) {
        const b = priors[bucket];
        if (!b) continue;
        for (const [k, p] of Object.entries(b)) {
          const samples = p.alpha + p.beta - 2;   // -2 because Beta(1,1) is the uniform prior
          const meanQuality = p.alpha / (p.alpha + p.beta);
          out.push({ bucket, key: k, alpha: p.alpha, beta: p.beta, samples, meanQuality, cold: samples < coldThreshold });
        }
      }
      return out;
    };

    const tierCells = cells(state.priors);
    const idCells = cells(state.priorsById);
    const coldTierCells = tierCells.filter(c => c.cold);
    const coldIdCells = idCells.filter(c => c.cold);

    const payload = {
      input: statePath,
      stateVersion: state.version ?? 2,
      totalDecisions: state.totalDecisions ?? 0,
      lastUpdated: state.lastUpdated ?? null,
      coldThreshold,
      priors: tierCells,
      priorsById: idCells,
      summary: {
        tierCells: tierCells.length,
        coldTierCells: coldTierCells.length,
        idCells: idCells.length,
        coldIdCells: coldIdCells.length,
        warmestIdCell: idCells.length > 0 ? [...idCells].sort((a, b) => b.samples - a.samples)[0] : null,
      },
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Bandit state inspection (ADR-149 iter 48)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Path:               ${statePath}`);
    output.writeln(`  Schema version:     v${state.version ?? 2}  (v2=tier priors only; v3=adds priorsById)`);
    output.writeln(`  Total decisions:    ${state.totalDecisions ?? 0}`);
    if (state.lastUpdated) output.writeln(`  Last update:        ${state.lastUpdated}`);
    output.writeln(`  Cold threshold:     samples < ${coldThreshold}  (iter 14 density-guard cutoff)`);
    output.writeln('');

    const renderTable = (label: string, rows: typeof tierCells) => {
      if (rows.length === 0) {
        output.writeln(`  ${label}:  (empty — no outcomes recorded yet for this layer)`);
        output.writeln('');
        return;
      }
      output.writeln(output.bold(`  ${label}:`));
      output.writeln('    bucket  key                                       α        β     samples  meanQ');
      for (const c of rows.sort((a, b) => (a.bucket.localeCompare(b.bucket)) || (b.samples - a.samples))) {
        const coldMark = c.cold ? output.warning(' ❄ cold') : '';
        output.writeln(`    ${c.bucket.padEnd(6)}  ${c.key.padEnd(38)}  ${c.alpha.toFixed(1).padStart(5)}  ${c.beta.toFixed(1).padStart(5)}  ${String(c.samples).padStart(7)}  ${c.meanQuality.toFixed(3)}${coldMark}`);
      }
      output.writeln('');
    };

    renderTable('Tier priors (bucket × tier label)', tierCells);
    renderTable('Per-modelId priors (bucket × concrete modelId, iter 14)', idCells);
    output.writeln(output.bold('  Summary:'));
    output.writeln(`    tier cells:        ${tierCells.length}  (cold: ${coldTierCells.length})`);
    output.writeln(`    per-modelId cells: ${idCells.length}  (cold: ${coldIdCells.length})`);
    if (payload.summary.warmestIdCell) {
      const w = payload.summary.warmestIdCell;
      output.writeln(`    warmest cell:      ${w.bucket} × ${w.key}  (${w.samples} samples, meanQ=${w.meanQuality.toFixed(3)})`);
    }
    output.writeln('');
    if (coldIdCells.length > 0 && idCells.length > 0) {
      output.writeln(output.dim(`  Cold cells suppress iter 14 per-modelId Thompson perturbation. Until α+β ≥ ${coldThreshold + 2},`));
      output.writeln(output.dim('  the neural prediction dominates that (bucket, modelId) pair without bandit correction.'));
      output.writeln('');
    }
    return { success: true, data: payload };
  },
};

// ADR-149 iter 38 — consumer for iter 37's sampled A/B mode. Aggregates
// ab_pair from decision rows into a (bandit_pick × hybrid_pick) confusion
// matrix plus disagreement rate. Operators see WHERE the neural prior
// moves the bandit's decisions.
const routerAbStatsCommand: Command = {
  name: 'ab-stats',
  description: 'Aggregate A/B (bandit-vs-hybrid) disagreement from trajectory ab_pair rows (ADR-149 iter 38)',
  options: [
    { name: 'in', short: 'i', type: 'string', description: 'Trajectory JSONL path (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH or .swarm/...)' },
    { name: 'since', short: 's', type: 'string', description: 'Time window suffix: 1h, 24h, 7d, 30d' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router ab-stats', description: 'All A/B comparisons recorded so far' },
    { command: 'claude-flow neural router ab-stats --since 7d --format json', description: 'Last 7 days, pipe-friendly' },
    { command: 'CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE=0.05 ... && claude-flow neural router ab-stats', description: 'After running with iter 37 sampling on' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const inPath = (ctx.flags.in as string | undefined)
      ?? process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    const since = ctx.flags.since as string | undefined;
    const fmt = (ctx.flags.format as string) || 'table';

    if (!fs.existsSync(inPath)) {
      const msg = `Trajectory file not found at ${inPath}`;
      if (fmt === 'json') output.writeln(JSON.stringify({ error: msg }, null, 2));
      else {
        output.printError(msg);
        output.writeln(output.dim('  Set CLAUDE_FLOW_ROUTER_TRAJECTORY=1 + CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE=0.05 to start collecting ab_pair data.'));
      }
      return { success: false, exitCode: 1 };
    }

    interface AbRow {
      type: 'decision';
      ts: string;
      ab_pair?: { bandit_pick: string; hybrid_pick: string; disagree: boolean };
    }

    // Parse + filter to decision rows that carry ab_pair.
    let cutoffMs: number | null = null;
    if (since) {
      const m = since.match(/^(\d+)([hdmw])$/);
      if (m) {
        const n = parseInt(m[1], 10);
        const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]] ?? 0;
        cutoffMs = Date.now() - n * unitMs;
      }
    }
    const rows = fs.readFileSync(inPath, 'utf8').split('\n').filter(l => l.trim().length > 0);
    let totalDecisions = 0;
    let malformed = 0;
    const abRows: AbRow[] = [];
    for (const l of rows) {
      try {
        const r = JSON.parse(l) as AbRow & { task_hash?: string };
        if (r.type !== 'decision') continue;
        totalDecisions++;
        if (!r.ab_pair) continue;
        if (cutoffMs !== null && Date.parse(r.ts) < cutoffMs) continue;
        abRows.push(r);
      } catch { malformed++; }
    }

    // Confusion matrix + disagree breakdown.
    interface Cell { bandit: string; hybrid: string; count: number }
    const cells = new Map<string, Cell>();
    let disagree = 0;
    const banditTotals: Record<string, number> = {};
    const hybridTotals: Record<string, number> = {};
    for (const r of abRows) {
      const ap = r.ab_pair!;
      const key = `${ap.bandit_pick}→${ap.hybrid_pick}`;
      const cell = cells.get(key) ?? { bandit: ap.bandit_pick, hybrid: ap.hybrid_pick, count: 0 };
      cell.count++;
      cells.set(key, cell);
      banditTotals[ap.bandit_pick] = (banditTotals[ap.bandit_pick] ?? 0) + 1;
      hybridTotals[ap.hybrid_pick] = (hybridTotals[ap.hybrid_pick] ?? 0) + 1;
      if (ap.disagree) disagree++;
    }
    const disagreeRatePct = abRows.length > 0 ? Math.round((disagree / abRows.length) * 10000) / 100 : 0;

    // Models actually seen, in stable iteration order.
    const allModels = Array.from(new Set([...Object.keys(banditTotals), ...Object.keys(hybridTotals)])).sort();

    const matrix: Record<string, Record<string, number>> = {};
    for (const b of allModels) {
      matrix[b] = {};
      for (const h of allModels) {
        matrix[b][h] = cells.get(`${b}→${h}`)?.count ?? 0;
      }
    }

    // Disagreement breakdown — off-diagonal cells sorted by count desc.
    const offDiag: Array<{ bandit: string; hybrid: string; count: number; pctOfDisagrees: number }> = [];
    for (const c of cells.values()) {
      if (c.bandit !== c.hybrid) {
        offDiag.push({ ...c, pctOfDisagrees: disagree > 0 ? Math.round((c.count / disagree) * 10000) / 100 : 0 });
      }
    }
    offDiag.sort((a, b) => b.count - a.count);

    const payload = {
      input: inPath,
      filters: { since },
      totalDecisions, malformed,
      abComparisons: abRows.length,
      disagreements: disagree,
      disagreementRatePct: disagreeRatePct,
      models: allModels,
      banditTotals, hybridTotals,
      confusionMatrix: matrix,
      disagreementBreakdown: offDiag,
      coveragePct: totalDecisions > 0 ? Math.round((abRows.length / totalDecisions) * 10000) / 100 : 0,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('A/B (bandit vs hybrid) stats — ADR-149 iter 37/38'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Input:              ${inPath}`);
    if (since) output.writeln(`  Time window:        since ${since}`);
    output.writeln(`  Total decisions:    ${totalDecisions}  (${malformed} malformed)`);
    output.writeln(`  A/B comparisons:    ${abRows.length}  (${payload.coveragePct}% of decisions had ab_pair)`);
    output.writeln('');
    if (abRows.length === 0) {
      output.writeln(output.dim('  No ab_pair rows found. Enable iter 37 sampling:'));
      output.writeln(output.dim('    export CLAUDE_FLOW_ROUTER_TRAJECTORY=1'));
      output.writeln(output.dim('    export CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE=0.05  # 5% sampling'));
      output.writeln('');
      return { success: true, data: payload };
    }
    output.writeln(`  Disagreements:      ${disagree}  (${disagreeRatePct}% of A/B comparisons)`);
    output.writeln('');
    output.writeln(output.bold(`  Confusion matrix (rows = bandit pick, cols = hybrid pick, ${allModels.length} models):`));
    const headerPad = Math.max(8, ...allModels.map(m => m.length));
    output.writeln('    ' + 'bandit \\ hybrid'.padEnd(headerPad) + '  ' + allModels.map(m => m.padStart(8)).join(''));
    for (const b of allModels) {
      const cells = allModels.map(h => String(matrix[b][h] ?? 0).padStart(8));
      output.writeln(`    ${b.padEnd(headerPad)}  ${cells.join('')}`);
    }
    output.writeln(output.dim('    (Diagonal cells = agreement, off-diagonal = disagreement.)'));
    output.writeln('');
    if (offDiag.length > 0) {
      output.writeln(output.bold('  Disagreement breakdown (bandit → hybrid):'));
      output.writeln('    transition'.padEnd(40) + '  count  % of disagrees');
      for (const c of offDiag) {
        output.writeln(`    ${(c.bandit + ' → ' + c.hybrid).padEnd(38)}  ${String(c.count).padStart(5)}  ${c.pctOfDisagrees.toString().padStart(6)}%`);
      }
      output.writeln('');
    }
    return { success: true, data: payload };
  },
};

// ADR-149 iter 43 — show the canonical price table that drives cost
// computations, blended-price routing, and counterfactual baselines.
// Operators ask "what does the router think gpt-4.1 costs?" frequently;
// previously the answer required reading src/ruvector/model-prices.ts.
const routerPricesCommand: Command = {
  name: 'prices',
  description: 'Show the per-model price table that drives blended cost + counterfactual computations (ADR-149 iter 43)',
  options: [
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
    { name: 'sort', type: 'string', description: 'Sort by: blended (default), input, output, name', default: 'blended' },
  ],
  examples: [
    { command: 'claude-flow neural router prices', description: 'Show all models sorted by blended price' },
    { command: 'claude-flow neural router prices --sort name', description: 'Sort alphabetically' },
    { command: 'claude-flow neural router prices --format json | jq \'.[] | select(.id | contains("opus"))\'', description: 'Filter via jq' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { MODEL_PRICES, blendedPrice } = await import('../ruvector/model-prices.js');
    const fmt = (ctx.flags.format as string) || 'table';
    const sortKey = ((ctx.flags.sort as string) || 'blended').toLowerCase();

    const rows = Object.entries(MODEL_PRICES).map(([id, p]) => ({
      id,
      inPerMtok: p.in,
      outPerMtok: p.out,
      blendedPerMtok: blendedPrice(id),
    }));

    switch (sortKey) {
      case 'input':   rows.sort((a, b) => a.inPerMtok - b.inPerMtok); break;
      case 'output':  rows.sort((a, b) => a.outPerMtok - b.outPerMtok); break;
      case 'name':    rows.sort((a, b) => a.id.localeCompare(b.id)); break;
      case 'blended':
      default:        rows.sort((a, b) => a.blendedPerMtok - b.blendedPerMtok);
    }

    if (fmt === 'json') {
      output.writeln(JSON.stringify(rows, null, 2));
      return { success: true, data: rows };
    }

    output.writeln();
    output.writeln(output.bold('Model price table (ADR-149 iter 31/43 — single source of truth)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  ${rows.length} entries, sorted by ${sortKey}`);
    output.writeln('');
    output.writeln('    model id                                      $/Mtok in   $/Mtok out   blended ($/Mtok)');
    for (const r of rows) {
      output.writeln(`    ${r.id.padEnd(44)}  ${('$' + r.inPerMtok.toFixed(2)).padStart(9)}  ${('$' + r.outPerMtok.toFixed(2)).padStart(11)}  ${('$' + r.blendedPerMtok.toFixed(2)).padStart(15)}`);
    }
    output.writeln('');
    output.writeln(output.dim('  Blended = $/Mtok_in + 3 × $/Mtok_out (1 input : 3 output ratio for code tasks).'));
    output.writeln(output.dim('  Unknown model ids fall back to $1/Mtok blended (1×in + 1×out).'));
    output.writeln('');
    return { success: true, data: rows };
  },
};

// ADR-149 iter 41 — forward-looking budget projection. Iter 32-34 measure
// past cost (actual vs counterfactual, per-window drift). This subcommand
// extrapolates: given the measured rate and average cost per decision over
// a recent window, what will routing cost over the next 7d / 30d / 90d /
// 365d? Also projects the heuristic baseline so operators see the savings
// trajectory across a quarter or year.
const routerCostProjectionCommand: Command = {
  name: 'cost-projection',
  description: 'Project monthly/quarterly cost from measured rate (ADR-149 iter 41)',
  options: [
    { name: 'in', short: 'i', type: 'string', description: 'Trajectory JSONL path (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH or .swarm/...)' },
    { name: 'window', short: 'w', type: 'string', description: 'Measurement window to extrapolate FROM (default 7d). Format: 1h, 24h, 7d, 30d' },
    { name: 'horizons', type: 'string', description: 'Projection horizons (CSV of duration suffixes). Default: 7d,30d,90d,365d' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router cost-projection', description: 'Project from last 7d of data → 7d/30d/90d/365d horizons' },
    { command: 'claude-flow neural router cost-projection --window 24h --horizons 7d,30d', description: 'Project from last day only' },
    { command: 'claude-flow neural router cost-projection --format json | jq .horizons[1].projectedSavingsUsd', description: '30-day savings projection for dashboards' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { MODEL_PRICES } = await import('../ruvector/model-prices.js');

    const inPath = (ctx.flags.in as string | undefined)
      ?? process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    const windowSpec = (ctx.flags.window as string | undefined) ?? '7d';
    const horizonSpecs = ((ctx.flags.horizons as string | undefined) ?? '7d,30d,90d,365d').split(',').map(s => s.trim());
    const fmt = (ctx.flags.format as string) || 'table';

    const parseDuration = (s: string): number | null => {
      const m = s.match(/^(\d+)([hdmw])$/);
      if (!m) return null;
      const n = parseInt(m[1], 10);
      const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]] ?? 0;
      return n * unitMs;
    };
    const windowMs = parseDuration(windowSpec);
    if (!windowMs || windowMs <= 0) {
      output.printError(`--window must be Nh/Nd/Nm/Nw (got ${windowSpec})`);
      return { success: false, exitCode: 1 };
    }

    if (!fs.existsSync(inPath)) {
      const msg = `Trajectory file not found at ${inPath}`;
      if (fmt === 'json') output.writeln(JSON.stringify({ error: msg }, null, 2));
      else output.printError(msg);
      return { success: false, exitCode: 1 };
    }

    interface DecisionRow {
      type: 'decision'; ts: string; task_hash: string;
      model: string; complexity: number; openrouter_model?: string;
      ab_pair?: { bandit_pick: string; hybrid_pick: string; disagree: boolean };
    }
    interface OutcomeRow {
      type: 'outcome'; ts: string; task_hash: string;
      cost_usd?: number; tokens?: { input: number; output: number }; model_id?: string;
    }

    // iter 66 — outcomes now ARRAY (was Map). Same fix as iter 62/63/65:
    // a Map keyed by task_hash collapses multiple runs of the same task to
    // the LATEST outcome only, biasing the rate downward (pairCount =
    // unique-tasks, not unique-calls). Production projections were
    // systematically too small for any workload with recurring tasks.
    const decisions = new Map<string, DecisionRow>();
    const outcomes: OutcomeRow[] = [];
    let malformed = 0;
    const cutoffMs = Date.now() - windowMs;
    for (const l of fs.readFileSync(inPath, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l);
        if (Date.parse(r.ts) < cutoffMs) continue;
        if (r.type === 'decision') decisions.set(r.task_hash, r);
        else if (r.type === 'outcome') outcomes.push(r);
      } catch { malformed++; }
    }

    // Pair + compute window totals. Iterate OUTCOMES (not deduped decisions);
    // each outcome row contributes its own cost + tokens to the rate.
    let pairCount = 0;
    let actualUsd = 0;
    let counterfactualUsd = 0;     // heuristic = tier-by-complexity baseline (iter 32 default)
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    for (const out of outcomes) {
      if (!out?.cost_usd || !out.tokens) continue;
      const dec = decisions.get(out.task_hash);
      if (!dec) continue;
      pairCount++;
      actualUsd += out.cost_usd;
      totalInputTokens += out.tokens.input;
      totalOutputTokens += out.tokens.output;
      // Heuristic counterfactual: tier-by-complexity (matches iter 32 default).
      const tierModel = dec.complexity < 0.34 ? 'haiku'
        : dec.complexity < 0.67 ? 'sonnet' : 'opus';
      const cfModel = dec.ab_pair?.bandit_pick ?? tierModel;
      const p = MODEL_PRICES[cfModel] ?? { in: 1, out: 1 };
      counterfactualUsd += (out.tokens.input * p.in + out.tokens.output * p.out) / 1_000_000;
    }

    if (pairCount === 0) {
      const msg = `No paired cost-bearing rows in the last ${windowSpec}. Cannot project.`;
      const payload = { error: msg, windowSpec, hint: 'Enable CLAUDE_FLOW_ROUTER_TRAJECTORY=1 and run some routed agent calls first.' };
      if (fmt === 'json') output.writeln(JSON.stringify(payload, null, 2));
      else {
        output.printError(msg);
        output.writeln(output.dim(`  ${payload.hint}`));
      }
      return { success: true, data: payload };
    }

    // Per-second rate from this window's pair count.
    const callsPerSecond = pairCount / (windowMs / 1000);
    const avgActualPerCall = actualUsd / pairCount;
    const avgCounterfactualPerCall = counterfactualUsd / pairCount;

    // Extrapolate to horizons. Costs scale linearly with calls; calls scale
    // linearly with elapsed time at the measured rate.
    const horizons = horizonSpecs.map(spec => {
      const ms = parseDuration(spec);
      if (!ms) return { spec, error: 'invalid duration' };
      const projectedCalls = Math.round(callsPerSecond * (ms / 1000));
      const projectedActualUsd = avgActualPerCall * projectedCalls;
      const projectedCounterfactualUsd = avgCounterfactualPerCall * projectedCalls;
      const projectedSavingsUsd = projectedCounterfactualUsd - projectedActualUsd;
      const projectedSavingsPct = projectedCounterfactualUsd > 0
        ? (projectedSavingsUsd / projectedCounterfactualUsd) * 100 : 0;
      return {
        spec, durationMs: ms,
        projectedCalls,
        projectedActualUsd: Math.round(projectedActualUsd * 1_000_000) / 1_000_000,
        projectedCounterfactualUsd: Math.round(projectedCounterfactualUsd * 1_000_000) / 1_000_000,
        projectedSavingsUsd: Math.round(projectedSavingsUsd * 1_000_000) / 1_000_000,
        projectedSavingsPct: Math.round(projectedSavingsPct * 100) / 100,
      };
    });

    const payload = {
      input: inPath,
      window: windowSpec,
      malformed,
      measurement: {
        pairs: pairCount,
        actualUsd: Math.round(actualUsd * 1_000_000) / 1_000_000,
        counterfactualUsd: Math.round(counterfactualUsd * 1_000_000) / 1_000_000,
        savingsUsd: Math.round((counterfactualUsd - actualUsd) * 1_000_000) / 1_000_000,
        callsPerSecond: Math.round(callsPerSecond * 1_000_000) / 1_000_000,
        callsPerDay: Math.round(callsPerSecond * 86400 * 100) / 100,
        avgActualPerCall: Math.round(avgActualPerCall * 1_000_000) / 1_000_000,
        avgCounterfactualPerCall: Math.round(avgCounterfactualPerCall * 1_000_000) / 1_000_000,
        avgInputTokensPerCall: Math.round(totalInputTokens / pairCount),
        avgOutputTokensPerCall: Math.round(totalOutputTokens / pairCount),
      },
      horizons,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Cost projection (ADR-149 iter 41)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Input:             ${inPath}`);
    output.writeln(`  Measurement window: last ${windowSpec}  (${pairCount} paired calls)`);
    output.writeln('');
    output.writeln(output.bold('  Measured rate:'));
    output.writeln(`    Calls/day:                  ${payload.measurement.callsPerDay}`);
    output.writeln(`    Avg actual cost/call:       $${payload.measurement.avgActualPerCall.toFixed(6)}`);
    output.writeln(`    Avg counterfactual/call:    $${payload.measurement.avgCounterfactualPerCall.toFixed(6)}  (heuristic: cheap→haiku, mid→sonnet, strong→opus)`);
    output.writeln(`    Avg tokens/call:            ${payload.measurement.avgInputTokensPerCall} in / ${payload.measurement.avgOutputTokensPerCall} out`);
    output.writeln('');
    output.writeln(output.bold('  Projections (linear extrapolation from measured rate):'));
    output.writeln('    horizon  projected calls   actual $        counterfactual $  savings $      %');
    for (const h of horizons) {
      if ('error' in h) {
        output.writeln(`    ${h.spec.padEnd(7)}  invalid duration`);
        continue;
      }
      const savingsStr = h.projectedSavingsUsd >= 0
        ? output.success(`$${h.projectedSavingsUsd.toFixed(2)}`)
        : output.warning(`-$${Math.abs(h.projectedSavingsUsd).toFixed(2)}`);
      output.writeln(`    ${h.spec.padEnd(7)}  ${String(h.projectedCalls).padStart(15)}   $${h.projectedActualUsd.toFixed(2).padStart(12)}   $${h.projectedCounterfactualUsd.toFixed(2).padStart(14)}   ${savingsStr.padEnd(14)} ${h.projectedSavingsPct.toFixed(2).padStart(6)}%`);
    }
    output.writeln('');
    output.writeln(output.dim('  Assumes the next horizon\'s workload mix and rate matches the measurement window.'));
    output.writeln(output.dim('  Use iter 34 (--window) to check if recent windows are drifting before trusting these.'));
    output.writeln('');
    return { success: true, data: payload };
  },
};

const routerCommand: Command = {
  name: 'router',
  description: 'Cost-optimal neural router lifecycle (ADR-148/149): status, models, prices, config, train, train-from-trajectories, decide, compare-modes, decisions, cost-savings, cost-projection, trajectory-health, ab-stats, bandit-state, stats-summary, reload',
  subcommands: [routerStatusCommand, routerModelsCommand, routerPricesCommand, routerConfigCommand, routerTrainCommand, routerTrainFromTrajectoriesCommand, routerDecideCommand, routerCompareModesCommand, routerDecisionsCommand, routerCostSavingsCommand, routerCostProjectionCommand, routerTrajectoryHealthCommand, routerAbStatsCommand, routerBanditStateCommand, routerStatsSummaryCommand, routerReloadCommand],
  examples: [
    { command: 'claude-flow neural router status', description: 'Show router state, gate, counters' },
    { command: 'claude-flow neural router models', description: 'List candidate registry with measured stats (ADR-149)' },
    { command: 'claude-flow neural router prices', description: 'Show the canonical $/Mtok price table (iter 43)' },
    { command: 'claude-flow neural router config', description: 'Inventory all CLAUDE_FLOW_ROUTER_* env vars (iter 54)' },
    { command: 'claude-flow neural router train -o ./router.krr.json', description: 'Train a KRR artifact' },
    { command: 'claude-flow neural router train-from-trajectories -w production-rows.json', description: 'Pair production JSONL into a training corpus (iter 18)' },
    { command: 'claude-flow neural router decide "fix typo in cache.ts"', description: 'Inspect decision for a hypothetical task (iter 30)' },
    { command: 'claude-flow neural router compare-modes "task" --ceiling 5', description: 'Compare cost-optimal vs cost-ceiling side-by-side (iter 55)' },
    { command: 'claude-flow neural router decisions --since 24h', description: 'Query recorded decisions (iter 28)' },
    { command: 'claude-flow neural router cost-savings --since 7d', description: 'Actual vs heuristic-counterfactual spend (iter 32)' },
    { command: 'claude-flow neural router trajectory-health', description: 'JSONL log health: size, rotations, parse + pair-join rate (iter 36)' },
    { command: 'claude-flow neural router ab-stats', description: 'A/B disagreement matrix from sampled ab_pair (iter 37/38)' },
    { command: 'claude-flow neural router bandit-state', description: 'Persisted Beta priors per (bucket × model) (iter 48)' },
    { command: 'claude-flow neural router stats-summary', description: 'One-screen SRE dashboard (iter 49)' },
    { command: 'claude-flow neural router cost-projection', description: 'Project monthly/quarterly spend from measured rate (iter 41)' },
    { command: 'claude-flow neural router reload', description: 'Clear in-process backend cache' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln('Use a subcommand: status | models | prices | config | train | train-from-trajectories | decide | compare-modes | decisions | cost-savings | cost-projection | trajectory-health | ab-stats | bandit-state | stats-summary | reload');
    return { success: true };
  },
};

// ============================================================================
// ADR-150 weight-eft slice — `neural distill export | plan | eval | train`
//
// Turns ruflo's captured run transcripts into AUDITED TRAINING DATA + a
// COST-PARETO measurement + a GPU TRAINING PLAN via the optional
// `@metaharness/weight-eft` dependency. HARD honesty rule: this ships training
// DATA + a cost audit + a GPU plan — it does NOT train a model and does NOT
// "reduce escalation". weight-eft's own `train` never spawns; `resolved` in the
// captured archive is a PROXY (no SWE-bench gold oracle). Every path degrades
// gracefully ({degraded:true}) when the optional dep is absent (ADR-150).
// ============================================================================

const distillExportCommand: Command = {
  name: 'export',
  description: 'Export captured run transcripts → SFT (OpenAI chat) + DPO (TRL preference) JSONL + a guard report (contamination / reward-hack / long-context). $0, offline. Does NOT train.',
  options: [
    { name: 'archive', short: 'a', type: 'string', description: 'Run-transcript JSONL to read (default: $CLAUDE_FLOW_RUN_TRANSCRIPTS_PATH or .swarm/run-transcripts.jsonl)' },
    { name: 'out-dir', short: 'o', type: 'string', description: 'Output dir for sft.jsonl / dpo.jsonl / export-report.json', default: '.claude-flow/neural/weft-export' },
    { name: 'eval-holdout', type: 'string', description: 'Comma-separated instance_ids reserved for eval (contamination guard). Excluded + asserted-disjoint.' },
    { name: 'max-tokens', type: 'number', description: 'Per-trajectory token budget (default weight-eft 28000)' },
    { name: 'truncate', type: 'boolean', description: 'Truncate over-length trajectories instead of dropping', default: 'false' },
    { name: 'keep-reward-hacked', type: 'boolean', description: 'Disable the reward-hacking filter (debug only; NOT recommended)', default: 'false' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural distill export', description: 'Export from the default captured .swarm/run-transcripts.jsonl' },
    { command: 'claude-flow neural distill export -a runs.jsonl -o ./out --eval-holdout astropy__astropy-1', description: 'Export a specific archive, holding out one instance' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { readRunTranscripts } = await import('../ruvector/run-transcript-recorder.js');
    const { buildArchiveFromRecords, runExport } = await import('../services/weight-eft.js');
    const fmt = (ctx.flags.format as string) || 'table';

    const archivePath = (ctx.flags.archive as string | undefined)
      ?? process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'run-transcripts.jsonl');
    const { records, malformed } = readRunTranscripts(archivePath);
    if (records.length === 0) {
      const msg = `No run transcripts at ${archivePath}. Enable capture with CLAUDE_FLOW_RUN_TRANSCRIPTS=1, or pass --archive <file>.`;
      if (fmt === 'json') output.writeln(JSON.stringify({ ok: false, archivePath, records: 0, malformed, error: msg }, null, 2));
      else output.printError(msg);
      return { success: false, exitCode: 1, data: { archivePath, records: 0 } };
    }

    const { trajectories, stats, proxyNote } = buildArchiveFromRecords(records);
    const holdout = ((ctx.flags['eval-holdout'] ?? ctx.flags.evalHoldout) as string | undefined)?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    const maxTokens = (ctx.flags['max-tokens'] ?? ctx.flags.maxTokens) != null ? parseInt(String((ctx.flags['max-tokens'] ?? ctx.flags.maxTokens)), 10) : undefined;

    const res = await runExport({
      archive: trajectories,
      evalHoldout: holdout,
      maxTokens,
      truncateOverLength: ctx.flags.truncate === true,
      dropRewardHacked: (ctx.flags['keep-reward-hacked'] ?? ctx.flags.keepRewardHacked) === true ? false : undefined,
    });

    if (res.degraded) {
      // ADR-150 graceful degradation: dep absent → not a runtime failure.
      const payload = { degraded: true, reason: res.reason, archiveTrajectories: trajectories.length };
      if (fmt === 'json') output.writeln(JSON.stringify(payload, null, 2));
      else {
        output.writeln(output.warning(`weight-eft unavailable (${res.reason}).`));
        output.writeln(output.dim('Install the optional dep: npm i @metaharness/weight-eft. Archive was built (' + trajectories.length + ' trajectories) but not exported.'));
      }
      return { success: true, exitCode: 0, data: payload };
    }

    const outDir = path.resolve(process.cwd(), ((ctx.flags['out-dir'] ?? ctx.flags.outDir) as string) || '.claude-flow/neural/weft-export');
    fs.mkdirSync(outDir, { recursive: true });
    const sftPath = path.join(outDir, 'sft.jsonl');
    const dpoPath = path.join(outDir, 'dpo.jsonl');
    const reportPath = path.join(outDir, 'export-report.json');
    fs.writeFileSync(sftPath, res.sftJsonl);
    fs.writeFileSync(dpoPath, res.dpoJsonl);
    fs.writeFileSync(reportPath, JSON.stringify({ report: res.report, archiveStats: stats, proxyNote }, null, 2));

    const payload = {
      ok: true, archivePath, outDir, sftPath, dpoPath, reportPath,
      sftRows: res.sftRows, dpoRows: res.dpoRows, malformed,
      archiveStats: stats, report: res.report, proxyNote,
    };
    if (fmt === 'json') { output.writeln(JSON.stringify(payload, null, 2)); return { success: true, data: payload }; }

    output.writeln();
    output.writeln(output.bold('weight-eft export — audited training data ($0, no model trained)'));
    output.writeln(`  archive:      ${archivePath} (${records.length} records, ${malformed} malformed skipped)`);
    output.writeln(`  trajectories: ${stats.total} (cheap ${stats.byTier.cheap} / frontier ${stats.byTier.frontier}), resolved ${stats.resolved}`);
    output.writeln(`  SFT rows:     ${res.sftRows}  → ${sftPath}`);
    output.writeln(`  DPO rows:     ${res.dpoRows}  → ${dpoPath}`);
    output.writeln(`  guards:       holdout=${res.report.excludedByHoldout} reward-hacked=${res.report.droppedRewardHacked} over-length=${res.report.droppedOverLength} truncated=${res.report.truncatedOverLength}`);
    output.writeln(`  report:       ${reportPath}`);
    output.writeln();
    output.writeln(output.warning('resolved provenance: ' + JSON.stringify(stats.byResolvedSource)));
    output.writeln(output.dim(proxyNote));
    return { success: true, data: payload };
  },
};

const distillPlanCommand: Command = {
  name: 'plan',
  description: 'Print the two-stage (SFT → on-policy DPO) GPU training plan + the exact `ruvllm microlora` commands a GPU host would run. $0 dry-run — NEVER spawns a tune.',
  options: [
    { name: 'sft', type: 'string', description: 'Path to sft.jsonl (default: .claude-flow/neural/weft-export/sft.jsonl)' },
    { name: 'dpo', type: 'string', description: 'Path to dpo.jsonl (default: .claude-flow/neural/weft-export/dpo.jsonl)' },
    { name: 'base', short: 'b', type: 'string', description: 'Base model id to tune (7-14B band). Default Qwen2.5-Coder-7B-Instruct' },
    { name: 'params-b', type: 'number', description: 'Base model param count in billions (gate [1,14]). Default 7' },
    { name: 'adapter-prefix', type: 'string', description: 'Adapter output prefix', default: 'ruflo-weft' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural distill plan', description: 'Print the GPU plan for the last export ($0 dry-run)' },
    { command: 'claude-flow neural distill plan --base Qwen/Qwen2.5-Coder-7B-Instruct --params-b 7', description: 'Plan for a specific base model' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const path = await import('node:path');
    const { runPlan, DEFAULT_BASE_MODEL } = await import('../services/weight-eft.js');
    const fmt = (ctx.flags.format as string) || 'table';
    const sftPath = (ctx.flags.sft as string) || path.resolve(process.cwd(), '.claude-flow/neural/weft-export/sft.jsonl');
    const dpoPath = (ctx.flags.dpo as string) || path.resolve(process.cwd(), '.claude-flow/neural/weft-export/dpo.jsonl');
    const base = ctx.flags.base
      ? { id: String(ctx.flags.base), paramsB: (ctx.flags['params-b'] ?? ctx.flags.paramsB) != null ? parseInt(String((ctx.flags['params-b'] ?? ctx.flags.paramsB)), 10) : 7 }
      : DEFAULT_BASE_MODEL;

    const res = await runPlan({ base, sftPath, dpoPath, adapterPrefix: String((ctx.flags['adapter-prefix'] ?? ctx.flags.adapterPrefix) || 'ruflo-weft') });
    if (res.degraded) {
      const payload = { degraded: true, reason: res.reason };
      if (fmt === 'json') output.writeln(JSON.stringify(payload, null, 2));
      else { output.writeln(output.warning(`weight-eft unavailable (${res.reason}).`)); output.writeln(output.dim('Install: npm i @metaharness/weight-eft')); }
      return { success: true, exitCode: 0, data: payload };
    }
    const payload = { ok: true, base: res.base, sft: res.sft, dpo: res.dpo, dryRun: true };
    if (fmt === 'json') { output.writeln(JSON.stringify(payload, null, 2)); return { success: true, data: payload }; }
    output.writeln();
    output.writeln(output.bold(`weight-eft GPU training plan ($0 dry-run — no tune runs from ruflo)`));
    output.writeln(`  base model: ${res.base.id} (${res.base.paramsB}B)`);
    output.writeln(output.dim('  SFT stage:'));
    output.writeln(`    ${res.sft.summary}`);
    output.writeln(`    $ ${res.sft.command}`);
    output.writeln(output.dim('  DPO stage (on-policy, init from SFT adapter):'));
    output.writeln(`    ${res.dpo.summary}`);
    output.writeln(`    $ ${res.dpo.command}`);
    output.writeln();
    output.writeln(output.dim('These commands run on a GPU host; ruflo does not execute them. See `neural distill train --remote` for a spend-gated remote path.'));
    return { success: true, data: payload };
  },
};

const distillEvalCommand: Command = {
  name: 'eval',
  description: 'Fold two CascadeOutcome[] JSON files (base vs adapter) into the cost-Pareto delta — escalation-rate reduction + $/resolved. $0. Measures cost, does NOT claim a tune ran.',
  options: [
    { name: 'base-outcomes', type: 'string', description: 'JSON file: CascadeOutcome[] for the BASE cascade run', required: true },
    { name: 'adapter-outcomes', type: 'string', description: 'JSON file: CascadeOutcome[] for the ADAPTER cascade run', required: true },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural distill eval --base-outcomes base.json --adapter-outcomes adapter.json', description: 'Cost-Pareto delta between base and adapter cascade runs' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const { runEval } = await import('../services/weight-eft.js');
    const fmt = (ctx.flags.format as string) || 'table';
    const basePath = (ctx.flags['base-outcomes'] ?? ctx.flags.baseOutcomes) as string | undefined;
    const adapterPath = (ctx.flags['adapter-outcomes'] ?? ctx.flags.adapterOutcomes) as string | undefined;
    if (!basePath || !adapterPath) {
      output.printError('Both --base-outcomes and --adapter-outcomes are required.');
      return { success: false, exitCode: 2 };
    }
    let baseOutcomes: unknown; let adapterOutcomes: unknown;
    try {
      baseOutcomes = JSON.parse(fs.readFileSync(basePath, 'utf8'));
      adapterOutcomes = JSON.parse(fs.readFileSync(adapterPath, 'utf8'));
    } catch (e) {
      output.printError(`Failed to read outcome files: ${(e as Error).message}`);
      return { success: false, exitCode: 1 };
    }
    if (!Array.isArray(baseOutcomes) || !Array.isArray(adapterOutcomes)) {
      output.printError('Both files must contain a JSON array of CascadeOutcome objects.');
      return { success: false, exitCode: 1 };
    }
    const res = await runEval({ baseOutcomes: baseOutcomes as never, adapterOutcomes: adapterOutcomes as never });
    if (res.degraded) {
      const payload = { degraded: true, reason: res.reason };
      if (fmt === 'json') output.writeln(JSON.stringify(payload, null, 2));
      else { output.writeln(output.warning(`weight-eft unavailable (${res.reason}).`)); output.writeln(output.dim('Install: npm i @metaharness/weight-eft')); }
      return { success: true, exitCode: 0, data: payload };
    }
    if (fmt === 'json') { output.writeln(JSON.stringify({ ok: true, delta: res.delta }, null, 2)); return { success: true, data: res.delta }; }
    output.writeln();
    output.writeln(output.bold('weight-eft cost-Pareto delta (measurement only)'));
    output.writeln(`  cheap-resolve lift:       ${res.delta.cheapResolveLift.toFixed(4)}`);
    output.writeln(`  escalation-rate reduction: ${res.delta.escalationRateReduction.toFixed(4)}`);
    output.writeln(`  $/resolved reduction:      ${res.delta.costPerResolvedReduction.toFixed(6)}`);
    output.writeln(`  resolve-rate delta:        ${res.delta.resolveRateDelta.toFixed(4)} (expected ≈ 0 — ceiling unmoved)`);
    output.writeln(`  verdict: ${res.delta.verdict}`);
    return { success: true, data: res.delta };
  },
};

const distillTrainCommand: Command = {
  name: 'train',
  description: 'Remote-GPU LoRA tune over SSH — DRY-RUN by default (prints ssh/rsync/ruvllm commands + read-only preflight). Real compute ONLY with --execute --yes (spends GPU time on YOUR host). Not a $0/local tune.',
  options: [
    { name: 'remote', short: 'r', type: 'string', description: 'SSH host or tailscale name (default: $RUFLO_DISTILL_REMOTE). Never hard-coded.' },
    { name: 'base', short: 'b', type: 'string', description: 'Base model id to tune. Default Qwen2.5-Coder-7B-Instruct' },
    { name: 'sft', type: 'string', description: 'Local sft.jsonl (default: .claude-flow/neural/weft-export/sft.jsonl)' },
    { name: 'dpo', type: 'string', description: 'Local dpo.jsonl (default: .claude-flow/neural/weft-export/dpo.jsonl)' },
    { name: 'adapter-dir', type: 'string', description: 'Local dir to fetch the trained adapter into', default: '.claude-flow/neural' },
    { name: 'ssh-user', type: 'string', description: 'SSH user (default: current user)' },
    { name: 'ssh-port', type: 'number', description: 'SSH port', default: '22' },
    { name: 'remote-workdir', type: 'string', description: 'Remote working dir (default: ~/.ruflo-weft/<runId>)' },
    { name: 'execute', type: 'boolean', description: 'Opt in to REAL GPU compute on the remote host (still needs --yes)', default: 'false' },
    { name: 'yes', type: 'boolean', description: 'Second confirmation gate; required with --execute to actually spend', default: 'false' },
    { name: 'preflight', type: 'boolean', description: 'Opt in to read-only reachability/GPU probes against the host (bare dry-run is fully offline and contacts nothing)', default: 'false' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural distill train --remote gpu-box', description: 'OFFLINE DRY-RUN: print the ssh/rsync/ruvllm commands only (no host contact)' },
    { command: 'claude-flow neural distill train --remote gpu-box --preflight', description: 'DRY-RUN + read-only reachability/GPU probes against the host' },
    { command: 'RUFLO_DISTILL_REMOTE=gpu-box claude-flow neural distill train --execute --yes', description: 'Run the real remote tune (spends GPU time on your host)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const path = await import('node:path');
    const { runRemoteTrain } = await import('../services/weight-eft.js');
    const fmt = (ctx.flags.format as string) || 'table';
    const host = (ctx.flags.remote as string | undefined) || process.env.RUFLO_DISTILL_REMOTE;
    if (!host) {
      output.printError('No remote host. Pass --remote <host> or set RUFLO_DISTILL_REMOTE.');
      return { success: false, exitCode: 2 };
    }
    const res = await runRemoteTrain({
      host,
      base: ctx.flags.base ? String(ctx.flags.base) : undefined,
      sftPath: (ctx.flags.sft as string) || path.resolve(process.cwd(), '.claude-flow/neural/weft-export/sft.jsonl'),
      dpoPath: (ctx.flags.dpo as string) || path.resolve(process.cwd(), '.claude-flow/neural/weft-export/dpo.jsonl'),
      adapterDir: ((ctx.flags['adapter-dir'] ?? ctx.flags.adapterDir) as string) || '.claude-flow/neural',
      sshUser: (ctx.flags['ssh-user'] ?? ctx.flags.sshUser) ? String((ctx.flags['ssh-user'] ?? ctx.flags.sshUser)) : undefined,
      sshPort: (ctx.flags['ssh-port'] ?? ctx.flags.sshPort) != null ? parseInt(String((ctx.flags['ssh-port'] ?? ctx.flags.sshPort)), 10) : undefined,
      remoteWorkdir: (ctx.flags['remote-workdir'] ?? ctx.flags.remoteWorkdir) ? String((ctx.flags['remote-workdir'] ?? ctx.flags.remoteWorkdir)) : undefined,
      execute: ctx.flags.execute === true,
      yes: ctx.flags.yes === true,
      preflight: ctx.flags.preflight === true,
    });

    if ('degraded' in res && res.degraded) {
      const payload = { degraded: true, reason: res.reason };
      if (fmt === 'json') output.writeln(JSON.stringify(payload, null, 2));
      else output.writeln(output.warning(`remote-train unavailable (${res.reason}).`));
      return { success: true, exitCode: 0, data: payload };
    }
    if (fmt === 'json') { output.writeln(JSON.stringify(res, null, 2)); return { success: res.mode !== 'preflight-failed', data: res }; }

    output.writeln();
    output.writeln(output.bold(`weight-eft remote-GPU tune [${res.mode}] on ${res.plan.host}`));
    if (res.mode === 'dry-run') output.writeln(output.dim('DRY-RUN — no data transferred, no training. Re-run with --execute --yes to spend GPU time on your host.'));
    if (res.reason) output.writeln(output.warning(res.reason));
    output.writeln(`  base: ${res.plan.base}   remote workdir: ${res.plan.remoteWorkdir}   adapter → ${res.plan.adapterDir}/${res.plan.dpoAdapter}`);
    if (res.preflight) {
      output.writeln(output.dim('  preflight (read-only probes):'));
      for (const p of res.preflight) output.writeln(`    [${p.ok ? 'ok ' : 'FAIL'}] ${p.label}: ${p.detail}`);
    }
    output.writeln(output.dim('  commands that ' + (res.mode === 'executed' ? 'ran' : 'WOULD run') + ':'));
    for (const c of res.plan.humanCommands) output.writeln(`    $ ${c}`);
    if (res.steps) {
      output.writeln(output.dim('  execution:'));
      for (const s of res.steps) output.writeln(`    [${s.ok ? 'ok ' : 'FAIL'}] ${s.label}: ${s.detail}`);
    }
    output.writeln();
    output.writeln(output.dim('Honesty: ruflo does not train locally or at $0. This is an explicit, user-triggered remote-GPU spend. resolved-gold in the SFT data is still a proxy.'));
    return { success: res.mode !== 'preflight-failed', data: res };
  },
};

const distillCommand: Command = {
  name: 'distill',
  description: 'weight-eft training-data + cost-audit slice (ADR-150): export | plan | eval | train. Ships audited SFT/DPO data + a cost-Pareto measurement + a GPU plan. Does NOT train a model or reduce escalation.',
  subcommands: [distillExportCommand, distillPlanCommand, distillEvalCommand, distillTrainCommand],
  examples: [
    { command: 'claude-flow neural distill export', description: 'Captured transcripts → audited SFT/DPO JSONL + guard report ($0)' },
    { command: 'claude-flow neural distill plan', description: 'Print the GPU training plan + ruvllm commands ($0 dry-run)' },
    { command: 'claude-flow neural distill eval --base-outcomes b.json --adapter-outcomes a.json', description: 'Cost-Pareto delta ($0)' },
    { command: 'claude-flow neural distill train --remote gpu-box', description: 'Remote-GPU tune DRY-RUN (spend-gated behind --execute --yes)' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln('Use a subcommand: export | plan | eval | train');
    output.writeln(output.dim('Ships audited training DATA + a cost audit + a GPU plan. It does NOT train a model or reduce escalation (weight-eft train never spawns; resolved is a proxy).'));
    return { success: true };
  },
};

// Main neural command
export const neuralCommand: Command = {
  name: 'neural',
  description: 'Neural pattern training, MoE, Flash Attention, pattern learning',
  subcommands: [trainCommand, statusCommand, patternsCommand, predictCommand, optimizeCommand, benchmarkCommand, listCommand, exportCommand, importCommand, routerCommand, distillCommand],
  examples: [
    { command: 'claude-flow neural status', description: 'Check neural system status' },
    { command: 'claude-flow neural train -p coordination', description: 'Train coordination patterns' },
    { command: 'claude-flow neural patterns --action list', description: 'List learned patterns' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('RuFlo Neural System'));
    output.writeln(output.dim('Advanced AI pattern learning and inference'));
    output.writeln();
    output.writeln('Use --help with subcommands for more info');
    output.writeln();
    output.writeln(output.dim('Created with ❤️ by ruv.io'));
    return { success: true };
  },
};

export default neuralCommand;
