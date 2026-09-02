/**
 * Centralized version management (JavaScript version)
 * Reads version from package.json to ensure consistency
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
let VERSION;
let BUILD_DATE;

try {
  // Navigate to project root and read package.json
  const packageJsonPath = join(__dirname, '../../package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  VERSION = packageJson.version;
  BUILD_DATE = new Date().toISOString().split('T')[0];
} catch (error) {
  // Fallback version if package.json can't be read
  console.warn('Warning: Could not read version from package.json, using fallback');
  VERSION = '2.0.0-alpha.101';
  BUILD_DATE = new Date().toISOString().split('T')[0];
}

export { VERSION, BUILD_DATE };

// Helper function to get formatted version string
export function getVersionString(includeV = true) {
  return includeV ? `v${VERSION}` : VERSION;
}

// Helper function for version display in CLI
export function displayVersion() {
  console.log(getVersionString());
}