/**
 * Integration tests for the Enhanced REPL
 */

import { assertEquals, assertExists, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { describe, it, beforeEach, afterEach } from 'https://deno.land/std@0.208.0/testing/bdd.ts';

// Mock implementations for testing
class MockInput {
  private responses: string[] = [];
  private responseIndex = 0;

  setResponses(responses: string[]) {
    this.responses = responses;
    this.responseIndex = 0;
  }

  async prompt(options: any): Promise<string> {
    if (this.responseIndex < this.responses.length) {
      return this.responses[this.responseIndex++];
    }
    return 'exit'; // Default to exit to prevent infinite loops
  }
}

class MockConsole {
  public outputs: string[] = [];
  
  log(...args: any[]) {
    this.outputs.push(args.join(' '));
  }
  
  error(...args: any[]) {
    this.outputs.push(`ERROR: ${args.join(' ')}`);
  }
  
  clear() {
    this.outputs = [];
  }
  
  getOutput(): string {
    return this.outputs.join('\n');
  }
}

describe('Enhanced REPL Integration Tests', () => {
  let mockInput: MockInput;
  let mockConsole: MockConsole;
  let testDir: string;
  
  beforeEach(async () => {
    mockInput = new MockInput();
    mockConsole = new MockConsole();
    testDir = await Deno.makeTempDir({ prefix: 'repl-test-' });
    
    // Mock global console
    globalThis.console = mockConsole as any;
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Variable Management', () => {
    it('should handle variable persistence', async () => {
      const variableFile = `${testDir}/test-variables.json`;
      
      // Import the variable manager
      const { VariableManager } = await import('../../package/src/cli/enhanced-repl.ts');
      const varManager = new (VariableManager as any)(variableFile);
      
      // Set some variables
      varManager.set('testString', 'Hello World', 'session');
      varManager.set('testNumber', 42, 'global');
      varManager.set('testObject', { key: 'value' }, 'session');
      varManager.set('tempVar', 'temporary', 'temporary');
      
      // Check values
      assertEquals(varManager.get('testString'), 'Hello World');
      assertEquals(varManager.get('testNumber'), 42);
      assertEquals(varManager.get('testObject').key, 'value');
      assertEquals(varManager.has('testString'), true);
      assertEquals(varManager.has('nonexistent'), false);
      
      // Check persistence (temporary variables should not be saved)
      const variables = varManager.list();
      assertEquals(variables.length, 3); // Excludes temporary
      assertEquals(variables.some(v => v.name === 'tempVar'), false);
      
      // Test scoped listing
      const sessionVars = varManager.list('session');
      assertEquals(sessionVars.length, 2);
      assertEquals(sessionVars.every(v => v.scope === 'session'), true);
      
      const globalVars = varManager.list('global');
      assertEquals(globalVars.length, 1);
      assertEquals(globalVars[0].name, 'testNumber');
    });

    it('should handle variable deletion', async () => {
      const variableFile = `${testDir}/delete-test-variables.json`;
      const { VariableManager } = await import('../../package/src/cli/enhanced-repl.ts');
      const varManager = new (VariableManager as any)(variableFile);
      
      varManager.set('var1', 'value1');
      varManager.set('var2', 'value2');
      varManager.set('var3', 'value3');
      
      assertEquals(varManager.list().length, 3);
      
      // Delete individual variable
      assertEquals(varManager.delete('var1'), true);
      assertEquals(varManager.delete('nonexistent'), false);
      assertEquals(varManager.list().length, 2);
      assertEquals(varManager.has('var1'), false);
      
      // Clear all variables
      varManager.clear();
      assertEquals(varManager.list().length, 0);
    });

    it('should handle scope-based clearing', async () => {
      const variableFile = `${testDir}/scope-clear-variables.json`;
      const { VariableManager } = await import('../../package/src/cli/enhanced-repl.ts');
      const varManager = new (VariableManager as any)(variableFile);
      
      varManager.set('sessionVar', 'value', 'session');
      varManager.set('globalVar', 'value', 'global');
      varManager.set('tempVar', 'value', 'temporary');
      
      assertEquals(varManager.list().length, 3);
      
      // Clear only session variables
      varManager.clear('session');
      
      const remaining = varManager.list();
      assertEquals(remaining.length, 2);
      assertEquals(remaining.some(v => v.scope === 'session'), false);
      assertEquals(remaining.some(v => v.scope === 'global'), true);
      assertEquals(remaining.some(v => v.scope === 'temporary'), true);
    });
  });

  describe('Session Management', () => {
    it('should create and manage sessions', async () => {
      const sessionFile = `${testDir}/test-sessions.json`;
      const { SessionManager } = await import('../../package/src/cli/enhanced-repl.ts');
      const sessionManager = new (SessionManager as any)(sessionFile);
      
      // Create sessions
      const session1Id = sessionManager.createSession('Test Session 1');
      const session2Id = sessionManager.createSession('Test Session 2');
      
      assertExists(session1Id);
      assertExists(session2Id);
      assertEquals(session1Id !== session2Id, true);
      
      // List sessions
      const sessions = sessionManager.listSessions();
      assertEquals(sessions.length, 2);
      assertEquals(sessions.some(s => s.name === 'Test Session 1'), true);
      assertEquals(sessions.some(s => s.name === 'Test Session 2'), true);
      
      // Load session
      const loadedSession = sessionManager.loadSession(session1Id);
      assertExists(loadedSession);
      assertEquals(loadedSession!.name, 'Test Session 1');
      assertEquals(sessionManager.getCurrentSession()!.id, session1Id);
      
      // Delete session
      assertEquals(sessionManager.deleteSession(session2Id), true);
      assertEquals(sessionManager.deleteSession('nonexistent'), false);
      assertEquals(sessionManager.listSessions().length, 1);
    });

    it('should handle session persistence', async () => {
      const sessionFile = `${testDir}/persistence-sessions.json`;
      const { SessionManager } = await import('../../package/src/cli/enhanced-repl.ts');
      
      // Create manager and session
      const sessionManager1 = new (SessionManager as any)(sessionFile);
      const sessionId = sessionManager1.createSession('Persistent Session');
      const session = sessionManager1.getCurrentSession();
      session!.history = ['command1', 'command2'];
      session!.variables.set('testVar', 'testValue');
      
      // Create new manager instance (simulates restart)
      const sessionManager2 = new (SessionManager as any)(sessionFile);
      
      // Should load persisted sessions
      const sessions = sessionManager2.listSessions();
      assertEquals(sessions.length, 1);
      assertEquals(sessions[0].name, 'Persistent Session');
      assertEquals(sessions[0].history.length, 2);
      assertEquals(sessions[0].variables.has('testVar'), true);
    });
  });

  describe('Debug Management', () => {
    it('should manage breakpoints and watch expressions', async () => {
      const { DebugManager } = await import('../../package/src/cli/enhanced-repl.ts');
      const debugManager = new (DebugManager as any)();
      
      // Breakpoints
      debugManager.addBreakpoint('task-001');
      debugManager.addBreakpoint('workflow-start');
      debugManager.addBreakpoint('condition-check');
      
      let breakpoints = debugManager.listBreakpoints();
      assertEquals(breakpoints.length, 3);
      assertEquals(breakpoints.includes('task-001'), true);
      
      assertEquals(debugManager.removeBreakpoint('task-001'), true);
      assertEquals(debugManager.removeBreakpoint('nonexistent'), false);
      
      breakpoints = debugManager.listBreakpoints();
      assertEquals(breakpoints.length, 2);
      assertEquals(breakpoints.includes('task-001'), false);
      
      // Watch expressions
      debugManager.addWatch('status', 'variables.currentStatus');
      debugManager.addWatch('progress', 'task.progress.percentage');
      
      const watches = debugManager.listWatches();
      assertEquals(watches.size, 2);
      assertEquals(watches.get('status'), 'variables.currentStatus');
      assertEquals(watches.get('progress'), 'task.progress.percentage');
      
      assertEquals(debugManager.removeWatch('status'), true);
      assertEquals(debugManager.removeWatch('nonexistent'), false);
      assertEquals(debugManager.listWatches().size, 1);
      
      // Step mode
      assertEquals(debugManager.isStepMode(), false);
      debugManager.enableStepMode();
      assertEquals(debugManager.isStepMode(), true);
      debugManager.disableStepMode();
      assertEquals(debugManager.isStepMode(), false);
    });

    it('should manage call stack', async () => {
      const { DebugManager } = await import('../../package/src/cli/enhanced-repl.ts');
      const debugManager = new (DebugManager as any)();
      
      const frame1 = {
        id: 'frame1',
        name: 'workflow-main',
        type: 'workflow' as const,
        variables: { status: 'running' },
        timestamp: new Date()
      };
      
      const frame2 = {
        id: 'frame2',
        name: 'task-001',
        type: 'task' as const,
        variables: { progress: 50 },
        timestamp: new Date()
      };
      
      // Push frames
      debugManager.pushFrame(frame1);
      debugManager.pushFrame(frame2);
      
      let stack = debugManager.getCallStack();
      assertEquals(stack.length, 2);
      assertEquals(stack[1].name, 'task-001'); // Most recent frame
      
      // Pop frame
      const poppedFrame = debugManager.popFrame();
      assertEquals(poppedFrame!.name, 'task-001');
      
      stack = debugManager.getCallStack();
      assertEquals(stack.length, 1);
      assertEquals(stack[0].name, 'workflow-main');
    });
  });

  describe('Multi-line Editor', () => {
    it('should handle multi-line input', async () => {
      const { MultiLineEditor } = await import('../../package/src/cli/enhanced-repl.ts');
      const editor = new (MultiLineEditor as any)();
      
      assertEquals(editor.isActive(), false);
      
      editor.startEdit('const data = {');
      assertEquals(editor.isActive(), true);
      
      editor.addLine('  name: "test",');
      editor.addLine('  value: 42');
      editor.addLine('};');
      
      const content = editor.getContent();
      assertEquals(content.includes('const data = {'), true);
      assertEquals(content.includes('name: "test"'), true);
      assertEquals(content.includes('value: 42'), true);
      assertEquals(content.includes('};'), true);
      
      editor.clear();
      assertEquals(editor.isActive(), false);
      assertEquals(editor.getContent(), '');
    });

    it('should handle initial content', async () => {
      const { MultiLineEditor } = await import('../../package/src/cli/enhanced-repl.ts');
      const editor = new (MultiLineEditor as any)();
      
      const initialContent = 'function test() {\n  return true;\n}';
      editor.startEdit(initialContent);
      
      const content = editor.getContent();
      assertEquals(content, initialContent);
      
      editor.addLine('// Additional line');
      const updatedContent = editor.getContent();
      assertEquals(updatedContent.includes('// Additional line'), true);
    });
  });

  describe('Command Parsing', () => {
    it('should parse commands with quotes and escapes', async () => {
      // Import the command parsing function
      const module = await import('../../package/src/cli/enhanced-repl.ts');
      const parseEnhancedCommand = (module as any).parseEnhancedCommand;
      
      // Simple command
      let parsed = parseEnhancedCommand('help');
      assertEquals(parsed, ['help']);
      
      // Command with arguments
      parsed = parseEnhancedCommand('let name = "John Doe"');
      assertEquals(parsed, ['let', 'name', '=', 'John Doe']);
      
      // Command with single quotes
      parsed = parseEnhancedCommand("set greeting = 'Hello World'");
      assertEquals(parsed, ['set', 'greeting', '=', 'Hello World']);
      
      // Command with escaped quotes
      parsed = parseEnhancedCommand('echo "He said \\"Hello\\""');
      assertEquals(parsed, ['echo', 'He said "Hello"']);
      
      // Command with multiple spaces
      parsed = parseEnhancedCommand('workflow  run    test.yaml');
      assertEquals(parsed, ['workflow', 'run', 'test.yaml']);
      
      // Complex JSON assignment
      parsed = parseEnhancedCommand('let config = {"timeout": 5000, "retries": 3}');
      assertEquals(parsed, ['let', 'config', '=', '{"timeout": 5000, "retries": 3}']);
    });
  });

  describe('Command Completion', () => {
    it('should provide basic command completions', async () => {
      const module = await import('../../package/src/cli/enhanced-repl.ts');
      const getCompletions = (module as any).getCompletions;
      
      // Mock context and variable manager
      const mockContext = { variables: new Map() };
      const mockVarManager = {
        list: () => [
          { name: 'apiKey', scope: 'global' },
          { name: 'config', scope: 'session' },
          { name: 'tempData', scope: 'temporary' }
        ]
      };
      
      // Basic command completion
      let completions = getCompletions('hel', mockContext, mockVarManager);
      assertEquals(completions.includes('help'), true);
      
      completions = getCompletions('deb', mockContext, mockVarManager);
      assertEquals(completions.includes('debug'), true);
      
      // Variable name completion
      completions = getCompletions('get api', mockContext, mockVarManager);
      assertEquals(completions.includes('apiKey'), true);
      
      completions = getCompletions('var con', mockContext, mockVarManager);
      assertEquals(completions.includes('config'), true);
      
      // Session subcommand completion
      completions = getCompletions('session s', mockContext, mockVarManager);
      assertEquals(completions.includes('save'), true);
      
      completions = getCompletions('session l', mockContext, mockVarManager);
      assertEquals(completions.includes('list'), true);
      assertEquals(completions.includes('load'), true);
    });
  });

  describe('Error Handling', () => {
    it('should handle file system errors gracefully', async () => {
      // Test with invalid paths
      const { VariableManager } = await import('../../package/src/cli/enhanced-repl.ts');
      const invalidPath = '/invalid/path/that/does/not/exist/variables.json';
      
      // Should not throw error, just fail to load/save silently
      const varManager = new (VariableManager as any)(invalidPath);
      varManager.set('test', 'value');
      
      // Variable should still work in memory
      assertEquals(varManager.get('test'), 'value');
    });

    it('should handle invalid JSON gracefully', async () => {
      const corruptFile = `${testDir}/corrupt-variables.json`;
      await Deno.writeTextFile(corruptFile, 'invalid json content');
      
      const { VariableManager } = await import('../../package/src/cli/enhanced-repl.ts');
      
      // Should not crash, just start with empty state
      const varManager = new (VariableManager as any)(corruptFile);
      assertEquals(varManager.list().length, 0);
      
      // Should still work normally
      varManager.set('test', 'value');
      assertEquals(varManager.get('test'), 'value');
    });
  });

  describe('Integration with Workflow Engine', () => {
    it('should integrate REPL with workflow execution', async () => {
      // Create a test workflow file
      const workflowFile = `${testDir}/test-workflow.json`;
      const workflow = {
        name: 'REPL Test Workflow',
        tasks: [
          {
            id: 'test-task',
            type: 'test',
            description: 'A simple test task'
          }
        ]
      };
      
      await Deno.writeTextFile(workflowFile, JSON.stringify(workflow, null, 2));
      
      // Mock workflow engine
      const mockEngine = {
        loadWorkflow: async (path: string) => {
          assertEquals(path, workflowFile);
          return workflow;
        },
        executeWorkflow: async (wf: any) => {
          assertEquals(wf.name, 'REPL Test Workflow');
          return {
            id: 'test-execution-001',
            workflowName: wf.name,
            status: 'completed',
            startedAt: new Date(),
            completedAt: new Date(),
            progress: { total: 1, completed: 1, failed: 0 }
          };
        },
        listExecutions: () => [],
        getExecution: () => null
      };
      
      // Test workflow command handling
      const module = await import('../../package/src/cli/enhanced-repl.ts');
      const handleWorkflowCommand = (module as any).handleWorkflowCommand;
      
      const mockContext = { activeWorkflows: new Map() };
      
      // Test workflow run command
      await handleWorkflowCommand(['run', workflowFile], mockContext, mockEngine);
      
      // Verify workflow was executed
      assertEquals(mockContext.activeWorkflows.size, 1);
    });
  });
});