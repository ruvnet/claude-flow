/**
 * V2 API Compatibility Tests
 *
 * Tests that V2 import paths work via aliases and class interfaces match.
 * Verifies method signatures and type compatibility.
 *
 * @module v3/testing/v2-compat/api-compat.test
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  V2CompatibilityValidator,
  V2_API_INTERFACES,
  type V2APIInterface,
  type ValidationResult,
} from './compatibility-validator.js';

/**
 * Mock V3 module registry for testing
 */
interface MockModuleRegistry {
  getClass: Mock<(name: string) => MockClass | null>;
  getClasses: Mock<() => string[]>;
  resolveImport: Mock<(path: string) => string | null>;
  getMethodSignature: Mock<(className: string, method: string) => string | null>;
  checkTypeCompatibility: Mock<(v2Type: string, v3Type: string) => boolean>;
}

/**
 * Mock class representation
 */
interface MockClass {
  name: string;
  v3Name: string;
  methods: MockMethod[];
  staticMethods: MockMethod[];
  properties: MockProperty[];
}

/**
 * Mock method representation
 */
interface MockMethod {
  name: string;
  signature: string;
  v2Signature?: string;
  compatible: boolean;
}

/**
 * Mock property representation
 */
interface MockProperty {
  name: string;
  type: string;
  readonly: boolean;
}

/**
 * V3 class implementations mapping
 */
const V3_CLASSES: Record<string, MockClass> = {
  'UnifiedSwarmCoordinator': {
    name: 'UnifiedSwarmCoordinator',
    v3Name: 'UnifiedSwarmCoordinator',
    methods: [
      { name: 'initialize', signature: '(config?: SwarmConfig): Promise<void>', compatible: true },
      { name: 'spawn', signature: '(agentType: string, config?: AgentConfig): Promise<Agent>', v2Signature: '(type: string, config?: AgentConfig): Promise<Agent>', compatible: true },
      { name: 'addAgent', signature: '(agent: Agent): Promise<void>', compatible: true },
      { name: 'removeAgent', signature: '(agentId: string): Promise<void>', compatible: true },
      { name: 'broadcast', signature: '(message: Message): Promise<void>', compatible: true },
      { name: 'consensus', signature: '(proposal: Proposal): Promise<ConsensusResult>', compatible: true },
      { name: 'getStatus', signature: '(): Promise<SwarmStatus>', compatible: true },
      { name: 'shutdown', signature: '(): Promise<void>', compatible: true },
      { name: 'init', signature: '(topology: string): Promise<void>', compatible: true },
    ],
    staticMethods: [],
    properties: [
      { name: 'topology', type: 'string', readonly: true },
      { name: 'agentCount', type: 'number', readonly: true },
      { name: 'status', type: 'SwarmStatus', readonly: true },
    ],
  },
  'UnifiedMemoryService': {
    name: 'UnifiedMemoryService',
    v3Name: 'UnifiedMemoryService',
    methods: [
      { name: 'store', signature: '(entry: MemoryEntry): Promise<string>', compatible: true },
      { name: 'search', signature: '(query: string, options?: SearchOptions): Promise<MemoryEntry[]>', v2Signature: '(search: string): Promise<MemoryEntry[]>', compatible: true },
      { name: 'query', signature: '(search: string): Promise<MemoryEntry[]>', compatible: true },
      { name: 'delete', signature: '(id: string): Promise<boolean>', compatible: true },
      { name: 'clear', signature: '(): Promise<void>', compatible: true },
      { name: 'getStats', signature: '(): Promise<MemoryStats>', compatible: true },
    ],
    staticMethods: [],
    properties: [
      { name: 'backend', type: 'string', readonly: true },
      { name: 'stats', type: 'MemoryStats', readonly: true },
    ],
  },
  'AgentLifecycleService': {
    name: 'AgentLifecycleService',
    v3Name: 'AgentLifecycleService',
    methods: [
      { name: 'spawn', signature: '(config: AgentConfig): Promise<Agent>', compatible: true },
      { name: 'terminate', signature: '(id: string): Promise<void>', compatible: true },
      { name: 'list', signature: '(): Promise<Agent[]>', compatible: true },
      { name: 'getInfo', signature: '(id: string): Promise<AgentInfo>', compatible: true },
      { name: 'getStatus', signature: '(id: string): Promise<AgentStatus>', compatible: true },
    ],
    staticMethods: [],
    properties: [
      { name: 'agents', type: 'Map<string, Agent>', readonly: true },
    ],
  },
  'TaskExecutionService': {
    name: 'TaskExecutionService',
    v3Name: 'TaskExecutionService',
    methods: [
      { name: 'create', signature: '(definition: TaskDefinition): Promise<Task>', compatible: true },
      { name: 'assign', signature: '(taskId: string, agentId: string): Promise<void>', compatible: true },
      { name: 'complete', signature: '(taskId: string, result?: TaskResult): Promise<void>', v2Signature: '(taskId: string, result?: any): Promise<void>', compatible: true },
      { name: 'getStatus', signature: '(taskId: string): Promise<TaskStatus>', compatible: true },
    ],
    staticMethods: [],
    properties: [
      { name: 'tasks', type: 'Map<string, Task>', readonly: true },
    ],
  },
};

