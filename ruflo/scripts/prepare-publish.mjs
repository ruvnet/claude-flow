#!/usr/bin/env node

import { copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await copyFile(resolve(packageDir, '..', 'README.md'), resolve(packageDir, 'README.md'));
