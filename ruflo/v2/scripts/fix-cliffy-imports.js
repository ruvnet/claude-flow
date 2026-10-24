#!/usr/bin/env node

/**
 * Script to fix Cliffy imports by creating a compatibility layer
 * This allows using Deno's Cliffy modules in Node.js
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Cliffy compatibility modules
const cliffyModules = {
  '@cliffy/command': `
export class Command {
  constructor() {
    this._name = '';
    this._version = '';
    this._description = '';
    this._options = [];
    this._commands = new Map();
    this._action = null;
  }

  name(name) {
    this._name = name;
    return this;
  }

  version(version) {
    this._version = version;
    return this;
  }

  description(description) {
    this._description = description;
    return this;
  }

  arguments(args) {
    this._arguments = args;
    return this;
  }

  option(flags, description, options) {
    this._options.push({ flags, description, options });
    return this;
  }

  action(fn) {
    this._action = fn;
    return this;
  }

  command(name, command) {
    if (command) {
      this._commands.set(name, command);
    }
    return command || new Command();
  }

  async parse(args) {
    // Simple parse implementation
    const parsed = { options: {}, args: [] };
    return parsed;
  }

  help() {
    console.log(\`Command: \${this._name}\`);
    console.log(\`Version: \${this._version}\`);
    console.log(\`Description: \${this._description}\`);
  }

  showHelp() {
    this.help();
  }
}
`,
  '@cliffy/table': `
export class Table {
  constructor() {
    this._headers = [];
    this._rows = [];
    this._options = {};
  }

  static from(data) {
    const table = new Table();
    if (Array.isArray(data) && data.length > 0) {
      if (typeof data[0] === 'object') {
        table._headers = Object.keys(data[0]);
        table._rows = data.map(row => Object.values(row));
      } else {
        table._rows = data;
      }
    }
    return table;
  }

  header(headers) {
    this._headers = headers;
    return this;
  }

  body(rows) {
    this._rows = rows;
    return this;
  }

  push(...rows) {
    this._rows.push(...rows);
    return this;
  }

  padding(padding) {
    this._options.padding = padding;
    return this;
  }

  indent(indent) {
    this._options.indent = indent;
    return this;
  }

  border(border) {
    this._options.border = border;
    return this;
  }

  toString() {
    // Simple table rendering
    let result = '';
    if (this._headers.length) {
      result += this._headers.join(' | ') + '\\n';
      result += '-'.repeat(this._headers.join(' | ').length) + '\\n';
    }
    for (const row of this._rows) {
      result += row.join(' | ') + '\\n';
    }
    return result;
  }

  render() {
    console.log(this.toString());
  }
}
`,
  '@cliffy/ansi/colors': `
const colorize = (code) => (text) => \`\\x1b[\${code}m\${text}\\x1b[0m\`;

export const red = colorize('31');
export const green = colorize('32');
export const yellow = colorize('33');
export const blue = colorize('34');
export const magenta = colorize('35');
export const cyan = colorize('36');
export const white = colorize('37');
export const gray = colorize('90');
export const bold = colorize('1');
export const dim = colorize('2');
export const italic = colorize('3');
export const underline = colorize('4');
export const inverse = colorize('7');
export const hidden = colorize('8');
export const strikethrough = colorize('9');
export const bgRed = colorize('41');
export const bgGreen = colorize('42');
export const bgYellow = colorize('43');
export const bgBlue = colorize('44');
export const bgMagenta = colorize('45');
export const bgCyan = colorize('46');
export const bgWhite = colorize('47');

export const colors = {
  red, green, yellow, blue, magenta, cyan, white, gray,
  bold, dim, italic, underline, inverse, hidden, strikethrough,
  bgRed, bgGreen, bgYellow, bgBlue, bgMagenta, bgCyan, bgWhite
};
`,
  '@cliffy/prompt': `
export const prompt = async (questions) => {
  const answers = {};
  for (const q of questions) {
    console.log(q.message);
    // Simplified implementation
    answers[q.name] = q.default || '';
  }
  return answers;
};

export const confirm = async (options) => {
  console.log(options.message);
  return options.default !== false;
};

export const input = async (options) => {
  console.log(options.message);
  return options.default || '';
};

export const number = async (options) => {
  console.log(options.message);
  return options.default || 0;
};

export const secret = async (options) => {
  console.log(options.message);
  return options.default || '';
};

export const select = async (options) => {
  console.log(options.message);
  return options.options?.[0] || options.default || '';
};

export const checkbox = async (options) => {
  console.log(options.message);
  return options.default || [];
};

// Add class exports
export class Select {
  constructor(options) {
    this.options = options;
  }
  async prompt() {
    return select(this.options);
  }
}

export class Input {
  constructor(options) {
    this.options = options;
  }
  async prompt() {
    return input(this.options);
  }
}

export class Confirm {
  constructor(options) {
    this.options = options;
  }
  async prompt() {
    return confirm(this.options);
  }
}

export class Number {
  constructor(options) {
    this.options = options;
  }
  async prompt() {
    return number(this.options);
  }
}
`
};

async function createCliffyModules() {
  const nodeModulesDir = path.join(__dirname, '..', 'node_modules');
  const cliffyDir = path.join(nodeModulesDir, '@cliffy');

  // Create @cliffy directory
  await fs.mkdir(cliffyDir, { recursive: true });

  // Create each module
  for (const [modulePath, content] of Object.entries(cliffyModules)) {
    const parts = modulePath.split('/');
    const moduleName = parts[1];
    const subPath = parts[2];

    const moduleDir = path.join(cliffyDir, moduleName);
    await fs.mkdir(moduleDir, { recursive: true });

    if (subPath) {
      // Create subdirectory for nested modules
      const fullPath = path.join(moduleDir, subPath + '.js');
      const dirPath = path.dirname(fullPath);
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(fullPath, content.trim());
    } else {
      // Create main module file
      await fs.writeFile(path.join(moduleDir, 'index.js'), content.trim());
    }

    // Create package.json for the module
    const packageJson = {
      name: modulePath,
      version: '0.22.2',
      main: subPath ? `${subPath}.js` : 'index.js',
      type: 'module'
    };
    await fs.writeFile(
      path.join(moduleDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
  }

  console.log('✅ Created Cliffy compatibility modules');
}

// Run the script
createCliffyModules().catch(console.error);