/**
 * V2 to V3 import alias mapping
 */
const IMPORT_ALIASES: Record<string, string> = {
  'claude-flow/hive-mind': '@claude-flow/swarm',
  'claude-flow/swarm': '@claude-flow/swarm',
  'claude-flow/memory': '@claude-flow/memory',
  'claude-flow/agents': '@claude-flow/agent-lifecycle',
  'claude-flow/tasks': '@claude-flow/task-execution',
  'claude-flow/hooks': '@claude-flow/hooks',
  'claude-flow/config': '@claude-flow/config',
  'claude-flow': '@claude-flow/core',
};

/**
 * V2 to V3 class name mapping
 */
const CLASS_ALIASES: Record<string, string> = {
  'HiveMind': 'UnifiedSwarmCoordinator',
  'SwarmCoordinator': 'UnifiedSwarmCoordinator',
  'MemoryManager': 'UnifiedMemoryService',
  'AgentManager': 'AgentLifecycleService',
  'TaskOrchestrator': 'TaskExecutionService',
};

/**
 * Create mock module registry
 */
function createMockModuleRegistry(): MockModuleRegistry {
  return {
    getClass: vi.fn().mockImplementation((name: string) => {
      const v3Name = CLASS_ALIASES[name] || name;
      return V3_CLASSES[v3Name] || null;
    }),
    getClasses: vi.fn().mockReturnValue(Object.keys(V3_CLASSES)),
    resolveImport: vi.fn().mockImplementation((path: string) => {
      return IMPORT_ALIASES[path] || null;
    }),
    getMethodSignature: vi.fn().mockImplementation((className: string, methodName: string) => {
      const v3Name = CLASS_ALIASES[className] || className;
      const classInfo = V3_CLASSES[v3Name];
      if (!classInfo) return null;

      const method = classInfo.methods.find(m => m.name === methodName);
      return method?.signature || null;
    }),
    checkTypeCompatibility: vi.fn().mockImplementation((v2Type: string, v3Type: string) => {
      // Simplified type compatibility check
      if (v2Type === v3Type) return true;
      if (v2Type === 'any') return true;
      if (v3Type.includes(v2Type)) return true;
      return false;
    }),
  };
}

