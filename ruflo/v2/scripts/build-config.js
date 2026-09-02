/**
 * Build Configuration for Claude Flow
 * 
 * This configuration handles module resolution for dual Node.js/Deno support
 */

export const buildConfig = {
  // Module aliases for Node.js build
  moduleAliases: {
    '@cliffy/ansi/colors': './src/adapters/cliffy-node.ts',
    '@cliffy/prompt': './src/adapters/cliffy-node.ts',
    '@cliffy/table': './src/adapters/cliffy-node.ts',
  },
  
  // Modules to exclude from Node.js build
  excludeModules: [
    'vscode', // VS Code extension API
  ],
  
  // External modules that should not be bundled
  externals: [
    '@modelcontextprotocol/sdk',
    'better-sqlite3',
    'node-pty',
    'blessed',
  ],
};