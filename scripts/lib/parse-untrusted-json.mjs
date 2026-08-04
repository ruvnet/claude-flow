import { lstatSync, readFileSync } from 'node:fs';

export class UntrustedJsonError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UntrustedJsonError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new UntrustedJsonError(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPrototypePollutionPath(key, child) {
  if (key === '__proto__') return true;
  return key === 'constructor' && isPlainObject(child) && hasOwn(child, 'prototype');
}

/**
 * Validate a parsed JSON value before application code consumes it.
 *
 * The limits are intentionally conservative for plugin manifests. They bound
 * traversal cost and reject object-key paths commonly used for prototype
 * pollution while preserving legitimate standalone `constructor` and
 * `prototype` metadata fields.
 */
export function validateUntrustedJson(value, options = {}) {
  const {
    requireRootObject = true,
    maxDepth = 16,
    maxNodes = 50_000,
    maxArrayLength = 10_000,
    maxObjectKeys = 5_000,
    maxStringLength = 256_000,
  } = options;

  if (requireRootObject && !isPlainObject(value)) {
    fail('ROOT_NOT_OBJECT', 'JSON root must be a plain object');
  }

  let visitedNodes = 0;
  const stack = [{ value, depth: 0, path: '$' }];

  while (stack.length > 0) {
    const current = stack.pop();
    visitedNodes += 1;

    if (visitedNodes > maxNodes) {
      fail('NODE_LIMIT', `JSON exceeds the maximum node count of ${maxNodes}`);
    }
    if (current.depth > maxDepth) {
      fail('DEPTH_LIMIT', `JSON exceeds the maximum depth of ${maxDepth} at ${current.path}`);
    }

    if (typeof current.value === 'string') {
      if (current.value.length > maxStringLength) {
        fail(
          'STRING_LIMIT',
          `JSON string exceeds the maximum length of ${maxStringLength} at ${current.path}`,
        );
      }
      continue;
    }

    if (current.value === null || typeof current.value !== 'object') continue;

    if (Array.isArray(current.value)) {
      if (current.value.length > maxArrayLength) {
        fail(
          'ARRAY_LIMIT',
          `JSON array exceeds the maximum length of ${maxArrayLength} at ${current.path}`,
        );
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current.value[index],
          depth: current.depth + 1,
          path: `${current.path}[${index}]`,
        });
      }
      continue;
    }

    if (!isPlainObject(current.value)) {
      fail('NON_PLAIN_OBJECT', `JSON contains a non-plain object at ${current.path}`);
    }

    const entries = Object.entries(current.value);
    if (entries.length > maxObjectKeys) {
      fail(
        'OBJECT_KEY_LIMIT',
        `JSON object exceeds the maximum key count of ${maxObjectKeys} at ${current.path}`,
      );
    }

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      if (isPrototypePollutionPath(key, child)) {
        fail(
          'PROTOTYPE_POLLUTION_KEY',
          `Unsafe JSON key path is not allowed at ${current.path}.${key}`,
        );
      }
      stack.push({
        value: child,
        depth: current.depth + 1,
        path: `${current.path}.${key}`,
      });
    }
  }

  return value;
}

/**
 * Read and validate a JSON file from an untrusted source.
 */
export function parseUntrustedJsonFile(filePath, options = {}) {
  const { maxBytes = 1_048_576, ...validationOptions } = options;

  let stats;
  try {
    stats = lstatSync(filePath);
  } catch (error) {
    fail('READ_ERROR', `Unable to stat JSON file: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!stats.isFile()) {
    fail('NOT_A_FILE', 'JSON path must reference a regular file');
  }
  if (stats.size > maxBytes) {
    fail('FILE_SIZE_LIMIT', `JSON file exceeds the maximum size of ${maxBytes} bytes`);
  }

  let source;
  try {
    source = readFileSync(filePath, 'utf8');
  } catch (error) {
    fail('READ_ERROR', `Unable to read JSON file: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (Buffer.byteLength(source, 'utf8') > maxBytes) {
    fail('FILE_SIZE_LIMIT', `JSON file exceeds the maximum size of ${maxBytes} bytes`);
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    fail('INVALID_JSON', `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  return validateUntrustedJson(parsed, validationOptions);
}