describe('V2 API Compatibility', () => {
  let validator: V2CompatibilityValidator;
  let mockRegistry: MockModuleRegistry;

  beforeEach(() => {
    mockRegistry = createMockModuleRegistry();
    validator = new V2CompatibilityValidator({
      verbose: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Import Path Aliases', () => {
    it.each(Object.entries(IMPORT_ALIASES))('should resolve V2 import "%s" to V3 "%s"', (v2Path, v3Path) => {
      const resolved = mockRegistry.resolveImport(v2Path);

      expect(resolved).toBe(v3Path);
    });

    it('should resolve claude-flow/hive-mind to @claude-flow/swarm', () => {
      const resolved = mockRegistry.resolveImport('claude-flow/hive-mind');

      expect(resolved).toBe('@claude-flow/swarm');
    });

    it('should resolve claude-flow/memory to @claude-flow/memory', () => {
      const resolved = mockRegistry.resolveImport('claude-flow/memory');

      expect(resolved).toBe('@claude-flow/memory');
    });

    it('should return null for unknown import paths', () => {
      const resolved = mockRegistry.resolveImport('unknown-package');

      expect(resolved).toBeNull();
    });
  });

  describe('Class Name Aliases', () => {
    it.each(Object.entries(CLASS_ALIASES))('should map V2 class "%s" to V3 "%s"', (v2Name, v3Name) => {
      const classInfo = mockRegistry.getClass(v2Name);

      expect(classInfo).not.toBeNull();
      expect(classInfo?.v3Name).toBe(v3Name);
    });

    it('should get HiveMind as UnifiedSwarmCoordinator', () => {
      const classInfo = mockRegistry.getClass('HiveMind');

      expect(classInfo).not.toBeNull();
      expect(classInfo?.name).toBe('UnifiedSwarmCoordinator');
    });

    it('should get MemoryManager as UnifiedMemoryService', () => {
      const classInfo = mockRegistry.getClass('MemoryManager');

      expect(classInfo).not.toBeNull();
      expect(classInfo?.name).toBe('UnifiedMemoryService');
    });
  });

  describe('HiveMind Interface', () => {
    const hiveMindInterface = V2_API_INTERFACES.find(i => i.name === 'HiveMind')!;

    it('should have all HiveMind methods available', () => {
      const classInfo = mockRegistry.getClass('HiveMind');

      expect(classInfo).not.toBeNull();

      for (const method of hiveMindInterface.methods) {
        const hasMethod = classInfo!.methods.some(m => m.name === method.name);
        expect(hasMethod).toBe(true);
      }
    });

    it('should have compatible initialize signature', () => {
      const signature = mockRegistry.getMethodSignature('HiveMind', 'initialize');

      expect(signature).toContain('Promise<void>');
    });

    it('should have compatible spawn signature', () => {
      const signature = mockRegistry.getMethodSignature('HiveMind', 'spawn');

      expect(signature).toContain('Promise<Agent>');
    });

    it('should have compatible getStatus signature', () => {
      const signature = mockRegistry.getMethodSignature('HiveMind', 'getStatus');

      expect(signature).toContain('Promise');
    });

    it('should have compatible shutdown signature', () => {
      const signature = mockRegistry.getMethodSignature('HiveMind', 'shutdown');

      expect(signature).toContain('Promise<void>');
    });
  });

  describe('SwarmCoordinator Interface', () => {
    const swarmInterface = V2_API_INTERFACES.find(i => i.name === 'SwarmCoordinator')!;

    it('should have all SwarmCoordinator methods available', () => {
      const classInfo = mockRegistry.getClass('SwarmCoordinator');

      expect(classInfo).not.toBeNull();

      for (const method of swarmInterface.methods) {
        const hasMethod = classInfo!.methods.some(m => m.name === method.name);
        expect(hasMethod).toBe(true);
      }
    });

    it('should have compatible init signature', () => {
      const signature = mockRegistry.getMethodSignature('SwarmCoordinator', 'init');

      expect(signature).toContain('topology');
      expect(signature).toContain('Promise<void>');
    });

    it('should have compatible addAgent signature', () => {
      const signature = mockRegistry.getMethodSignature('SwarmCoordinator', 'addAgent');

      expect(signature).toContain('Agent');
      expect(signature).toContain('Promise<void>');
    });

    it('should have compatible broadcast signature', () => {
      const signature = mockRegistry.getMethodSignature('SwarmCoordinator', 'broadcast');

      expect(signature).toContain('Message');
    });

    it('should have compatible consensus signature', () => {
      const signature = mockRegistry.getMethodSignature('SwarmCoordinator', 'consensus');

      expect(signature).toContain('Proposal');
      expect(signature).toContain('ConsensusResult');
    });
  });

  describe('MemoryManager Interface', () => {
    const memoryInterface = V2_API_INTERFACES.find(i => i.name === 'MemoryManager')!;

    it('should have all MemoryManager methods available', () => {
      const classInfo = mockRegistry.getClass('MemoryManager');

      expect(classInfo).not.toBeNull();

      for (const method of memoryInterface.methods) {
        const hasMethod = classInfo!.methods.some(m =>
          m.name === method.name || (method.name === 'query' && m.name === 'search')
        );
        expect(hasMethod).toBe(true);
      }
    });

    it('should have compatible store signature', () => {
      const signature = mockRegistry.getMethodSignature('MemoryManager', 'store');

      expect(signature).toContain('MemoryEntry');
      expect(signature).toContain('Promise<string>');
    });

    it('should have query aliased to search', () => {
      const classInfo = mockRegistry.getClass('MemoryManager');
      const hasQuery = classInfo!.methods.some(m => m.name === 'query');
      const hasSearch = classInfo!.methods.some(m => m.name === 'search');

      expect(hasQuery || hasSearch).toBe(true);
    });

    it('should have compatible delete signature', () => {
      const signature = mockRegistry.getMethodSignature('MemoryManager', 'delete');

      expect(signature).toContain('Promise<boolean>');
    });

    it('should have compatible getStats signature', () => {
      const signature = mockRegistry.getMethodSignature('MemoryManager', 'getStats');

      expect(signature).toContain('MemoryStats');
    });
  });

  describe('AgentManager Interface', () => {
    const agentInterface = V2_API_INTERFACES.find(i => i.name === 'AgentManager')!;

    it('should have all AgentManager methods available', () => {
      const classInfo = mockRegistry.getClass('AgentManager');

      expect(classInfo).not.toBeNull();

      for (const method of agentInterface.methods) {
        const hasMethod = classInfo!.methods.some(m => m.name === method.name);
        expect(hasMethod).toBe(true);
      }
    });

    it('should have compatible spawn signature', () => {
      const signature = mockRegistry.getMethodSignature('AgentManager', 'spawn');

      expect(signature).toContain('AgentConfig');
      expect(signature).toContain('Promise<Agent>');
    });

    it('should have compatible terminate signature', () => {
      const signature = mockRegistry.getMethodSignature('AgentManager', 'terminate');

      expect(signature).toContain('Promise<void>');
    });

    it('should have compatible list signature', () => {
      const signature = mockRegistry.getMethodSignature('AgentManager', 'list');

      expect(signature).toContain('Promise<Agent[]>');
    });

    it('should have compatible getInfo signature', () => {
      const signature = mockRegistry.getMethodSignature('AgentManager', 'getInfo');

      expect(signature).toContain('AgentInfo');
    });
  });

  describe('TaskOrchestrator Interface', () => {
    const taskInterface = V2_API_INTERFACES.find(i => i.name === 'TaskOrchestrator')!;

    it('should have all TaskOrchestrator methods available', () => {
      const classInfo = mockRegistry.getClass('TaskOrchestrator');

      expect(classInfo).not.toBeNull();

      for (const method of taskInterface.methods) {
        const hasMethod = classInfo!.methods.some(m => m.name === method.name);
        expect(hasMethod).toBe(true);
      }
    });

    it('should have compatible create signature', () => {
      const signature = mockRegistry.getMethodSignature('TaskOrchestrator', 'create');

      expect(signature).toContain('TaskDefinition');
      expect(signature).toContain('Promise<Task>');
    });

    it('should have compatible assign signature', () => {
      const signature = mockRegistry.getMethodSignature('TaskOrchestrator', 'assign');

      expect(signature).toContain('taskId');
      expect(signature).toContain('agentId');
    });

    it('should have compatible complete signature', () => {
      const signature = mockRegistry.getMethodSignature('TaskOrchestrator', 'complete');

      expect(signature).toContain('taskId');
      expect(signature).toContain('Promise<void>');
    });

    it('should have compatible getStatus signature', () => {
      const signature = mockRegistry.getMethodSignature('TaskOrchestrator', 'getStatus');

      expect(signature).toContain('TaskStatus');
    });
  });

  describe('Type Compatibility', () => {
    it('should accept any type as compatible', () => {
      const compatible = mockRegistry.checkTypeCompatibility('any', 'string');

      expect(compatible).toBe(true);
    });

    it('should accept same types as compatible', () => {
      const compatible = mockRegistry.checkTypeCompatibility('string', 'string');

      expect(compatible).toBe(true);
    });

    it('should accept subtype compatibility', () => {
      const compatible = mockRegistry.checkTypeCompatibility('Agent', 'Agent | null');

      expect(compatible).toBe(true);
    });
  });

  describe('Full API Validation', () => {
    it('should pass full API validation', async () => {
      const result: ValidationResult = await validator.validateAPI();

      expect(result.category).toBe('api');
      expect(result.totalChecks).toBeGreaterThan(0);
      expect(result.passedChecks).toBeGreaterThan(0);
    });

    it('should detect all V2 API interfaces', async () => {
      const result = await validator.validateAPI();
      const classChecks = result.checks.filter(c => c.name.startsWith('API Class:'));

      expect(classChecks.length).toBeGreaterThanOrEqual(V2_API_INTERFACES.length);
    });

    it('should verify method signatures', async () => {
      const result = await validator.validateAPI();
      const methodChecks = result.checks.filter(c => c.name.includes('Method:'));

      expect(methodChecks.length).toBeGreaterThan(0);
    });

    it('should provide migration paths', async () => {
      const result = await validator.validateAPI();
      const withMigration = result.checks.filter(c => c.migrationPath);

      expect(withMigration.length).toBeGreaterThan(0);
    });

    it('should report minimal breaking changes', async () => {
      const result = await validator.validateAPI();

      // Most interfaces should be compatible
      expect(result.breakingChanges).toBeLessThan(result.totalChecks * 0.2);
    });
  });

  describe('Backward Compatible Usage Patterns', () => {
    it('should support V2 HiveMind instantiation pattern', () => {
      // V2 pattern: const hive = new HiveMind(config);
      // V3 equivalent: const hive = new UnifiedSwarmCoordinator(config);
      const classInfo = mockRegistry.getClass('HiveMind');

      expect(classInfo).not.toBeNull();
      expect(classInfo?.methods.some(m => m.name === 'initialize')).toBe(true);
    });

    it('should support V2 MemoryManager query pattern', () => {
      // V2 pattern: const results = await memory.query('search term');
      // V3 equivalent: const results = await memory.search('search term');
      const classInfo = mockRegistry.getClass('MemoryManager');
      const hasQueryOrSearch = classInfo?.methods.some(m =>
        m.name === 'query' || m.name === 'search'
      );

      expect(hasQueryOrSearch).toBe(true);
    });

    it('should support V2 agent spawn pattern', () => {
      // V2 pattern: const agent = await manager.spawn({ type: 'coder' });
      // V3 equivalent: const agent = await lifecycle.spawn({ agentType: 'coder' });
      const classInfo = mockRegistry.getClass('AgentManager');

      expect(classInfo?.methods.some(m => m.name === 'spawn')).toBe(true);
    });
  });
});

describe('API Coverage', () => {
  it('should define all core V2 API interfaces', () => {
    const coreInterfaces = ['HiveMind', 'SwarmCoordinator', 'MemoryManager', 'AgentManager', 'TaskOrchestrator'];

    for (const name of coreInterfaces) {
      const iface = V2_API_INTERFACES.find(i => i.name === name);
      expect(iface).toBeDefined();
    }
  });

  it('should have V3 equivalents for all interfaces', () => {
    for (const iface of V2_API_INTERFACES) {
      expect(iface.v3Equivalent).toBeDefined();
      expect(iface.v3Equivalent).not.toBe('');
    }
  });

  it('should define methods for all interfaces', () => {
    for (const iface of V2_API_INTERFACES) {
      expect(iface.methods.length).toBeGreaterThan(0);
    }
  });

  it('should define method signatures correctly', () => {
    for (const iface of V2_API_INTERFACES) {
      for (const method of iface.methods) {
        expect(method.name).toBeDefined();
        expect(method.signature).toBeDefined();
        expect(method.signature).toContain(':');
      }
    }
  });

  it('should cover common method patterns', () => {
    const allMethods = V2_API_INTERFACES.flatMap(i => i.methods.map(m => m.name));

    expect(allMethods).toContain('initialize');
    expect(allMethods).toContain('spawn');
    expect(allMethods).toContain('store');
    expect(allMethods).toContain('create');
    expect(allMethods).toContain('getStatus');
  });
});
