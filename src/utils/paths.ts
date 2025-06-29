/**
 * Path utilities for Claude-Flow
 * Centralizes common path operations and project structure
 */

import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Get project root - works both from src/ and dist/ directories
function getProjectRoot(): string {
  // Handle ESM import.meta.url if available
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    
    // Navigate up from src/utils/ or dist/utils/ to project root
    if (currentDir.includes('/src/utils') || currentDir.includes('/dist/utils')) {
      return resolve(currentDir, '../../');
    }
    if (currentDir.includes('/src/') || currentDir.includes('/dist/')) {
      return resolve(currentDir, '../');
    }
    return currentDir;
  }
  
  // Fallback for CommonJS
  return resolve(__dirname, '../../');
}

const ROOT = getProjectRoot();

/**
 * Centralized path utilities
 */
export const paths = {
  // Project structure
  root: ROOT,
  src: join(ROOT, 'src'),
  dist: join(ROOT, 'dist'),
  config: join(ROOT, '.claude'),
  memory: join(ROOT, 'memory'),
  logs: join(ROOT, 'logs'),
  tmp: join(ROOT, '.tmp'),
  cache: join(ROOT, '.cache'),
  
  // Data directories
  data: join(ROOT, 'data'),
  backups: join(ROOT, 'memory/backups'),
  swarmRuns: join(ROOT, 'swarm-runs'),
  
  // Configuration files
  packageJson: join(ROOT, 'package.json'),
  tsConfig: join(ROOT, 'tsconfig.json'),
  jestConfig: join(ROOT, 'jest.config.js'),
  
  // Convenience functions
  join: (...segments: string[]) => join(ROOT, ...segments),
  resolve: (...segments: string[]) => resolve(ROOT, ...segments),
  relative: (from: string, to: string) => {
    return join(from, to);
  },
  
  // Common path operations
  ensureRelative: (path: string) => {
    if (path.startsWith(ROOT)) {
      return path.slice(ROOT.length + 1);
    }
    return path;
  },
  
  ensureAbsolute: (path: string) => {
    if (path.startsWith('/') || path.match(/^[a-zA-Z]:/)) {
      return path;
    }
    return join(ROOT, path);
  }
};

/**
 * Common path patterns
 */
export const patterns = {
  // File patterns
  typescript: '**/*.{ts,tsx}',
  javascript: '**/*.{js,jsx,mjs,cjs}',
  tests: '**/*.{test,spec}.{ts,js,tsx,jsx}',
  configs: '**/*.config.{ts,js,json}',
  
  // Directory patterns
  nodeModules: '**/node_modules/**',
  dist: '**/dist/**',
  coverage: '**/coverage/**',
  tmp: '**/.tmp/**',
  
  // Exclusion patterns for common operations
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.tmp/**',
    '**/.cache/**',
    '**/build/**'
  ]
};

/**
 * Path validation utilities
 */
export const validation = {
  isInProject: (path: string): boolean => {
    const absolute = paths.ensureAbsolute(path);
    return absolute.startsWith(ROOT);
  },
  
  isSafeToWrite: (path: string): boolean => {
    const absolute = paths.ensureAbsolute(path);
    
    // Don't allow writing to node_modules or other protected dirs
    const protectedPaths = [
      join(ROOT, 'node_modules'),
      join(ROOT, '.git'),
      '/usr', '/bin', '/etc', '/var'
    ];
    
    return !protectedPaths.some(protected => absolute.startsWith(protected));
  },
  
  isTemporary: (path: string): boolean => {
    const tempPatterns = ['.tmp', '.temp', '.cache', 'temp', 'tmp'];
    return tempPatterns.some(pattern => path.includes(pattern));
  }
};

// Default export for convenience
export default paths;