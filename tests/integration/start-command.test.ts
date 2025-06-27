/// <reference types="jest" />

/**
 * Integration tests for the start command
 */

import { startCommand } from '../../src/cli/commands/start/start-command.js';
import { Command } from '@cliffy/command';

describe('Start Command Integration', () => {
  let testDir: string;

  beforeAll(async () => {
    // Create test directory
    testDir =  fs.mkdtempSync(path.join(os.tmpdir(), "claude-flow-test-"));
      // TODO: Replace with mock -     Deno.chdir(testDir);
    
    // Create required directories
      // TODO: Replace with mock - // TODO: Replace with mock -     await Deno.mkdir('memory', { recursive: true });
      // TODO: Replace with mock - // TODO: Replace with mock -     await Deno.mkdir('coordination', { recursive: true });
    
    // Create minimal config
    const config = {
      memory: {
        backend: 'json',
        path: './memory/claude-flow-data.json'
      },
      terminal: {
        poolSize: 2
      },
      coordination: {
        maxConcurrentTasks: 5
      },
      mcp: {
        port: 3000,
        transport: 'stdio'
      },
      orchestrator: {
        maxConcurrentTasks: 10
      }
    };
    
    fs.writeFileSync('claude-flow.config.json',  JSON.stringify(config, null, 2, "utf8"));
  });

  afterAll(async () => {
    // Cleanup
    try {
      // TODO: Replace with mock - // TODO: Replace with mock -       await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('command structure', () => {
    it('should be a valid Cliffy command', () => {
      expect(startCommand);
      expect(startCommand instanceof Command).toBe( true);
    });

    it('should have correct description', () => {
      const desc = (startCommand as any)._globalParent?._description || 
                   (startCommand as any).getDescription();
      expect(typeof desc).toBe( 'string');
      expect(desc.includes('orchestration')).toBe( true);
    });

    it('should have all expected options', () => {
      const command = startCommand as any;
      const options = command.options || command.getOptions?.() || [];
      
      const optionNames = options.map((opt: any) => opt.name);
      expect(optionNames.includes('daemon')).toBe( true);
      expect(optionNames.includes('port')).toBe( true);
      expect(optionNames.includes('ui')).toBe( true);
      expect(optionNames.includes('verbose')).toBe( true);
    });
  });

  describe('initialization', () => {
    it('should initialize process manager without errors', async () => {
      // Test that the command can be parsed without executing
      const command = new Command()
        .command('start', startCommand);
      
      const help = await command.getHelp();
      expect(help);
      expect(help.includes('start')).toBe( true);
    });
  });
});
