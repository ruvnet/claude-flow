/**
 * State Management System
 * Unified state management for Claude-Flow
 */

// Core state manager
export { 
  UnifiedStateManager, 
  getStateManager, 
  initializeStateManager, 
  resetStateManager 
} from './state-manager.js';

// Types
export type * from './types.js';

// Adapters
export * from './adapters/index.js';

// Selectors
export * from './selectors.js';

// Persistence
export {
  StatePersistenceManager,
  FileSystemPersistenceBackend,
  MemoryPersistenceBackend
} from './persistence.js';

// Convenience factory functions
import { UnifiedStateManager, getStateManager } from './state-manager.js';
import { createStateAdapters, type StateAdapterFactory } from './adapters/index.js';
import { 
  StatePersistenceManager, 
  FileSystemPersistenceBackend,
  MemoryPersistenceBackend 
} from './persistence.js';
import type { StatePersistenceConfig } from './types.js';

/**
 * Initialize the complete state management system
 */
export interface StateSystemConfig {
  persistence?: {
    enabled: boolean;
    backends?: ('filesystem' | 'memory')[];
    primaryBackend?: string;
    filePath?: string;
    autoSave?: boolean;
    snapshotInterval?: number;
    maxSnapshots?: number;
  };
  adapters?: {
    swarm?: { coordinatorId: string; namespace?: string };
    agent?: { managerId: string; namespace?: string };
    task?: { engineId: string; namespace?: string };
    memory?: { managerId: string; namespace?: string };
  };
}

export interface StateSystem {
  stateManager: UnifiedStateManager;
  adapters: StateAdapterFactory;
  persistence?: StatePersistenceManager;
}

/**
 * Initialize the complete state management system with default configuration
 */
export function initializeStateSystem(config: StateSystemConfig = {}): StateSystem {
  // Initialize state manager
  const stateManager = getStateManager();

  // Create adapters
  const adapters = createStateAdapters(stateManager);

  // Initialize persistence if enabled
  let persistence: StatePersistenceManager | undefined;
  if (config.persistence?.enabled !== false) {
    const persistenceConfig = config.persistence || {};
    const backends = persistenceConfig.backends || ['filesystem'];
    const primaryBackend = persistenceConfig.primaryBackend || backends[0];
    
    const backendInstances = backends.map(backend => {
      switch (backend) {
        case 'filesystem':
          return new FileSystemPersistenceBackend(
            persistenceConfig.filePath || './.claude-flow/state.json'
          );
        case 'memory':
          return new MemoryPersistenceBackend();
        default:
          throw new Error(`Unknown persistence backend: ${backend}`);
      }
    });

    const persistenceManagerConfig: StatePersistenceConfig = {
      backends: backendInstances,
      primaryBackend,
      snapshotInterval: persistenceConfig.snapshotInterval || 60000, // 1 minute
      maxSnapshots: persistenceConfig.maxSnapshots || 10,
      compressSnapshots: false
    };

    persistence = new StatePersistenceManager(persistenceManagerConfig);

    // Start auto-save if enabled
    if (persistenceConfig.autoSave !== false) {
      persistence.startAutoSave(() => stateManager.getState());
    }

    // Try to load existing state
    persistence.load().then(existingState => {
      if (existingState) {
        // Note: We would need to implement state restoration in the state manager
        console.log('Existing state found and loaded');
      }
    }).catch(error => {
      console.warn('Failed to load existing state:', error.message);
    });
  }

  return {
    stateManager,
    adapters,
    persistence
  };
}

/**
 * Create a state system with custom adapters
 */
export function createCustomStateSystem(
  stateManager: UnifiedStateManager,
  adapterConfigs: StateSystemConfig['adapters'] = {}
): StateAdapterFactory {
  return createStateAdapters(stateManager);
}

/**
 * Get the global state system (singleton)
 */
let globalStateSystem: StateSystem | null = null;

export function getStateSystem(): StateSystem {
  if (!globalStateSystem) {
    globalStateSystem = initializeStateSystem();
  }
  return globalStateSystem;
}

/**
 * Reset the global state system (for testing)
 */
export function resetStateSystem(): void {
  if (globalStateSystem?.persistence) {
    globalStateSystem.persistence.dispose();
  }
  globalStateSystem = null;
}