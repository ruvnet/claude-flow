/**
 * Simple CLI tests that don't spawn processes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import packageJson from '../../package.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('CLI Basic Tests', () => {
  test('should pass basic test', () => {
    expect(true).toBe(true);
  });

  test('should verify CLI exists', () => {
    const cliPath = path.resolve(__dirname, '../../claude-flow');
    expect(fs.existsSync(cliPath)).toBe(true);
  });

  test('should verify package.json version', () => {
    expect(packageJson.version).toBe('2.0.0-alpha.54');
    expect(packageJson.name).toBe('claude-flow');
  });
});