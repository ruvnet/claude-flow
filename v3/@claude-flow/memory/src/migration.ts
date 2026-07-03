/**
 * V3 Memory Migration Utility
 *
 * Migrates data from legacy memory systems (SQLite, Markdown, JSON, etc.)
 * to the unified AgentDB-backed memory system with HNSW indexing.
 *
 * @module v3/memory/migration
 */

import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  MigrationConfig,
  MigrationProgress,
  MigrationResult,
  MigrationError,
  MigrationSource,
  MemoryEntry,
  MemoryType,
  MemoryEntryInput,
  EmbeddingGenerator,
  BatchEmbeddingGenerator,
  createDefaultEntry,
} from './types.js';
import { AgentDBAdapter } from './agentdb-adapter.js';

/**
 * Default migration configuration
 */
const DEFAULT_MIGRATION_CONFIG: Partial<MigrationConfig> = {
  batchSize: 100,
  generateEmbeddings: true,
  validateData: true,
  continueOnError: true,
  embeddingConcurrency: 8,
};

/**
 * Legacy entry format (common structure)
 */
interface LegacyEntry {
  id?: string;
  key: string;
  value: unknown;
  namespace?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  timestamp?: number;
  createdAt?: string | number;
  updatedAt?: string | number;
  created_at?: string | number;
  updated_at?: string | number;
}

/**
 * Memory Migration Manager
 *
 * Handles migration from:
 * - SQLite backends (.db files)
 * - Markdown backends (.md files)
 * - JSON memory stores (.json files)
 * - MemoryManager instances
 * - SwarmMemory instances
 * - DistributedMemory instances
 */
export class MemoryMigrator extends EventEmitter {
  private config: MigrationConfig;
  private target: AgentDBAdapter;
  private embeddingGenerator?: EmbeddingGenerator;
  private batchEmbeddingGenerator?: BatchEmbeddingGenerator;
  private progress: MigrationProgress;

  constructor(
    target: AgentDBAdapter,
    config: Partial<MigrationConfig>,
    embeddingGenerator?: EmbeddingGenerator,
    batchEmbeddingGenerator?: BatchEmbeddingGenerator
  ) {
    super();
    this.target = target;
    this.config = { ...DEFAULT_MIGRATION_CONFIG, ...config } as MigrationConfig;
    this.embeddingGenerator = embeddingGenerator;
    this.batchEmbeddingGenerator = batchEmbeddingGenerator;
    this.progress = this.initializeProgress();
  }

  /**
   * Run the migration
   */
  async migrate(): Promise<MigrationResult> {
    const startTime = Date.now();
    this.progress = this.initializeProgress();

    this.emit('migration:started', { source: this.config.source });

    try {
      // Load entries from source
      const entries = await this.loadFromSource();
      this.progress.total = entries.length;
      this.progress.totalBatches = Math.ceil(entries.length / this.config.batchSize);

      this.emit('migration:progress', { ...this.progress });

      // Process in batches
      for (let i = 0; i < entries.length; i += this.config.batchSize) {
        const batch = entries.slice(i, i + this.config.batchSize);
        this.progress.currentBatch = Math.floor(i / this.config.batchSize) + 1;

        await this.processBatch(batch);

        this.progress.percentage = Math.round(
          (this.progress.migrated / this.progress.total) * 100
        );
        this.progress.estimatedTimeRemaining = this.estimateTimeRemaining(
          startTime,
          this.progress.migrated,
          this.progress.total
        );

        this.emit('migration:progress', { ...this.progress });
      }

      const duration = Date.now() - startTime;

      const result: MigrationResult = {
        success: this.progress.failed === 0 || this.config.continueOnError,
        progress: { ...this.progress },
        duration,
        summary: this.generateSummary(),
      };

      this.emit('migration:completed', result);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      const result: MigrationResult = {
        success: false,
        progress: { ...this.progress },
        duration,
        summary: `Migration failed: ${(error as Error).message}`,
      };

      this.emit('migration:failed', { error, result });
      return result;
    }
  }

