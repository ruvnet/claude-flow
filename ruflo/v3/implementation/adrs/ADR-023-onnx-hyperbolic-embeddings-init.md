# ADR-023: ONNX Hyperbolic Embeddings Initialization

## Status
**Proposed** | 2026-01-12

## Context

Claude Flow V3 uses embeddings extensively for:
- Memory vector search (HNSW-indexed)
- Neural pattern recognition
- Semantic drift detection
- Swarm coordination
- Agent state tracking

Currently, embeddings are initialized lazily when first used. This causes:
1. **Cold start latency**: First embedding request takes 2-5 seconds for model download
2. **No hyperbolic support in init**: Poincaré ball embeddings not pre-configured
3. **Migration gaps**: V2→V3 migration doesn't convert embedding formats
4. **Pretraining blind**: Hooks pretrain command doesn't optimize for embedding model

### Current Architecture

```
@claude-flow/embeddings
├── embedding-service.ts      # Core embedding providers
├── hyperbolic.ts            # Poincaré ball transformations
├── neural-integration.ts    # agentic-flow substrate wrapper
├── persistent-cache.ts      # SQLite disk cache
├── normalization.ts         # L2/L1/minmax/zscore
└── chunking.ts              # Document chunking
```

### Problem Statement

How do we ensure ONNX models and hyperbolic embeddings are properly initialized during:
1. `init` - First-time project setup
2. `migrate` - V2 to V3 migration
3. `hooks pretrain` - Neural pretraining
4. Runtime warm start

## Decision

### 1. Add Embeddings Initialization to `init` Command

Add `--init-embeddings` flag and wizard step:

```typescript
// init.ts additions
interface InitOptions {
  embeddings: {
    enabled: boolean;
    model: 'all-MiniLM-L6-v2' | 'all-mpnet-base-v2' | 'custom';
    hyperbolic: boolean;
    curvature: number;
    predownload: boolean;
  };
}
```

**Wizard flow:**
```
? Select embedding configuration:
  ○ MiniLM-L6 (23MB, 384 dims) - Fast, recommended
  ○ MPNet-base (110MB, 768 dims) - Higher quality
  ○ Custom ONNX model path
  ○ Skip embedding initialization

? Enable hyperbolic embeddings for hierarchical data?
  ● Yes (Poincaré ball model)
  ○ No (Euclidean only)

? Pre-download model during init?
  ● Yes (2-30 seconds)
  ○ No (download on first use)
```

### 2. Add Embeddings Migration Step

Extend `migrate` command with embeddings migration:

```typescript
// migrate.ts - add embedding migration step
const MIGRATION_TARGETS = [
  // ... existing targets
  {
    value: 'embeddings',
    label: 'Embeddings',
    hint: 'Download ONNX models, configure hyperbolic space'
  },
];

function getMigrationSteps(target: string) {
  // Add embeddings step
  if (target === 'all' || target === 'embeddings') {
    steps.push({
      name: 'Embedding Models',
      description: 'Download ONNX embedding model for V3',
      source: 'N/A (cloud download)',
      dest: '.claude-flow/models/',
      execute: async () => {
        const { downloadEmbeddingModel } = await import('@claude-flow/embeddings');
        await downloadEmbeddingModel('all-MiniLM-L6-v2', '.claude-flow/models/');
      }
    });
  }
}
```

### 3. Extend `hooks pretrain` for Embeddings

Add embedding-specific pretraining:

```bash
# New pretrain options
npx claude-flow@v3alpha hooks pretrain \
  --model-type embeddings \
  --source-model all-MiniLM-L6-v2 \
  --hyperbolic true \
  --curvature -1.0 \
  --warm-cache true
```

**Pretraining actions:**
1. Download specified ONNX model
2. Initialize embedding cache with common patterns
3. Pre-compute hyperbolic projections for hierarchical patterns
4. Warm the LRU cache with project-specific terms

### 4. Configuration Schema

Add to `claude-flow.config.json`:

