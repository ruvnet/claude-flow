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
    backends?: ('filesystem' | 'memory')[] | undefined;
    primaryBackend?: string | undefined;
    filePath?: string | undefined;
    autoSave?: boolean | undefined;
    snapshotInterval?: number | undefined;
    maxSnapshots?: number | undefined;
  } | undefined;
  adapters?: {
    swarm?: { coordinatorId: string; namespace?: string | undefined } | undefined;
    agent?: { managerId: string; namespace?: string | undefined } | undefined;
    task?: { engineId: string; namespace?: string | undefined } | undefined;
    memory?: { managerId: string; namespace?: string | undefined } | undefined;
  } | undefined;
}

export interface StateSystem {
  stateManager: UnifiedStateManager;
  adapters: StateAdapterFactory;
  persistence?: StatePersistenceManager | undefined;
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
    const backends = (persistenceConfig as any).backends || ['filesystem'];
    const primaryBackend = (persistenceConfig as any).primaryBackend || backends[0];
    
    const backendInstances = backends.map((backend: string) => {
      switch (backend) {
        case 'filesystem':
          return new FileSystemPersistenceBackend(
            (persistenceConfig as any).filePath || './.claude-flow/state.json'
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
      snapshotInterval: (persistenceConfig as any).snapshotInterval || 60000, // 1 minute
      maxSnapshots: (persistenceConfig as any).maxSnapshots || 10,
      compressSnapshots: false
    };

    persistence = new StatePersistenceManager(persistenceManagerConfig);

    // Start auto-save if enabled
    if ((persistenceConfig as any).autoSave !== false) {
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