  /**
   * Get current migration progress
   */
  getProgress(): MigrationProgress {
    return { ...this.progress };
  }

  // ===== Source Loaders =====

  private async loadFromSource(): Promise<LegacyEntry[]> {
    switch (this.config.source) {
      case 'sqlite':
        return this.loadFromSQLite();
      case 'markdown':
        return this.loadFromMarkdown();
      case 'json':
        return this.loadFromJSON();
      case 'memory-manager':
        return this.loadFromMemoryManager();
      case 'swarm-memory':
        return this.loadFromSwarmMemory();
      case 'distributed-memory':
        return this.loadFromDistributedMemory();
      default:
        throw new Error(`Unknown migration source: ${this.config.source}`);
    }
  }

  private async loadFromSQLite(): Promise<LegacyEntry[]> {
    const entries: LegacyEntry[] = [];
    const dbPath = this.config.sourcePath;

    try {
      // Dynamic import for better-sqlite3 or similar
      // In production, would use actual SQLite library
      const fileContent = await fs.readFile(dbPath);

      // Parse SQLite format (simplified - actual implementation would use SQLite library)
      // For now, we'll try to read it as a JSON export format
      if (dbPath.endsWith('.json')) {
        const data = JSON.parse(fileContent.toString());
        if (Array.isArray(data)) {
          return data;
        } else if (data.entries) {
          return data.entries;
        }
      }

      // SQLite parsing would go here using better-sqlite3 or sql.js
      this.emit('migration:warning', {
        message: 'Direct SQLite parsing requires additional setup. Using export format.',
      });

      return entries;
    } catch (error) {
      throw new Error(`Failed to load SQLite: ${(error as Error).message}`);
    }
  }

  private async loadFromMarkdown(): Promise<LegacyEntry[]> {
    const entries: LegacyEntry[] = [];
    const basePath = this.config.sourcePath;

    try {
      const files = await this.walkDirectory(basePath, '.md');

      for (const filePath of files) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const entry = this.parseMarkdownEntry(filePath, content, basePath);
          if (entry) {
            entries.push(entry);
          }
        } catch (error) {
          this.addError(filePath, (error as Error).message, 'PARSE_ERROR', true);
        }
      }

