import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseUntrustedJsonFile,
  validateUntrustedJson,
  UntrustedJsonError,
} from '../lib/parse-untrusted-json.mjs';

function withTempJson(source, callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ruflo-untrusted-json-'));
  const file = path.join(directory, 'manifest.json');
  writeFileSync(file, source, 'utf8');
  try {
    return callback(file, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertCode(expectedCode, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof UntrustedJsonError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test('accepts a bounded plain-object manifest', () => {
  withTempJson(
    JSON.stringify({
      name: 'example-plugin',
      version: '1.0.0',
      skills: [{ name: 'audit' }],
    }),
    (file) => {
      const parsed = parseUntrustedJsonFile(file);
      assert.equal(parsed.name, 'example-plugin');
      assert.equal(parsed.skills[0].name, 'audit');
    },
  );
});

test('rejects a non-object JSON root', () => {
  withTempJson('[{"name":"plugin"}]', (file) => {
    assertCode('ROOT_NOT_OBJECT', () => parseUntrustedJsonFile(file));
  });
});

test('rejects __proto__ at any nesting level', () => {
  withTempJson('{"name":"plugin","nested":{"__proto__":{"polluted":true}}}', (file) => {
    assertCode('PROTOTYPE_POLLUTION_KEY', () => parseUntrustedJsonFile(file));
  });
});

test('rejects constructor.prototype key paths', () => {
  withTempJson('{"name":"plugin","constructor":{"prototype":{"polluted":true}}}', (file) => {
    assertCode('PROTOTYPE_POLLUTION_KEY', () => parseUntrustedJsonFile(file));
  });
});

test('allows legitimate standalone constructor and prototype metadata', () => {
  const parsed = validateUntrustedJson(JSON.parse(
    '{"constructor":"plugin-factory","prototype":{"name":"reference-shape"}}',
  ));
  assert.equal(parsed.constructor, 'plugin-factory');
  assert.equal(parsed.prototype.name, 'reference-shape');
});

test('rejects files above the configured byte limit before parsing', () => {
  withTempJson('{"name":"plugin","padding":"0123456789"}', (file) => {
    assertCode('FILE_SIZE_LIMIT', () => parseUntrustedJsonFile(file, { maxBytes: 10 }));
  });
});

test('rejects invalid JSON', () => {
  withTempJson('{"name":', (file) => {
    assertCode('INVALID_JSON', () => parseUntrustedJsonFile(file));
  });
});

test('rejects non-file paths', () => {
  withTempJson('{"name":"plugin"}', (_file, directory) => {
    assertCode('NOT_A_FILE', () => parseUntrustedJsonFile(directory));
  });
});

test('rejects excessive nesting', () => {
  const deeplyNested = { value: true };
  let current = deeplyNested;
  for (let depth = 0; depth < 6; depth += 1) {
    current.child = {};
    current = current.child;
  }

  assertCode('DEPTH_LIMIT', () => validateUntrustedJson(deeplyNested, { maxDepth: 4 }));
});

test('rejects oversized collections', () => {
  assertCode('ARRAY_LIMIT', () => validateUntrustedJson({ values: [1, 2, 3] }, { maxArrayLength: 2 }));
  assertCode('OBJECT_KEY_LIMIT', () => validateUntrustedJson({ a: 1, b: 2 }, { maxObjectKeys: 1 }));
});

test('rejects node and string limit violations', () => {
  assertCode('NODE_LIMIT', () => validateUntrustedJson({ a: 1, b: 2 }, { maxNodes: 2 }));
  assertCode('STRING_LIMIT', () => validateUntrustedJson({ value: 'abcd' }, { maxStringLength: 3 }));
});
