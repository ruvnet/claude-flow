/**
 * Native Node.js glob replacement for migration tools
 */

import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Recursively find files matching a pattern
 * @param pattern - Simple glob pattern (supports ** for recursive and * for wildcard)
 * @param options - Options including cwd
 * @returns Array of file paths relative to cwd
 */
export async function glob(pattern: string, options: { cwd: string }): Promise<string[]> {
  const { cwd } = options;
  const results: string[] = [];

  // Simple pattern parsing
  const isRecursive = pattern.includes('**');
  const extension = pattern.match(/\*\.(\w+)$/)?.[1];
  const fileName = pattern.match(/^([^*]+)$/)?.[1];

  async function walk(dir: string, baseDir: string = ''): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(baseDir, entry.name);

      if (entry.isDirectory() && isRecursive) {
        await walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        // Check if file matches pattern
        if (extension && entry.name.endsWith(`.${extension}`)) {
          results.push(relativePath);
        } else if (fileName && entry.name === fileName) {
          results.push(relativePath);
        } else if (pattern === '*' || pattern === '**/*') {
          results.push(relativePath);
        }
      }
    }
  }

  await walk(cwd);
  return results;
}