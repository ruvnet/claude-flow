// Tests for task.js argument parsing functionality
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

describe('Task Command Argument Parsing', () => {
  let consoleLogSpy;
  let taskCommand;
  
  beforeEach(async () => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    
    // Mock utils before importing
    jest.doMock('../../../../src/cli/utils.js', () => ({
      printSuccess: jest.fn((msg) => console.log(`✅ ${msg}`)),
      printError: jest.fn((msg) => console.log(`❌ ${msg}`)),
      printWarning: jest.fn((msg) => console.log(`⚠️  ${msg}`))
    }));
    
    // Dynamic import to avoid module caching issues
    const taskModule = await import('../../../../src/cli/simple-commands/task.js');
    taskCommand = taskModule.taskCommand;
  });
  
  afterEach(() => {
    consoleLogSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('create command', () => {
    it('should parse simple quoted description correctly', async () => {
      const args = ['create', 'research', '"Market analysis"'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Creating research task:'));
      expect(consoleLogSpy).toHaveBeenCalledWith('📋 Description: Market analysis');
    });

    it('should parse description with spaces in quotes', async () => {
      const args = ['create', 'code', '"Implement user authentication system"'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('📋 Description: Implement user authentication system');
    });

    it('should parse single-quoted descriptions', async () => {
      const args = ['create', 'analysis', "'Data processing pipeline'"];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('📋 Description: Data processing pipeline');
    });

    it('should handle quotes within description', async () => {
      const args = ['create', 'research', '"Analyze "best practices" for API design"'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('📋 Description: Analyze "best practices" for API design');
    });

    it('should parse priority flag correctly', async () => {
      const args = ['create', 'code', '"Build API"', '--priority', '8'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('⚡ Priority: 8/10');
    });

    it('should use default priority when not specified', async () => {
      const args = ['create', 'code', '"Build API"'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('⚡ Priority: 5/10');
    });

    it('should handle unquoted multi-word descriptions', async () => {
      const args = ['create', 'general', 'Quick', 'task', 'description'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('📋 Description: Quick task description');
    });

    it('should error when type is missing', async () => {
      const args = ['create'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('❌ Usage: task create <type> "<description>"');
    });

    it('should error when description is missing', async () => {
      const args = ['create', 'research'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('❌ Usage: task create <type> "<description>"');
    });

    it('should handle edge case of empty quotes', async () => {
      const args = ['create', 'research', '""'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('❌ Usage: task create <type> "<description>"');
    });

    it('should handle mismatched quotes gracefully', async () => {
      const args = ['create', 'code', '"Unclosed quote'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('📋 Description: "Unclosed quote');
    });
  });

  describe('list command', () => {
    it('should parse filter flag correctly', async () => {
      const args = ['list', '--filter', 'running'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('📊 Filtered by status: running');
    });

    it('should parse verbose flag', async () => {
      const args = ['list', '--verbose'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('To create tasks:'));
    });

    it('should parse short verbose flag', async () => {
      const args = ['list', '-v'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('To create tasks:'));
    });

    it('should handle multiple flags', async () => {
      const args = ['list', '--filter', 'completed', '--verbose'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('📊 Filtered by status: completed');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('To create tasks:'));
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in description', async () => {
      const args = ['create', 'code', '"Implement feature #123 @high-priority"'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('📋 Description: Implement feature #123 @high-priority');
    });

    it('should handle unicode in description', async () => {
      const args = ['create', 'research', '"研究 AI 技术 🚀"'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('📋 Description: 研究 AI 技术 🚀');
    });

    it('should handle very long descriptions', async () => {
      const longDesc = 'A'.repeat(200);
      const args = ['create', 'analysis', `"${longDesc}"`];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(`📋 Description: ${longDesc}`);
    });

    it('should handle command injection attempts safely', async () => {
      const args = ['create', 'code', '"Test; rm -rf /"'];
      await taskCommand(args, {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith('📋 Description: Test; rm -rf /');
    });
  });
});