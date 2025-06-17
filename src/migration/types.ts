/**
 * Migration type definitions
 */

export type MigrationStrategy = 'full' | 'selective' | 'merge';

export interface MigrationOptions {
  projectPath: string;
  strategy: MigrationStrategy;
  backupDir?: string;
  force?: boolean;
  dryRun?: boolean;
  preserveCustom?: boolean;
  skipValidation?: boolean;
}

export interface MigrationAnalysis {
  projectPath: string;
  hasClaudeFolder: boolean;
  hasOptimizedPrompts: boolean;
  customCommands: string[];
  customConfigurations: Record<string, any>;
  conflictingFiles: string[];
  migrationRisks: MigrationRisk[];
  recommendations: string[];
  timestamp: Date;
}

export interface MigrationRisk {
  level: 'low' | 'medium' | 'high';
  description: string;
  file?: string;
  mitigation?: string;
}

export interface MigrationBackup {
  timestamp: Date;
  version: string;
  files: BackupFile[];
  metadata: Record<string, any>;
}

export interface BackupFile {
  path: string;
  content: string;
  checksum: string;
  permissions?: string;
}

export interface MigrationResult {
  success: boolean;
  filesModified: string[];
  filesCreated: string[];
  filesBackedUp: string[];
  errors: MigrationError[];
  warnings: string[];
  rollbackPath?: string;
}

export interface MigrationError {
  file?: string;
  error: string;
  stack?: string;
}

export interface ValidationResult {
  valid: boolean;
  checks: ValidationCheck[];
  errors: string[];
  warnings: string[];
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  message?: string;
  details?: any;
}

export interface MigrationManifest {
  version: string;
  files: {
    commands: Record<string, CommandMigration>;
    configurations: Record<string, ConfigMigration>;
    templates: Record<string, TemplateMigration>;
  };
  dependencies?: string[];
}

export interface CommandMigration {
  source: string;
  target: string;
  transform?: 'copy' | 'merge' | 'replace';
  priority?: number;
}

export interface ConfigMigration {
  source: string;
  target: string;
  merge?: boolean;
  transform?: (config: any) => any;
}

export interface TemplateMigration {
  source: string;
  target: string;
  variables?: Record<string, string>;
}

export interface MigrationProgress {
  total: number;
  completed: number;
  current: string;
  phase: 'analyzing' | 'backing-up' | 'migrating' | 'validating' | 'complete';
  errors: number;
  warnings: number;
}