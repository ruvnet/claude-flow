import { MigrationRunner } from '@/persistence/sqlite/migrations/migration-runner';
import { createTestDatabase, createFileTestDatabase } from '@test/helpers/database-utils';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('SQLite Migration System', () => {
  let db: Database.Database;
  let migrationRunner: MigrationRunner;
  const testDir = join(process.cwd(), 'test-migrations');
  
  beforeEach(() => {
    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });
  
  afterEach(() => {
    if (db) {
      db.close();
    }
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
  
  describe('MigrationRunner - In-memory database', () => {
    beforeEach(() => {
      db = createTestDatabase();
      migrationRunner = new MigrationRunner(db, testDir);
    });
    
    it('should initialize migration system', () => {
      migrationRunner.initialize();
      
      // Check that migrations table exists
      const tableInfo = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
      ).get();
      
      expect(tableInfo).toBeDefined();
    });
    
    it('should track applied migrations', () => {
      migrationRunner.initialize();
      
      // Create a test migration
      const migration = {
        id: '001_initial_schema',
        up: `
          CREATE TABLE users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE
          );
        `,
        down: 'DROP TABLE users;'
      };
      
      migrationRunner.applyMigration(migration);
      
      // Check migration was recorded
      const applied = db.prepare('SELECT * FROM migrations WHERE id = ?').get('001_initial_schema');
      expect(applied).toBeDefined();
      expect(applied.id).toBe('001_initial_schema');
      expect(applied.applied_at).toBeDefined();
    });
    
    it('should apply multiple migrations in order', () => {
      migrationRunner.initialize();
      
      const migrations = [
        {
          id: '001_create_users',
          up: `CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT);`
        },
        {
          id: '002_create_posts',
          up: `CREATE TABLE posts (
            id TEXT PRIMARY KEY, 
            user_id TEXT,
            title TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
          );`
        },
        {
          id: '003_add_email_to_users',
          up: `ALTER TABLE users ADD COLUMN email TEXT;`
        }
      ];
      
      migrations.forEach(migration => migrationRunner.applyMigration(migration));
      
      // Verify all tables and columns exist
      const users = db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get();
      const posts = db.prepare("SELECT sql FROM sqlite_master WHERE name='posts'").get();
      
      expect(users).toBeDefined();
      expect(posts).toBeDefined();
      expect(users.sql).toContain('email TEXT');
      
      // Verify all migrations were recorded
      const appliedMigrations = db.prepare('SELECT id FROM migrations ORDER BY id').all();
      expect(appliedMigrations).toHaveLength(3);
      expect(appliedMigrations.map(m => m.id)).toEqual([
        '001_create_users',
        '002_create_posts',
        '003_add_email_to_users'
      ]);
    });
    
    it('should skip already applied migrations', () => {
      migrationRunner.initialize();
      
      const migration = {
        id: '001_create_table',
        up: `CREATE TABLE test_table (id TEXT PRIMARY KEY);`
      };
      
      // Apply once
      migrationRunner.applyMigration(migration);
      
      // Try to apply again
      const result = migrationRunner.applyMigration(migration);
      
      expect(result).toEqual({ skipped: true).toBe( reason: 'Already applied' });
      
      // Verify only one record in migrations table
      const count = db.prepare('SELECT COUNT(*) as count FROM migrations WHERE id = ?').get('001_create_table');
      expect(count.count).toBe(1);
    });
    
    it('should handle migration errors gracefully', () => {
      migrationRunner.initialize();
      
      const badMigration = {
        id: '001_bad_migration',
        up: `CREATE TABLE INVALID SYNTAX;` // Invalid SQL
      };
      
      expect(() => migrationRunner.applyMigration(badMigration)).toThrow();
      
      // Verify migration was not recorded
      const applied = db.prepare('SELECT * FROM migrations WHERE id = ?').get('001_bad_migration');
      expect(applied).toBeUndefined();
    });
    
    it('should support rollback with down migrations', () => {
      migrationRunner.initialize();
      
      const migration = {
        id: '001_create_table',
        up: `CREATE TABLE temp_table (id TEXT PRIMARY KEY, data TEXT);`,
        down: `DROP TABLE temp_table;`
      };
      
      // Apply migration
      migrationRunner.applyMigration(migration);
      
      // Verify table exists
      let tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='temp_table'"
      ).get();
      expect(tableExists).toBeDefined();
      
      // Rollback migration
      migrationRunner.rollbackMigration('001_create_table');
      
      // Verify table no longer exists
      tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='temp_table'"
      ).get();
      expect(tableExists).toBeUndefined();
      
      // Verify migration record was removed
      const migrationRecord = db.prepare('SELECT * FROM migrations WHERE id = ?').get('001_create_table');
      expect(migrationRecord).toBeUndefined();
    });
    
    it('should run migrations from files', () => {
      migrationRunner.initialize();
      
      // Create migration files
      const migrations = [
        {
          filename: '001_initial.sql',
          content: `
            -- Up
            CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT);
            
            -- Down
            DROP TABLE users;
          `
        },
        {
          filename: '002_add_posts.sql',
          content: `
            -- Up
            CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT);
            
            -- Down
            DROP TABLE posts;
          `
        }
      ];
      
      // Write migration files
      const fs = require('fs');
      migrations.forEach(({ filename, content }) => {
        fs.writeFileSync(join(testDir, filename), content);
      });
      
      // Run all migrations from directory
      const results = migrationRunner.runMigrationsFromDirectory();
      
      expect(results.applied).toHaveLength(2);
      expect(results.skipped).toHaveLength(0);
      expect(results.failed).toHaveLength(0);
      
      // Verify tables exist
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts')"
      ).all();
      expect(tables).toHaveLength(2);
    });
  });
  
  describe('MigrationRunner - File-based database', () => {
    const dbPath = join(testDir, 'test.db');
    
    beforeEach(() => {
      db = createFileTestDatabase(dbPath);
      migrationRunner = new MigrationRunner(db, testDir);
    });
    
    it('should persist migrations across connections', () => {
      migrationRunner.initialize();
      
      const migration = {
        id: '001_persistent',
        up: `CREATE TABLE persistent_table (id TEXT PRIMARY KEY);`
      };
      
      migrationRunner.applyMigration(migration);
      
      // Close and reopen database
      db.close();
      db = new Database(dbPath);
      migrationRunner = new MigrationRunner(db, testDir);
      
      // Check migration is still recorded
      const applied = db.prepare('SELECT * FROM migrations WHERE id = ?').get('001_persistent');
      expect(applied).toBeDefined();
      
      // Check table still exists
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='persistent_table'"
      ).get();
      expect(tableExists).toBeDefined();
    });
    
    it('should handle concurrent migration attempts', () => {
      migrationRunner.initialize();
      
      const migration = {
        id: '001_concurrent',
        up: `CREATE TABLE concurrent_test (id TEXT PRIMARY KEY);`
      };
      
      // Simulate concurrent migration attempts
      const promises = Array(5).fill(null).map(() => 
        new Promise((resolve) => {
          try {
            const result = migrationRunner.applyMigration(migration);
            resolve(result);
          } catch (error) {
            resolve({ error });
          }
        })
      );
      
      return Promise.all(promises).then(results => {
        // One should succeed, others should be skipped
        const successful = results.filter(r => !r.skipped && !r.error).length;
        const skipped = results.filter(r => r.skipped).length;
        
        expect(successful).toBe(1);
        expect(skipped).toBe(4);
      });
    });
  });
  
  describe('Data Migration Integration', () => {
    beforeEach(() => {
      db = createTestDatabase();
      migrationRunner = new MigrationRunner(db, testDir);
      migrationRunner.initialize();
    });
    
    it('should migrate data from JSON to SQLite', () => {
      // Create initial schema
      const schemaMigration = {
        id: '001_create_schema',
        up: `
          CREATE TABLE agents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            status TEXT DEFAULT 'idle',
            config TEXT
          );
          
          CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            assigned_to TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assigned_to) REFERENCES agents(id)
          );
        `
      };
      
      migrationRunner.applyMigration(schemaMigration);
      
      // Simulate JSON data
      const jsonData = {
        agents: [
          { id: 'agent-1', name: 'Research Bot', type: 'researcher', status: 'active' },
          { id: 'agent-2', name: 'Dev Bot', type: 'developer', status: 'idle' }
        ],
        tasks: [
          { id: 'task-1', description: 'Research AI trends', assigned_to: 'agent-1' },
          { id: 'task-2', description: 'Implement feature', assigned_to: 'agent-2' }
        ]
      };
      
      // Data migration
      const dataMigration = {
        id: '002_import_json_data',
        up: () => {
          const insertAgent = db.prepare(
            'INSERT INTO agents (id, name, type, status) VALUES (?, ?, ?, ?)'
          );
          const insertTask = db.prepare(
            'INSERT INTO tasks (id, description, assigned_to) VALUES (?, ?, ?)'
          );
          
          const transaction = db.transaction(() => {
            jsonData.agents.forEach(agent => {
              insertAgent.run(agent.id, agent.name, agent.type, agent.status);
            });
            
            jsonData.tasks.forEach(task => {
              insertTask.run(task.id, task.description, task.assigned_to);
            });
          });
          
          transaction();
        }
      };
      
      migrationRunner.applyMigration(dataMigration);
      
      // Verify data was migrated
      const agents = db.prepare('SELECT * FROM agents').all();
      const tasks = db.prepare('SELECT * FROM tasks').all();
      
      expect(agents).toHaveLength(2);
      expect(tasks).toHaveLength(2);
      expect(agents[0].name).toBe('Research Bot');
      expect(tasks[0].assigned_to).toBe('agent-1');
    });
    
    it('should handle complex data transformations', () => {
      // Create schema with old structure
      const oldSchema = {
        id: '001_old_schema',
        up: `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            full_name TEXT,
            contact_info TEXT
          );
        `
      };
      
      migrationRunner.applyMigration(oldSchema);
      
      // Insert old data
      db.prepare('INSERT INTO users (full_name, contact_info) VALUES (?, ?)')
        .run('John Doe', JSON.stringify({ email: 'john@example.com', phone: '123-456-7890' }));
      db.prepare('INSERT INTO users (full_name, contact_info) VALUES (?, ?)')
        .run('Jane Smith', JSON.stringify({ email: 'jane@example.com' }));
      
      // Migration to new structure
      const transformMigration = {
        id: '002_transform_users',
        up: () => {
          // Create new table structure
          db.exec(`
            CREATE TABLE users_new (
              id TEXT PRIMARY KEY,
              first_name TEXT,
              last_name TEXT,
              email TEXT,
              phone TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
          `);
          
          // Transform and migrate data
          const oldUsers = db.prepare('SELECT * FROM users').all();
          const insertNew = db.prepare(`
            INSERT INTO users_new (id, first_name, last_name, email, phone)
            VALUES (?, ?, ?, ?, ?)
          `);
          
          const transaction = db.transaction(() => {
            oldUsers.forEach(user => {
              const [firstName, lastName] = user.full_name.split(' ');
              const contactInfo = JSON.parse(user.contact_info);
              
              insertNew.run(
                `user-${user.id}`,
                firstName,
                lastName,
                contactInfo.email,
                contactInfo.phone || null
              );
            });
            
            // Drop old table and rename new
            db.exec('DROP TABLE users');
            db.exec('ALTER TABLE users_new RENAME TO users');
          });
          
          transaction();
        }
      };
      
      migrationRunner.applyMigration(transformMigration);
      
      // Verify transformed data
      const users = db.prepare('SELECT * FROM users').all();
      
      expect(users).toHaveLength(2);
      expect(users[0]).toMatchObject({
        id: 'user-1',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        phone: '123-456-7890'
      });
      expect(users[1]).toMatchObject({
        id: 'user-2',
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane@example.com',
        phone: null
      });
    });
  });
  
  describe('Migration Validation', () => {
    beforeEach(() => {
      db = createTestDatabase();
      migrationRunner = new MigrationRunner(db, testDir);
      migrationRunner.initialize();
    });
    
    it('should validate migration integrity', () => {
      const migration = {
        id: '001_test_integrity',
        up: `CREATE TABLE test (id TEXT PRIMARY KEY);`,
        checksum: 'abc123' // Simulated checksum
      };
      
      migrationRunner.applyMigration(migration);
      
      // Verify checksum was stored
      const stored = db.prepare('SELECT * FROM migrations WHERE id = ?').get('001_test_integrity');
      expect(stored.checksum).toBe('abc123');
      
      // Attempt to apply same migration with different checksum
      const modifiedMigration = {
        ...migration,
        checksum: 'xyz789'
      };
      
      expect(() => migrationRunner.applyMigration(modifiedMigration))
        .toThrow(/checksum mismatch/i);
    });
    
    it('should ensure migration dependencies', () => {
      const migrations = [
        {
          id: '002_dependent',
          dependencies: ['001_base'],
          up: `CREATE TABLE dependent (id TEXT PRIMARY KEY);`
        },
        {
          id: '001_base',
          up: `CREATE TABLE base (id TEXT PRIMARY KEY);`
        }
      ];
      
      // Try to apply dependent migration first (should fail)
      expect(() => migrationRunner.applyMigration(migrations[0]))
        .toThrow(/dependency.*not.*applied/i);
      
      // Apply in correct order
      migrationRunner.applyMigration(migrations[1]);
      migrationRunner.applyMigration(migrations[0]);
      
      // Verify both tables exist
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('base', 'dependent')"
      ).all();
      expect(tables).toHaveLength(2);
    });
  });
});
