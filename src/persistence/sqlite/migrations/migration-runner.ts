import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { getDatabase, initializeDatabase } from '../database';
import Database from 'better-sqlite3';

export interface Migration {
  version: string;
  filename: string;
  description: string;
  sql: string;
}

export class MigrationRunner {
  private migrations: Migration[] = [];
  private migrationsPath: string;

  constructor(migrationsPath: string = __dirname) {
    this.migrationsPath = migrationsPath;
    this.loadMigrations();
  }

  private loadMigrations(): void {
    const files = readdirSync(this.migrationsPath)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const content = readFileSync(join(this.migrationsPath, file), 'utf-8');
      const version = file.match(/^(\d+)_/)?.[1] || '000';
      
      // Extract description from first comment line
      const descriptionMatch = content.match(/^--\s*(.+)$/m);
      const description = descriptionMatch?.[1] || basename(file, '.sql');

      this.migrations.push({
        version,
        filename: file,
        description,
        sql: content
      });
    }
  }

  async getCurrentVersion(): Promise<string | null> {
    const db = getDatabase();
    return db.withConnection(conn => {
      // Check if migrations table exists
      const tableExists = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
      ).get();

      if (!tableExists) {
        return null;
      }

      const result = conn.prepare(
        'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
      ).get() as any;

      return result?.version || null;
    });
  }

  async getPendingMigrations(): Promise<Migration[]> {
    const currentVersion = await this.getCurrentVersion();
    
    if (!currentVersion) {
      return this.migrations;
    }

    return this.migrations.filter(m => m.version > currentVersion);
  }

  async migrate(targetVersion?: string): Promise<{
    migrationsRun: string[];
    currentVersion: string;
  }> {
    const db = getDatabase();
    const migrationsRun: string[] = [];

    await db.withTransaction(async (conn) => {
      // Ensure migrations table exists
      conn.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          description TEXT
        )
      `);

      const currentVersion = await this.getCurrentVersion();
      const pendingMigrations = await this.getPendingMigrations();

      for (const migration of pendingMigrations) {
        if (targetVersion && migration.version > targetVersion) {
          break;
        }

        console.log(`Running migration ${migration.version}: ${migration.description}`);
        
        try {
          // Execute migration
          conn.exec(migration.sql);
          
          // Record migration (but only if it's not already recorded by the migration itself)
          const exists = conn.prepare(
            'SELECT 1 FROM schema_migrations WHERE version = ?'
          ).get(migration.version);

          if (!exists) {
            conn.prepare(
              'INSERT INTO schema_migrations (version, description) VALUES (?, ?)'
            ).run(migration.version, migration.description);
          }

          migrationsRun.push(migration.version);
        } catch (error) {
          console.error(`Failed to run migration ${migration.version}:`, error);
          throw error;
        }
      }
    });

    const finalVersion = await this.getCurrentVersion();
    return {
      migrationsRun,
      currentVersion: finalVersion || '000'
    };
  }

  async rollback(targetVersion: string = '000'): Promise<{
    rollbackCount: number;
    currentVersion: string;
  }> {
    // Note: This is a simplified rollback that only tracks versions
    // For production, you'd want down migrations
    const db = getDatabase();
    let rollbackCount = 0;

    await db.withTransaction(async (conn) => {
      const currentVersion = await this.getCurrentVersion();
      if (!currentVersion || currentVersion <= targetVersion) {
        return;
      }

      // Get migrations to rollback
      const toRollback = conn.prepare(
        'SELECT version FROM schema_migrations WHERE version > ? ORDER BY version DESC'
      ).all(targetVersion) as any[];

      rollbackCount = toRollback.length;

      // Remove migration records
      conn.prepare(
        'DELETE FROM schema_migrations WHERE version > ?'
      ).run(targetVersion);

      console.warn(
        `Rolled back ${rollbackCount} migrations. ` +
        `Note: This only updates version tracking. ` +
        `Database schema changes were NOT reverted.`
      );
    });

    const finalVersion = await this.getCurrentVersion();
    return {
      rollbackCount,
      currentVersion: finalVersion || '000'
    };
  }

  async status(): Promise<{
    currentVersion: string | null;
    pendingMigrations: Migration[];
    appliedMigrations: Array<{
      version: string;
      appliedAt: Date;
      description: string;
    }>;
  }> {
    const db = getDatabase();
    const currentVersion = await this.getCurrentVersion();
    const pendingMigrations = await this.getPendingMigrations();

    const appliedMigrations = await db.withConnection(conn => {
      const tableExists = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
      ).get();

      if (!tableExists) {
        return [];
      }

      const results = conn.prepare(
        'SELECT version, applied_at, description FROM schema_migrations ORDER BY version'
      ).all() as any[];

      return results.map(r => ({
        version: r.version,
        appliedAt: new Date(r.applied_at),
        description: r.description
      }));
    });

    return {
      currentVersion,
      pendingMigrations,
      appliedMigrations
    };
  }

  async reset(): Promise<void> {
    const db = getDatabase();
    
    console.warn('WARNING: This will drop all tables and data!');
    
    await db.withTransaction(conn => {
      // Get all tables except sqlite internal tables
      const tables = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      ).all() as any[];

      // Drop all tables
      for (const table of tables) {
        conn.exec(`DROP TABLE IF EXISTS ${table.name}`);
      }

      // Drop all views
      const views = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='view'"
      ).all() as any[];

      for (const view of views) {
        conn.exec(`DROP VIEW IF EXISTS ${view.name}`);
      }

      // Drop all triggers
      const triggers = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger'"
      ).all() as any[];

      for (const trigger of triggers) {
        conn.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
      }

      console.log('Database reset complete');
    });
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];
  const targetVersion = process.argv[3];

  async function run() {
    // Initialize database
    initializeDatabase();
    
    const runner = new MigrationRunner();

    switch (command) {
      case 'migrate':
        const { migrationsRun, currentVersion } = await runner.migrate(targetVersion);
        console.log(`Ran ${migrationsRun.length} migrations`);
        console.log(`Current version: ${currentVersion}`);
        break;

      case 'rollback':
        const rollbackResult = await runner.rollback(targetVersion);
        console.log(`Rolled back ${rollbackResult.rollbackCount} migrations`);
        console.log(`Current version: ${rollbackResult.currentVersion}`);
        break;

      case 'status':
        const status = await runner.status();
        console.log(`Current version: ${status.currentVersion || 'none'}`);
        console.log(`\nApplied migrations (${status.appliedMigrations.length}):`);
        status.appliedMigrations.forEach(m => {
          console.log(`  ${m.version}: ${m.description} (${m.appliedAt.toISOString()})`);
        });
        console.log(`\nPending migrations (${status.pendingMigrations.length}):`);
        status.pendingMigrations.forEach(m => {
          console.log(`  ${m.version}: ${m.description}`);
        });
        break;

      case 'reset':
        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        readline.question('Are you sure you want to reset the database? (yes/no): ', async (answer: string) => {
          if (answer.toLowerCase() === 'yes') {
            await runner.reset();
            console.log('Database has been reset');
          } else {
            console.log('Reset cancelled');
          }
          readline.close();
          process.exit(0);
        });
        return;

      default:
        console.log('Usage: migration-runner <command> [target-version]');
        console.log('Commands:');
        console.log('  migrate [version]  - Run pending migrations up to version');
        console.log('  rollback [version] - Rollback to version');
        console.log('  status            - Show migration status');
        console.log('  reset             - Drop all tables and reset database');
        process.exit(1);
    }

    process.exit(0);
  }

  run().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}

export default MigrationRunner;