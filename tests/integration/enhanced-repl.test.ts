/// <reference types="jest" />
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Integration tests for the Enhanced REPL
 */

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
    testDir =  fs.mkdtempSync(path.join(os.tmpdir(), "claude-flow-test-"));
    
    // Mock global console
    globalThis.console = mockConsole as any;
  });

  afterEach(async () => {
    try {
      // TODO: Replace with mock - // TODO: Replace with mock -       await Deno.remove(testDir, { recursive: true });
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
      expect(varManager.get('testString')).toBe( 'Hello World');
      expect(varManager.get('testNumber')).toBe( 42);
      expect(varManager.get('testObject').key).toBe( 'value');
      expect(varManager.has('testString')).toBe( true);
      expect(varManager.has('nonexistent')).toBe( false);
      
      // Check persistence (temporary variables should not be saved)
      const variables = varManager.list();
      expect(variables.length).toBe( 3); // Excludes temporary
      expect(variables.some(v => v.name === 'tempVar')).toBe( false);
      
      // Test scoped listing
      const sessionVars = varManager.list('session');
      expect(sessionVars.length).toBe( 2);
      expect(sessionVars.every(v => v.scope === 'session')).toBe( true);
      
      const globalVars = varManager.list('global');
      expect(globalVars.length).toBe( 1);
      expect(globalVars[0].name).toBe( 'testNumber');
    });

    it('should handle variable deletion', async () => {
      const variableFile = `${testDir}/delete-test-variables.json`;
      const { VariableManager } = await import('../../package/src/cli/enhanced-repl.ts');
      const varManager = new (VariableManager as any)(variableFile);
      
      varManager.set('var1', 'value1');
      varManager.set('var2', 'value2');
      varManager.set('var3', 'value3');
      
      expect(varManager.list().length).toBe( 3);
      
      // Delete individual variable
      expect(varManager.delete('var1')).toBe( true);
      expect(varManager.delete('nonexistent')).toBe( false);
      expect(varManager.list().length).toBe( 2);
      expect(varManager.has('var1')).toBe( false);
      
      // Clear all variables
      varManager.clear();
      expect(varManager.list().length).toBe( 0);
    });

    it('should handle scope-based clearing', async () => {
      const variableFile = `${testDir}/scope-clear-variables.json`;
      const { VariableManager } = await import('../../package/src/cli/enhanced-repl.ts');
      const varManager = new (VariableManager as any)(variableFile);
      
      varManager.set('sessionVar', 'value', 'session');
      varManager.set('globalVar', 'value', 'global');
      varManager.set('tempVar', 'value', 'temporary');
      
      expect(varManager.list().length).toBe( 3);
      
      // Clear only session variables
      varManager.clear('session');
      
      const remaining = varManager.list();
      expect(remaining.length).toBe( 2);
      expect(remaining.some(v => v.scope === 'session')).toBe( false);
      expect(remaining.some(v => v.scope === 'global')).toBe( true);
      expect(remaining.some(v => v.scope === 'temporary')).toBe( true);
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
      
      expect(session1Id);
      expect(session2Id);
      expect(session1Id !== session2Id).toBe( true);
      
      // List sessions
      const sessions = sessionManager.listSessions();
      expect(sessions.length).toBe( 2);
      expect(sessions.some(s => s.name === 'Test Session 1')).toBe( true);
      expect(sessions.some(s => s.name === 'Test Session 2')).toBe( true);
      
      // Load session
      const loadedSession = sessionManager.loadSession(session1Id);
      expect(loadedSession);
      expect(loadedSession!.name).toBe( 'Test Session 1');
      expect(sessionManager.getCurrentSession()!.id).toBe( session1Id);
      
      // Delete session
      expect(sessionManager.deleteSession(session2Id)).toBe( true);
      expect(sessionManager.deleteSession('nonexistent')).toBe( false);
      expect(sessionManager.listSessions().length).toBe( 1);
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
      expect(sessions.length).toBe( 1);
      expect(sessions[0].name).toBe( 'Persistent Session');
      expect(sessions[0].history.length).toBe( 2);
      expect(sessions[0].variables.has('testVar')).toBe( true);
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
      expect(breakpoints.length).toBe( 3);
      expect(breakpoints.includes('task-001')).toBe( true);
      
      expect(debugManager.removeBreakpoint('task-001')).toBe( true);
      expect(debugManager.removeBreakpoint('nonexistent')).toBe( false);
      
      breakpoints = debugManager.listBreakpoints();
      expect(breakpoints.length).toBe( 2);
      expect(breakpoints.includes('task-001')).toBe( false);
      
      // Watch expressions
      debugManager.addWatch('status', 'variables.currentStatus');
      debugManager.addWatch('progress', 'task.progress.percentage');
      
      const watches = debugManager.listWatches();
      expect(watches.size).toBe( 2);
      expect(watches.get('status')).toBe( 'variables.currentStatus');
      expect(watches.get('progress')).toBe( 'task.progress.percentage');
      
      expect(debugManager.removeWatch('status')).toBe( true);
      expect(debugManager.removeWatch('nonexistent')).toBe( false);
      expect(debugManager.listWatches().size).toBe( 1);
      
      // Step mode
      expect(debugManager.isStepMode()).toBe( false);
      debugManager.enableStepMode();
      expect(debugManager.isStepMode()).toBe( true);
      debugManager.disableStepMode();
      expect(debugManager.isStepMode()).toBe( false);
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
      expect(stack.length).toBe( 2);
      expect(stack[1].name).toBe( 'task-001'); // Most recent frame
      
      // Pop frame
      const poppedFrame = debugManager.popFrame();
      expect(poppedFrame!.name).toBe( 'task-001');
      
      stack = debugManager.getCallStack();
      expect(stack.length).toBe( 1);
      expect(stack[0].name).toBe( 'workflow-main');
    });
  });

  describe('Multi-line Editor', () => {
    it('should handle multi-line input', async () => {
      const { MultiLineEditor } = await import('../../package/src/cli/enhanced-repl.ts');
      const editor = new (MultiLineEditor as any)();
      
      expect(editor.isActive()).toBe( false);
      
      editor.startEdit('const data = {');
      expect(editor.isActive()).toBe( true);
      
      editor.addLine('  name: "test",');
      editor.addLine('  value: 42');
      editor.addLine('};');
      
      const content = editor.getContent();
      expect(content.includes('const data = {')).toBe( true);
      expect(content.includes('name: "test"')).toBe( true);
      expect(content.includes('value: 42')).toBe( true);
      expect(content.includes('};')).toBe( true);
      
      editor.clear();
      expect(editor.isActive()).toBe( false);
      expect(editor.getContent()).toBe( '');
    });

    it('should handle initial content', async () => {
      const { MultiLineEditor } = await import('../../package/src/cli/enhanced-repl.ts');
      const editor = new (MultiLineEditor as any)();
      
      const initialContent = 'function test() {\n  return true;\n}';
      editor.startEdit(initialContent);
      
      const content = editor.getContent();
      expect(content).toBe( initialContent);
      
      editor.addLine('// Additional line');
      const updatedContent = editor.getContent();
      expect(updatedContent.includes('// Additional line')).toBe( true);
    });
  });

  describe('Command Parsing', () => {
    it('should parse commands with quotes and escapes', async () => {
      // Import the command parsing function
      const module = await import('../../package/src/cli/enhanced-repl.ts');
      const parseEnhancedCommand = (module as any).parseEnhancedCommand;
      
      // Simple command
      let parsed = parseEnhancedCommand('help');
      expect(parsed).toBe( ['help']);
      
      // Command with arguments
      parsed = parseEnhancedCommand('let name = "John Doe"');
      expect(parsed).toBe( ['let').toBe( 'name', '=', 'John Doe']);
      
      // Command with single quotes
      parsed = parseEnhancedCommand("set greeting = 'Hello World'");
      expect(parsed).toBe( ['set').toBe( 'greeting', '=', 'Hello World']);
      
      // Command with escaped quotes
      parsed = parseEnhancedCommand('echo "He said \\"Hello\\""');
      expect(parsed).toBe( ['echo').toBe( 'He said "Hello"']);
      
      // Command with multiple spaces
      parsed = parseEnhancedCommand('workflow  run    test.yaml');
      expect(parsed).toBe( ['workflow').toBe( 'run', 'test.yaml']);
      
      // Complex JSON assignment
      parsed = parseEnhancedCommand('let config = {"timeout": 5000, "retries": 3}');
      expect(parsed).toBe( ['let').toBe( 'config', '=', '{"timeout": 5000, "retries": 3}']);
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
      expect(completions.includes('help')).toBe( true);
      
      completions = getCompletions('deb', mockContext, mockVarManager);
      expect(completions.includes('debug')).toBe( true);
      
      // Variable name completion
      completions = getCompletions('get api', mockContext, mockVarManager);
      expect(completions.includes('apiKey')).toBe( true);
      
      completions = getCompletions('var con', mockContext, mockVarManager);
      expect(completions.includes('config')).toBe( true);
      
      // Session subcommand completion
      completions = getCompletions('session s', mockContext, mockVarManager);
      expect(completions.includes('save')).toBe( true);
      
      completions = getCompletions('session l', mockContext, mockVarManager);
      expect(completions.includes('list')).toBe( true);
      expect(completions.includes('load')).toBe( true);
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
      expect(varManager.get('test')).toBe( 'value');
    });

    it('should handle invalid JSON gracefully', async () => {
      const corruptFile = `${testDir}/corrupt-variables.json`;
      fs.writeFileSync(corruptFile,  'invalid json content', "utf8");
      
      const { VariableManager } = await import('../../package/src/cli/enhanced-repl.ts');
      
      // Should not crash, just start with empty state
      const varManager = new (VariableManager as any)(corruptFile);
      expect(varManager.list().length).toBe( 0);
      
      // Should still work normally
      varManager.set('test', 'value');
      expect(varManager.get('test')).toBe( 'value');
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
      
      fs.writeFileSync(workflowFile,  JSON.stringify(workflow, null, 2, "utf8"));
      
      // Mock workflow engine
      const mockEngine = {
        loadWorkflow: async (path: string) => {
          expect(path).toBe( workflowFile);
          return workflow;
        },
        executeWorkflow: async (wf: any) => {
          expect(wf.name).toBe( 'REPL Test Workflow');
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
      expect(mockContext.activeWorkflows.size).toBe( 1);
    });
  });
});