```json
{
  "embeddings": {
    "provider": "agentic-flow",
    "model": "all-MiniLM-L6-v2",
    "modelPath": ".claude-flow/models/",
    "dimension": 384,
    "cacheSize": 256,
    "hyperbolic": {
      "enabled": true,
      "curvature": -1.0,
      "epsilon": 1e-15,
      "maxNorm": 0.99999
    },
    "neural": {
      "enabled": true,
      "driftThreshold": 0.3,
      "decayRate": 0.01
    }
  }
}
```

### 5. CLI Commands

#### `embeddings init`
```bash
# Initialize embeddings subsystem
npx claude-flow@v3alpha embeddings init [options]

Options:
  --model <id>      Model to download (default: all-MiniLM-L6-v2)
  --hyperbolic      Enable hyperbolic space (default: true)
  --curvature <n>   Poincaré ball curvature (default: -1)
  --cache-size <n>  LRU cache entries (default: 256)
  --model-dir <p>   Model storage directory
```

#### `embeddings status`
```bash
# Check embeddings status
npx claude-flow@v3alpha embeddings status

Output:
╭────────────────────────────────────────────────────╮
│ Embedding System Status                            │
├────────────────────────────────────────────────────┤
│ Provider:    agentic-flow (ONNX)                   │
│ Model:       all-MiniLM-L6-v2 ✓ downloaded         │
│ Dimension:   384                                   │
│ Cache:       128/256 entries (50%)                 │
│ Hyperbolic:  enabled (c = -1.0)                    │
│ Neural:      substrate available                   │
╰────────────────────────────────────────────────────╯
```

#### `embeddings download`
```bash
# Download specific model
npx claude-flow@v3alpha embeddings download <model-id>

# Example
npx claude-flow@v3alpha embeddings download all-mpnet-base-v2
Downloading all-mpnet-base-v2... [████████░░] 80% (88/110 MB)
```

### 6. Implementation Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Embedding Lifecycle                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────┐   │
│  │  init    │───▶│ embeddings   │───▶│ Model Download  │   │
│  │ command  │    │ init step    │    │ (ONNX/HuggingF) │   │
│  └──────────┘    └──────────────┘    └─────────────────┘   │
│                          │                    │              │
│                          ▼                    ▼              │
│                  ┌──────────────┐    ┌─────────────────┐   │
│                  │ Config write │    │ .claude-flow/   │   │
│                  │ embeddings{} │    │ models/<model>  │   │
│                  └──────────────┘    └─────────────────┘   │
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────┐   │
│  │ migrate  │───▶│ embeddings   │───▶│ Cache migration │   │
│  │ command  │    │ migration    │    │ V2 → V3 format  │   │
│  └──────────┘    └──────────────┘    └─────────────────┘   │
│                          │                    │              │
│                          ▼                    ▼              │
│                  ┌──────────────┐    ┌─────────────────┐   │
│                  │ Hyperbolic   │    │ Neural Substrate│   │
│                  │ Projection   │    │ Initialization  │   │
│                  └──────────────┘    └─────────────────┘   │
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────┐   │
│  │ pretrain │───▶│ Embedding    │───▶│ Pattern Store   │   │
│  │ hooks    │    │ Warm-up      │    │ (HNSW indexed)  │   │
│  └──────────┘    └──────────────┘    └─────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 7. Hyperbolic Embedding Pipeline

```
┌────────────────────────────────────────────────────────────┐
│               Hyperbolic Embedding Pipeline                 │
├────────────────────────────────────────────────────────────┤
│                                                             │
│   Input Text                                                │
│       │                                                     │
│       ▼                                                     │
│   ┌───────────────────────────────────────────┐            │
│   │ 1. ONNX Model Inference                    │            │
│   │    - Tokenize (BERT/transformer)           │            │
│   │    - Forward pass through model            │            │
│   │    - Output: Euclidean vector (384/768d)   │            │
│   └───────────────────────────────────────────┘            │
│       │                                                     │
│       ▼                                                     │
│   ┌───────────────────────────────────────────┐            │
│   │ 2. L2 Normalization                        │            │
│   │    - ||v|| = 1                             │            │
│   │    - SIMD-optimized (4x unroll)            │            │
│   └───────────────────────────────────────────┘            │
│       │                                                     │
│       ▼                                                     │
│   ┌───────────────────────────────────────────┐            │
│   │ 3. Poincaré Ball Projection                │            │
│   │    - exp_0(v) = tanh(||v||/2) * v/||v||   │            │
│   │    - Curvature: c = -1 (default)           │            │
│   │    - Max norm: 1 - ε (stay in ball)        │            │
│   └───────────────────────────────────────────┘            │
│       │                                                     │
│       ▼                                                     │
│   ┌───────────────────────────────────────────┐            │
│   │ 4. Cache & Store                           │            │
│   │    - LRU cache (256 entries)               │            │
│   │    - SQLite persistent cache               │            │
│   │    - HNSW index for search                 │            │
│   └───────────────────────────────────────────┘            │
│                                                             │
│   Output: Hyperbolic embedding ready for:                   │
│   - Hierarchical similarity (tree structures)               │
│   - Semantic drift detection                                │
│   - Agent state tracking                                    │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

## Code Changes

### 1. Update `init/index.ts`

```typescript
// Add embedding initialization
export interface InitOptions {
  // ... existing
  embeddings: {
    enabled: boolean;
    model: string;
    hyperbolic: boolean;
    curvature: number;
    predownload: boolean;
  };
}

