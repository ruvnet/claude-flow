import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFullProjectPathValidator } from '../src/path-validator.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ruflo-blocked-paths-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('full-project blocked paths', () => {
  for (const name of ['node_modules/pkg/index.js', '.git/config', '.docker/config.json']) {
    for (const method of ['validate', 'validateSync'] as const) {
      it(`${method} rejects a descendant of ${name.split('/')[0]}`, async () => {
        const file = join(root, name);
        await mkdir(join(file, '..'), { recursive: true });
        await writeFile(file, 'private');
        const result = await createFullProjectPathValidator(root)[method](file);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('blocked'))).toBe(true);
      });
    }
  }
  for (const method of ['validate', 'validateSync'] as const) {
    it(`${method} blocks dotfile extensions while allowing normal hidden project files`, async () => {
      const validator = createFullProjectPathValidator(root);
      expect((await validator[method](join(root, '.env'))).isValid).toBe(false);
      expect((await validator[method](join(root, '.gitignore'))).isValid).toBe(true);
      expect((await validator[method](join(root, 'src/node_modules_notes.ts'))).isValid).toBe(true);
    });
  }
});
