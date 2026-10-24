// Main exports for the swarm system
export * from './coordinator.js';
export * from './executor.js';
export * from './types.js';
export * from './strategies/base.js';
export * from './strategies/auto.js';
export * from './strategies/research.js';
export * from './memory.js';

// Prompt copying system exports
export * from './prompt-copier.js';
export * from './prompt-copier-enhanced.js';
export * from './prompt-utils.js';
export * from './prompt-manager.js';
export * from './prompt-cli.js';

// Optimizations
export * from './optimizations/index.js';

// Utility function to get all exports
export function getSwarmComponents() {
  return {
    // Core components
    coordinator: () => import('./coordinator.js'),
    executor: () => import('./executor.js'),
    types: () => import('./types.js'),

    // Strategies
    strategies: {
      base: () => import('./strategies/base.js'),
      auto: () => import('./strategies/auto.js'),
      research: () => import('./strategies/research.js'),
    },

    // Memory
    memory: () => import('./memory.js'),

    // Prompt system
    promptCopier: () => import('./prompt-copier.js'),
    promptCopierEnhanced: () => import('./prompt-copier-enhanced.js'),
    promptUtils: () => import('./prompt-utils.js'),
    promptManager: () => import('./prompt-manager.js'),
    promptCli: () => import('./prompt-cli.js'),

    // Optimizations
    optimizations: () => import('./optimizations/index.js'),
  };
}