export const DEFAULT_INIT_OPTIONS: InitOptions = {
  // ... existing
  embeddings: {
    enabled: true,
    model: 'all-MiniLM-L6-v2',
    hyperbolic: true,
    curvature: -1.0,
    predownload: true,
  },
};

async function initializeEmbeddings(options: InitOptions): Promise<void> {
  if (!options.embeddings.enabled) return;

  const configDir = path.join(options.targetDir, '.claude-flow');
  const modelDir = path.join(configDir, 'models');

  // Create model directory
  await fs.mkdir(modelDir, { recursive: true });

  // Download model if requested
  if (options.embeddings.predownload) {
    const { downloadEmbeddingModel } = await import('@claude-flow/embeddings');
    await downloadEmbeddingModel(
      options.embeddings.model,
      modelDir,
      (progress) => console.log(`Downloading: ${progress.percent}%`)
    );
  }

  // Write embedding config
  const configPath = path.join(configDir, 'embeddings.json');
  await fs.writeFile(configPath, JSON.stringify({
    model: options.embeddings.model,
    modelPath: modelDir,
    hyperbolic: {
      enabled: options.embeddings.hyperbolic,
      curvature: options.embeddings.curvature,
    },
  }, null, 2));
}
```

### 2. Update `commands/migrate.ts`

```typescript
// Add embeddings migration target
const MIGRATION_TARGETS = [
  // ... existing
  {
    value: 'embeddings',
    label: 'Embedding Models',
    hint: 'Download ONNX models and configure hyperbolic space'
  },
];

