// Global type definitions and environment compatibility

// Node.js global augmentations
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV?: 'development' | 'production' | 'test';
      DEBUG?: string;
      CLAUDE_FLOW_HOME?: string;
      [key: string]: string | undefined;
    }
  }
}

// Deno compatibility shims (when running in Node)
declare global {
  var Deno: any | undefined;
}

// Commander.js types extension
import type { Command as CommanderCommand } from 'commander';

declare module 'commander' {
  interface Command {
    showHelp(): void;
  }
}

// Table types
declare module 'cli-table3' {
  interface Table {
    push(...rows: any[]): void;
  }
}

export {};
