import path from 'path';
import fs from 'fs';

/**
 * Find the project root directory by looking for marker files
 * Starting from the current directory and traversing up
 * @param {string} startDir - Starting directory (defaults to process.cwd())
 * @returns {string} - The project root directory path
 */
export function findProjectRoot(startDir = process.cwd()) {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;
  
  // First, look for the main claude-flow project root
  let searchDir = currentDir;
  while (searchDir !== root) {
    const packageJsonPath = path.join(searchDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        // Check if this is the main claude-flow package
        if (packageJson.name === 'claude-flow' || 
            packageJson.name === '@anthropic/claude-flow') {
          // Also verify it has the expected structure
          if (fs.existsSync(path.join(searchDir, 'bin/claude-flow')) ||
              fs.existsSync(path.join(searchDir, 'src/cli')) ||
              fs.existsSync(path.join(searchDir, 'src/memory'))) {
            return searchDir;
          }
        }
      } catch (e) {
        // Continue searching if we can't parse package.json
      }
    }
    
    // Check for .git directory (strong indicator of project root)
    if (fs.existsSync(path.join(searchDir, '.git'))) {
      // If we find .git and it has claude-flow structure, use it
      if (fs.existsSync(path.join(searchDir, 'bin/claude-flow')) ||
          fs.existsSync(path.join(searchDir, '.claude-flow')) ||
          fs.existsSync(path.join(searchDir, 'CLAUDE.md'))) {
        return searchDir;
      }
    }
    
    // Move up one directory
    const parentDir = path.dirname(searchDir);
    if (parentDir === searchDir) {
      break;
    }
    searchDir = parentDir;
  }
  
  // Fallback: look for any .claude-flow or .swarm directory going up
  searchDir = currentDir;
  while (searchDir !== root) {
    if (fs.existsSync(path.join(searchDir, '.claude-flow')) ||
        fs.existsSync(path.join(searchDir, '.swarm'))) {
      // Additional check for main project markers
      if (fs.existsSync(path.join(searchDir, 'CLAUDE.md')) ||
          fs.existsSync(path.join(searchDir, 'bin/claude-flow'))) {
        return searchDir;
      }
    }
    
    const parentDir = path.dirname(searchDir);
    if (parentDir === searchDir) {
      break;
    }
    searchDir = parentDir;
  }
  
  // Final fallback to process.cwd()
  return process.cwd();
}

/**
 * Get the .claude-flow directory path relative to project root
 * @param {string} startDir - Starting directory for search
 * @returns {string} - Path to .claude-flow directory
 */
export function getClaudeFlowDir(startDir) {
  const root = findProjectRoot(startDir);
  return path.join(root, '.claude-flow');
}

/**
 * Get the .swarm directory path relative to project root
 * @param {string} startDir - Starting directory for search
 * @returns {string} - Path to .swarm directory
 */
export function getSwarmDir(startDir) {
  const root = findProjectRoot(startDir);
  return path.join(root, '.swarm');
}

/**
 * Get the .hive-mind directory path relative to project root
 * @param {string} startDir - Starting directory for search
 * @returns {string} - Path to .hive-mind directory
 */
export function getHiveMindDir(startDir) {
  const root = findProjectRoot(startDir);
  return path.join(root, '.hive-mind');
}

// Cached project root to avoid repeated filesystem lookups
let cachedProjectRoot = null;

/**
 * Get cached project root or find it
 * @returns {string} - The project root directory path
 */
export function getProjectRoot() {
  if (!cachedProjectRoot) {
    cachedProjectRoot = findProjectRoot();
  }
  return cachedProjectRoot;
}

/**
 * Clear the cached project root (useful for testing)
 */
export function clearProjectRootCache() {
  cachedProjectRoot = null;
}