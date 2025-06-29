/**
 * Environment-specific configurations
 */
export { developmentConfig } from './development.js';
export { stagingConfig } from './staging.js';
export { productionConfig } from './production.js';

import { developmentConfig } from './development.js';
import { stagingConfig } from './staging.js';
import { productionConfig } from './production.js';
import { ClaudeFlowConfig, RuntimeConfig } from '../types.js';

/**
 * Get configuration for specific environment
 */
export function getEnvironmentConfig(env?: string): ClaudeFlowConfig {
  const environment = env || process.env.NODE_ENV || 'development';
  
  switch (environment) {
    case 'production':
    case 'prod':
      return productionConfig;
    
    case 'staging':
    case 'stage':
      return stagingConfig;
    
    case 'development':
    case 'dev':
    default:
      return developmentConfig;
  }
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if running in staging
 */
export function isStaging(): boolean {
  return process.env.NODE_ENV === 'staging';
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return !isProduction() && !isStaging();
}

/**
 * Get current environment name
 */
export function getEnvironmentName(): RuntimeConfig['environment'] {
  if (isProduction()) return 'production';
  if (isStaging()) return 'staging';
  return 'development';
}