      return entries;
    } catch (error) {
      throw new Error(`Failed to load Markdown: ${(error as Error).message}`);
    }
  }

  private async loadFromJSON(): Promise<LegacyEntry[]> {
    const filePath = this.config.sourcePath;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Handle different JSON formats
      if (Array.isArray(data)) {
        return data;
      } else if (data.entries) {
        return data.entries;
      } else if (typeof data === 'object') {
        // Assume it's a namespace -> entries map
        const entries: LegacyEntry[] = [];
        for (const [namespace, namespaceEntries] of Object.entries(data)) {
          if (Array.isArray(namespaceEntries)) {
            for (const entry of namespaceEntries) {
              entries.push({ ...entry, namespace });
            }
          }
        }
        return entries;
      }

      return [];
    } catch (error) {
      throw new Error(`Failed to load JSON: ${(error as Error).message}`);
    }
  }

  private async loadFromMemoryManager(): Promise<LegacyEntry[]> {
    // Would integrate with existing MemoryManager instance
    // For now, try to load from common paths
    const possiblePaths = [
      './memory/memory-store.json',
      './.swarm/memory.db',
      './memory.json',
    ];

    for (const p of possiblePaths) {
      try {
        const fullPath = path.resolve(this.config.sourcePath, p);
        await fs.access(fullPath);
        return this.loadFromJSON();
      } catch {
        continue;
      }
    }

    return [];
  }

  private async loadFromSwarmMemory(): Promise<LegacyEntry[]> {
    // Would integrate with SwarmMemory partitions
    const entries: LegacyEntry[] = [];
    const basePath = this.config.sourcePath;

    try {
      // Check for swarm memory directory structure
      const partitionsPath = path.join(basePath, '.swarm', 'memory');
      const files = await this.walkDirectory(partitionsPath, '.json');

      for (const filePath of files) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);

          // Extract namespace from file path
          const relativePath = path.relative(partitionsPath, filePath);
          const namespace = path.dirname(relativePath).replace(/\\/g, '/');

          if (Array.isArray(data)) {
            entries.push(...data.map((e: LegacyEntry) => ({ ...e, namespace })));
          } else if (data.entries) {
            entries.push(...data.entries.map((e: LegacyEntry) => ({ ...e, namespace })));
          }
        } catch (error) {
          this.addError(filePath, (error as Error).message, 'PARSE_ERROR', true);
        }
      }

      return entries;
    } catch (error) {
      return [];
    }
  }

  private async loadFromDistributedMemory(): Promise<LegacyEntry[]> {
    // Would integrate with DistributedMemorySystem nodes
    return this.loadFromSwarmMemory(); // Similar structure
  }

  // ===== Batch Processing =====

  private async processBatch(batch: LegacyEntry[]): Promise<void> {
    // Phase 1 — validate + transform (no embedding yet). Per-entry errors
    // keep the same semantics as the previous sequential loop: validation
    // failures are skipped, transform failures are failed, and one bad
    // entry never fails the batch when continueOnError is set.
    const transformed: Array<{ legacy: LegacyEntry; entry: MemoryEntry }> = [];

    for (const legacyEntry of batch) {
      try {
        if (this.config.validateData) {
          const validation = this.validateEntry(legacyEntry);
          if (!validation.valid) {
            if (this.config.continueOnError) {
              this.addError(
                legacyEntry.key || 'unknown',
                validation.reason || 'Validation failed',
                'VALIDATION_ERROR',
                false
              );
              this.progress.skipped++;
              continue;
            } else {
              throw new Error(validation.reason);
            }
          }
        }

        transformed.push({ legacy: legacyEntry, entry: this.transformEntry(legacyEntry) });
      } catch (error) {
        if (this.config.continueOnError) {
          this.addError(
            legacyEntry.key || 'unknown',
            (error as Error).message,
            'STORE_ERROR',
            true
          );
          this.progress.failed++;
        } else {
          throw error;
        }
      }
    }

    // Phase 2 — embed the whole batch at once (true batch API) or with
    // bounded concurrency. Previously this awaited one ONNX inference per
    // entry inside the loop — N sequential inferences per batch on the
    // memory_import_claude hot path. Embedding failures remain warnings:
    // the entry is still stored, just without a vector (same as before).
    if (this.config.generateEmbeddings) {
      await this.embedBatch(transformed);
    }

    // Phase 3 — store, preserving per-entry error handling.
    for (const { legacy, entry } of transformed) {
      try {
        await this.target.store(entry);
        this.progress.migrated++;
      } catch (error) {
        if (this.config.continueOnError) {
          this.addError(
            legacy.key || 'unknown',
            (error as Error).message,
            'STORE_ERROR',
            true
          );
          this.progress.failed++;
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Generate embeddings for a transformed batch.
   *
   * Strategy:
   * 1. If a {@link BatchEmbeddingGenerator} is available, embed all batch
   *    contents in ONE call (single padded forward pass on ONNX backends).
   * 2. If the batch call fails, or only a single-text generator exists,
   *    fall back to bounded-concurrency single-text embedding
   *    (config.embeddingConcurrency, default 8 — never unbounded).
   *
   * Per-entry failures emit `migration:warning` and leave that entry
   * without an embedding — one bad entry never fails the batch.
   */
  private async embedBatch(
    transformed: Array<{ legacy: LegacyEntry; entry: MemoryEntry }>
  ): Promise<void> {
    if (transformed.length === 0) return;
    if (!this.batchEmbeddingGenerator && !this.embeddingGenerator) return;

    // Preferred path: one true batch call for all contents.
    if (this.batchEmbeddingGenerator) {
      try {
        const embeddings = await this.batchEmbeddingGenerator(
          transformed.map(({ entry }) => entry.content)
        );
        if (embeddings.length !== transformed.length) {
          throw new Error(
            `Batch embedding generator returned ${embeddings.length} vectors for ${transformed.length} inputs`
          );
        }
        for (let i = 0; i < transformed.length; i++) {
          transformed[i].entry.embedding = embeddings[i];
        }
        return;
      } catch (error) {
        this.emit('migration:warning', {
          message: `Batch embedding failed (${(error as Error).message}); falling back to per-entry embedding`,
        });
        // Fall through to the bounded-concurrency path if possible.
        if (!this.embeddingGenerator) return;
      }
    }

    // Fallback: bounded concurrency over the single-text generator.
    const generator = this.embeddingGenerator!;
    const concurrency = Math.max(1, this.config.embeddingConcurrency ?? 8);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < transformed.length) {
        const i = nextIndex++;
        const { legacy, entry } = transformed[i];
        try {
          entry.embedding = await generator(entry.content);
        } catch (error) {
          this.emit('migration:warning', {
            message: `Failed to generate embedding for ${legacy.key}: ${(error as Error).message}`,
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, transformed.length) }, () => worker())
    );
  }

  private transformEntry(legacy: LegacyEntry): MemoryEntry {
    // Map namespace if configured
    let namespace = legacy.namespace || 'default';
    if (this.config.namespaceMapping && this.config.namespaceMapping[namespace]) {
      namespace = this.config.namespaceMapping[namespace];
    }

    // Determine content
    const content =
      typeof legacy.value === 'string'
        ? legacy.value
        : JSON.stringify(legacy.value);

    // Map type if configured
    let type: MemoryType = 'semantic';
    if (legacy.metadata?.type && typeof legacy.metadata.type === 'string') {
      if (this.config.typeMapping && this.config.typeMapping[legacy.metadata.type]) {
        type = this.config.typeMapping[legacy.metadata.type];
      } else if (this.isValidMemoryType(legacy.metadata.type)) {
        type = legacy.metadata.type as MemoryType;
      }
    }

    // Parse timestamps
    const createdAt = this.parseTimestamp(
      legacy.createdAt || legacy.created_at || legacy.timestamp
    );
    const updatedAt = this.parseTimestamp(
      legacy.updatedAt || legacy.updated_at || legacy.timestamp
    );

    const input: MemoryEntryInput = {
      key: legacy.key,
      content,
      type,
      namespace,
      tags: legacy.tags || [],
      metadata: {
        ...legacy.metadata,
        migrated: true,
        migrationSource: this.config.source,
        migrationTimestamp: Date.now(),
        originalValue: legacy.value,
      },
    };

    const entry = createDefaultEntry(input);
    entry.createdAt = createdAt;
    entry.updatedAt = updatedAt;

    // Embeddings are generated batch-wise in embedBatch() — not here.
    return entry;
  }

  // ===== Helper Methods =====

  private initializeProgress(): MigrationProgress {
    return {
      total: 0,
      migrated: 0,
      failed: 0,
      skipped: 0,
      currentBatch: 0,
      totalBatches: 0,
      percentage: 0,
      estimatedTimeRemaining: 0,
      errors: [],
    };
  }

  private validateEntry(entry: LegacyEntry): { valid: boolean; reason?: string } {
    if (!entry.key || typeof entry.key !== 'string') {
      return { valid: false, reason: 'Missing or invalid key' };
    }

    if (entry.value === undefined) {
      return { valid: false, reason: 'Missing value' };
    }

    if (entry.key.length > 500) {
      return { valid: false, reason: 'Key too long (max 500 chars)' };
    }

    return { valid: true };
  }

  private addError(
    entryId: string,
    message: string,
    code: string,
    recoverable: boolean
  ): void {
    const error: MigrationError = {
      entryId,
      message,
      code,
      recoverable,
    };
    this.progress.errors.push(error);
    this.emit('migration:error', error);
  }

  private parseTimestamp(value: string | number | undefined): number {
    if (!value) return Date.now();

    if (typeof value === 'number') {
      // Handle both milliseconds and seconds
      return value > 1e12 ? value : value * 1000;
    }

    const parsed = Date.parse(value);
    return isNaN(parsed) ? Date.now() : parsed;
  }

  private isValidMemoryType(type: string): boolean {
    return ['episodic', 'semantic', 'procedural', 'working', 'cache'].includes(type);
  }

  private estimateTimeRemaining(
    startTime: number,
    completed: number,
    total: number
  ): number {
    if (completed === 0) return 0;

    const elapsed = Date.now() - startTime;
    const rate = completed / elapsed;
    const remaining = total - completed;

    return Math.round(remaining / rate);
  }

  private generateSummary(): string {
    const { migrated, failed, skipped, total, errors } = this.progress;

    let summary = `Migrated ${migrated}/${total} entries`;

    if (failed > 0) {
      summary += `, ${failed} failed`;
    }

    if (skipped > 0) {
      summary += `, ${skipped} skipped`;
    }

    if (errors.length > 0) {
      const errorTypes = new Map<string, number>();
      for (const error of errors) {
        errorTypes.set(error.code, (errorTypes.get(error.code) || 0) + 1);
      }

      const errorSummary = Array.from(errorTypes.entries())
        .map(([code, count]) => `${code}: ${count}`)
        .join(', ');

      summary += `. Errors: ${errorSummary}`;
    }

    return summary;
  }

  private async walkDirectory(dir: string, extension: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const subFiles = await this.walkDirectory(fullPath, extension);
          files.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith(extension)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Directory doesn't exist or isn't readable
    }

    return files;
  }

  private parseMarkdownEntry(
    filePath: string,
    content: string,
    basePath: string
  ): LegacyEntry | null {
    // Extract frontmatter if present
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    let metadata: Record<string, unknown> = {};
    let body = content;

    if (frontmatterMatch) {
      try {
        // Simple YAML-like parsing
        const frontmatter = frontmatterMatch[1];
        for (const line of frontmatter.split('\n')) {
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            let value: unknown = line.substring(colonIndex + 1).trim();

            // Parse common types
            if (value === 'true') value = true;
            else if (value === 'false') value = false;
            else if (typeof value === 'string' && /^\d+$/.test(value)) value = parseInt(value, 10);
            else if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
              try {
                value = JSON.parse(value.replace(/'/g, '"'));
              } catch {
                // Keep as string
              }
            }

            metadata[key] = value;
          }
        }
        body = frontmatterMatch[2];
      } catch {
        // Failed to parse frontmatter, use whole content
      }
    }

    // Derive key from file path
    const relativePath = path.relative(basePath, filePath);
    const key = relativePath
      .replace(/\\/g, '/')
      .replace(/\.md$/, '')
      .replace(/\//g, ':');

    // Derive namespace from directory structure
    const namespace = path.dirname(relativePath).replace(/\\/g, '/') || 'default';

    return {
      key,
      value: body.trim(),
      namespace,
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      metadata,
      timestamp: Date.now(),
    };
  }
}

/**
 * Convenience function to create a migrator
 */
export function createMigrator(
  target: AgentDBAdapter,
  source: MigrationSource,
  sourcePath: string,
  options: Partial<MigrationConfig> = {},
  embeddingGenerator?: EmbeddingGenerator,
  batchEmbeddingGenerator?: BatchEmbeddingGenerator
): MemoryMigrator {
  return new MemoryMigrator(
    target,
    { source, sourcePath, ...options },
    embeddingGenerator,
    batchEmbeddingGenerator
  );
}

/**
 * Migrate from multiple sources
 */
export async function migrateMultipleSources(
  target: AgentDBAdapter,
  sources: Array<{ source: MigrationSource; path: string }>,
  options: Partial<MigrationConfig> = {},
  embeddingGenerator?: EmbeddingGenerator,
  batchEmbeddingGenerator?: BatchEmbeddingGenerator
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];

  for (const { source, path: sourcePath } of sources) {
    const migrator = createMigrator(
      target,
      source,
      sourcePath,
      options,
      embeddingGenerator,
      batchEmbeddingGenerator
    );
    const result = await migrator.migrate();
    results.push(result);
  }

  return results;
}

export default MemoryMigrator;
