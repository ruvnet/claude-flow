/**
 * Node.js compatibility layer for tests migrated from Deno
 * Provides Node.js equivalents for Deno APIs
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

// Environment variables
const env = {
  set: (key, value) => {
    process.env[key] = value;
  },
  get: (key) => process.env[key],
  delete: (key) => {
    delete process.env[key];
  }
};

// File system operations
const makeTempDir = (options = {}) => {
  const prefix = options.prefix || 'tmp-';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return tmpDir;
};

const writeTextFile = (filepath, content) => {
  fs.writeFileSync(filepath, content, 'utf8');
};

const readTextFile = (filepath) => {
  return fs.readFileSync(filepath, 'utf8');
};

const remove = (filepath, options = {}) => {
  if (options.recursive) {
    fs.rmSync(filepath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(filepath);
  }
};

const stat = (filepath) => {
  return fs.statSync(filepath);
};

// Command execution
class Command {
  constructor(command, options = {}) {
    this.command = command;
    this.options = options;
  }

  output() {
    try {
      const result = execSync(
        `${this.command} ${(this.options.args || []).join(' ')}`,
        {
          cwd: this.options.cwd || process.cwd(),
          env: { ...process.env, ...(this.options.env || {}) },
          encoding: 'utf8',
          stdio: this.options.stderr === 'piped' ? 'pipe' : 'inherit'
        }
      );

      return {
        code: 0,
        stdout: new TextEncoder().encode(result),
        stderr: new TextEncoder().encode('')
      };
    } catch (error) {
      return {
        code: error.status || 1,
        stdout: new TextEncoder().encode(error.stdout || ''),
        stderr: new TextEncoder().encode(error.stderr || error.message)
      };
    }
  }

  spawn() {
    const child = spawn(this.command, this.options.args || [], {
      cwd: this.options.cwd || process.cwd(),
      env: { ...process.env, ...(this.options.env || {}) },
      stdio: [
        'pipe',
        this.options.stdout === 'piped' ? 'pipe' : 'inherit',
        this.options.stderr === 'piped' ? 'pipe' : 'inherit'
      ]
    });

    // Add getReader method for stdout
    if (child.stdout) {
      child.stdout.getReader = function() {
        return {
          read: async () => {
            return new Promise((resolve) => {
              this.once('data', (chunk) => {
                resolve({ value: chunk, done: false });
              });
              this.once('end', () => {
                resolve({ done: true });
              });
            });
          }
        };
      };
    }

    // Add status property that returns a promise
    child.status = new Promise((resolve) => {
      child.on('exit', (code) => {
        resolve({ code, success: code === 0 });
      });
    });

    return child;
  }
}

// Path and process utilities
const cwd = () => process.cwd();
const execPath = () => process.execPath;

// Text encoding/decoding
class TextEncoder {
  encode(str) {
    return Buffer.from(str, 'utf8');
  }
}

class TextDecoder {
  constructor(encoding = 'utf-8') {
    this.encoding = encoding;
  }

  decode(buffer) {
    if (Buffer.isBuffer(buffer)) {
      return buffer.toString(this.encoding);
    }
    return buffer.toString();
  }
}

// Export Deno-compatible API
module.exports = {
  env,
  makeTempDir,
  writeTextFile,
  readTextFile,
  remove,
  stat,
  Command,
  cwd,
  execPath,
  TextEncoder,
  TextDecoder
};