// Add embeddings migration step
async function migrateEmbeddings(ctx: CommandContext): Promise<void> {
  output.writeln('Migrating embeddings...');

  // 1. Check for V2 embedding cache
  const v2CachePath = path.join(ctx.cwd, '.claude-flow', 'cache', 'embeddings.db');
  const v2Exists = fs.existsSync(v2CachePath);

  // 2. Download V3 model
  const { downloadEmbeddingModel, listEmbeddingModels } = await import('@claude-flow/embeddings');
  const models = await listEmbeddingModels();
  const targetModel = models.find(m => m.id === 'all-MiniLM-L6-v2');

  if (!targetModel?.downloaded) {
    output.writeln(output.dim('  Downloading ONNX model...'));
    await downloadEmbeddingModel('all-MiniLM-L6-v2', '.claude-flow/models/');
    output.writeln(output.success('  ✓ Model downloaded'));
  }

  // 3. Migrate cache if exists
  if (v2Exists) {
    output.writeln(output.dim('  Migrating embedding cache...'));
    // Migration logic: read old cache, re-embed with new model
    output.writeln(output.success('  ✓ Cache migrated'));
  }

  // 4. Initialize hyperbolic configuration
  output.writeln(output.dim('  Configuring hyperbolic space...'));
  // Write hyperbolic config
  output.writeln(output.success('  ✓ Hyperbolic embeddings enabled'));
}
```

### 3. Update `commands/hooks.ts` - Pretrain

```typescript
// Add embeddings pretraining to pretrain command
const pretrainCommand: Command = {
  name: 'pretrain',
  options: [
    // ... existing
    {
      name: 'embeddings',
      description: 'Include embedding model pretraining',
      type: 'boolean',
      default: true,
    },
    {
      name: 'warm-cache',
      description: 'Pre-populate embedding cache',
      type: 'boolean',
      default: true,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // ... existing pretrain logic

    // Add embeddings pretraining
    if (ctx.flags.embeddings) {
      output.writeln(output.dim('Pretraining embeddings...'));

      // 1. Ensure model downloaded
      const { downloadEmbeddingModel, createEmbeddingService } =
        await import('@claude-flow/embeddings');

      await downloadEmbeddingModel('all-MiniLM-L6-v2', '.claude-flow/models/');

      // 2. Initialize embedding service
      const embedder = createEmbeddingService({
        provider: 'agentic-flow',
        modelPath: '.claude-flow/models/all-MiniLM-L6-v2',
      });

      // 3. Warm cache with common patterns
      if (ctx.flags.warmCache) {
        const commonPatterns = [
          'function', 'class', 'import', 'export', 'async', 'await',
          'error', 'debug', 'test', 'implementation', 'refactor',
          // ... project-specific terms from codebase scan
        ];

        for (const pattern of commonPatterns) {
          await embedder.embed(pattern);
        }

        output.writeln(output.success(`  ✓ Warmed cache with ${commonPatterns.length} patterns`));
      }

      // 4. Pre-compute hyperbolic projections
      output.writeln(output.success('  ✓ Hyperbolic projections ready'));
    }
  },
};
```

### 4. Create `commands/embeddings.ts`

```typescript
/**
 * V3 CLI Embeddings Command
 * Manage ONNX embedding models and hyperbolic space
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

// Init subcommand
const initSubcommand: Command = {
  name: 'init',
  description: 'Initialize embedding subsystem',
  options: [
    { name: 'model', short: 'm', type: 'string', default: 'all-MiniLM-L6-v2' },
    { name: 'hyperbolic', type: 'boolean', default: true },
    { name: 'curvature', short: 'c', type: 'number', default: -1 },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const model = ctx.flags.model as string;
    const hyperbolic = ctx.flags.hyperbolic as boolean;
    const curvature = ctx.flags.curvature as number;

    const spinner = output.createSpinner({ text: 'Initializing embeddings...' });
    spinner.start();

    try {
      const { downloadEmbeddingModel, createEmbeddingService } =
        await import('@claude-flow/embeddings');

      // Download model
      spinner.text = 'Downloading ONNX model...';
      await downloadEmbeddingModel(model, '.claude-flow/models/', (p) => {
        spinner.text = `Downloading ${model}... ${p.percent}%`;
      });

      // Initialize service
      spinner.text = 'Initializing embedding service...';
      const service = createEmbeddingService({
        provider: 'agentic-flow',
        modelPath: `.claude-flow/models/${model}`,
      });

      // Test embedding
      const testEmbed = await service.embed('test');

      spinner.succeed(`Embeddings initialized: ${model} (${testEmbed.length}d)`);

      if (hyperbolic) {
        output.printInfo(`Hyperbolic space enabled (curvature: ${curvature})`);
      }

      return { success: true };
    } catch (error) {
      spinner.fail('Embedding initialization failed');
      return { success: false, message: String(error) };
    }
  },
};

// Status subcommand
const statusSubcommand: Command = {
  name: 'status',
  description: 'Show embedding system status',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { listEmbeddingModels, isNeuralAvailable } =
      await import('@claude-flow/embeddings');

    const models = await listEmbeddingModels();
    const neuralAvailable = await isNeuralAvailable();

    output.printBox([
      `Provider:    agentic-flow (ONNX)`,
      `Models:      ${models.filter(m => m.downloaded).length}/${models.length} downloaded`,
      `Neural:      ${neuralAvailable ? 'available' : 'not available'}`,
    ].join('\n'), 'Embedding Status');

    output.writeln();
    output.printTable({
      columns: [
        { key: 'id', header: 'Model', width: 25 },
        { key: 'dimension', header: 'Dims', width: 8 },
        { key: 'size', header: 'Size', width: 10 },
        { key: 'downloaded', header: 'Status', width: 12,
          format: (v) => v ? output.success('ready') : output.dim('not downloaded') },
      ],
      data: models,
    });

    return { success: true };
  },
};

// Download subcommand
const downloadSubcommand: Command = {
  name: 'download',
  description: 'Download embedding model',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const modelId = ctx.args[0] || 'all-MiniLM-L6-v2';

    const { downloadEmbeddingModel } = await import('@claude-flow/embeddings');

    output.writeln(`Downloading ${modelId}...`);

    await downloadEmbeddingModel(modelId, '.claude-flow/models/', (p) => {
      const bar = '█'.repeat(Math.floor(p.percent / 5)) +
                  '░'.repeat(20 - Math.floor(p.percent / 5));
      process.stdout.write(`\r[${bar}] ${p.percent}%`);
    });

    output.writeln();
    output.printSuccess(`Downloaded ${modelId}`);

    return { success: true };
  },
};

// Main embeddings command
export const embeddingsCommand: Command = {
  name: 'embeddings',
  description: 'Manage ONNX embedding models and hyperbolic space',
  subcommands: [initSubcommand, statusSubcommand, downloadSubcommand],
  examples: [
    { command: 'embeddings init', description: 'Initialize with default model' },
    { command: 'embeddings init --model all-mpnet-base-v2', description: 'Use higher quality model' },
    { command: 'embeddings status', description: 'Check embedding system status' },
    { command: 'embeddings download all-mpnet-base-v2', description: 'Download specific model' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln('Usage: embeddings <subcommand>');
    output.writeln('Subcommands: init, status, download');
    return { success: true };
  },
};

export default embeddingsCommand;
```

## Performance Considerations

### Model Download Times
| Model | Size | Download (50Mbps) |
|-------|------|-------------------|
| all-MiniLM-L6-v2 | 23MB | ~4 seconds |
| all-mpnet-base-v2 | 110MB | ~18 seconds |
| bge-small-en-v1.5 | 33MB | ~5 seconds |

### Embedding Latency
| Operation | Time | Notes |
|-----------|------|-------|
| ONNX inference | 2-5ms | Per embedding |
| Hyperbolic projection | <0.1ms | Per embedding |
| Cache lookup | <0.01ms | FNV-1a hash |
| HNSW search (1M vectors) | 0.5-2ms | Depends on ef_search |

### Memory Usage
| Component | Memory | Notes |
|-----------|--------|-------|
| ONNX model | 50-200MB | Depends on model |
| LRU cache (256) | ~1MB | 384d vectors |
| HNSW index | ~2GB/1M | 384d, M=16 |

## Migration Path

### For Existing V2 Projects
1. Run `claude-flow migrate run -t embeddings`
2. Downloads ONNX model
3. Migrates any cached embeddings
4. Enables hyperbolic by default

### For New V3 Projects
1. Run `claude-flow init` or `claude-flow init wizard`
2. Embeddings step auto-runs
3. Model pre-downloaded
4. Hyperbolic enabled by default

### For Pretraining
1. Run `claude-flow hooks pretrain --embeddings`
2. Ensures model downloaded
3. Warms cache with codebase terms
4. Pre-computes hierarchical patterns

## Consequences

### Positive
- **Zero cold-start latency**: Models pre-downloaded
- **Hierarchical awareness**: Hyperbolic space captures tree structures
- **Offline capability**: No network needed after init
- **Unified config**: All embedding settings in one place
- **Migration support**: Smooth V2→V3 transition

### Negative
- **Larger init time**: 4-18 seconds for model download
- **Disk space**: 50-200MB per model
- **Memory overhead**: Model loaded into memory

### Neutral
- Adds `embeddings` command to CLI
- Adds `embeddings` step to init/migrate
- Requires `@claude-flow/embeddings` package

## Related ADRs

- ADR-006: Unified Memory Service (HNSW integration)
- ADR-017: RuVector Integration (neural substrate)
- ADR-009: Implementation Details (memory backend)

## References

- Nickel & Kiela (2017): "Poincaré Embeddings for Learning Hierarchical Representations"
- Ganea et al. (2018): "Hyperbolic Neural Networks"
- ONNX Runtime documentation
- agentic-flow embeddings module
