/**
 * Unified CLI Interfaces
 * Common types and interfaces for the consolidated CLI system
 */

export interface CommandContext {
  /** Command arguments (excluding the command name itself) */
  args: string[];
  
  /** Parsed command-line flags and options */
  flags: Record<string, any>;
  
  /** Current working directory */
  workingDir: string;
  
  /** Configuration manager instance */
  config: any; // Will be typed properly once config system is unified
  
  /** Runtime adapter for environment-specific operations */
  runtime: RuntimeAdapter;
}

export interface CommandOption {
  /** Option flag (e.g., '-v', '--verbose') */
  flag: string;
  
  /** Option description for help text */
  description: string;
  
  /** Whether this option takes a value */
  hasValue?: boolean;
  
  /** Default value if not provided */
  defaultValue?: any;
  
  /** Aliases for this option */
  aliases?: string[];
}

export interface CommandHandler {
  /** The main action function for this command */
  action: (ctx: CommandContext) => Promise<void>;
  
  /** Description of what this command does */
  description: string;
  
  /** Command-specific options and flags */
  options?: CommandOption[];
  
  /** Subcommands for this command */
  subcommands?: Record<string, CommandHandler>;
  
  /** Examples of how to use this command */
  examples?: string[];
  
  /** Whether this command requires certain prerequisites */
  prerequisites?: string[];
}

export interface RuntimeAdapter {
  /** Read a file from the filesystem */
  readFile(path: string): Promise<string>;
  
  /** Write content to a file */
  writeFile(path: string, content: string): Promise<void>;
  
  /** Check if a file or directory exists */
  exists(path: string): Promise<boolean>;
  
  /** Get the current working directory */
  getCurrentDir(): string;
  
  /** Get an environment variable */
  getEnvVar(name: string): string | undefined;
  
  /** Spawn a child process */
  spawn(command: string, args: string[], options?: SpawnOptions): Promise<ProcessResult>;
  
  /** Resolve a path relative to the current directory */
  resolvePath(...segments: string[]): string;
  
  /** Get file stats */
  getStats(path: string): Promise<FileStats>;
}

export interface SpawnOptions {
  /** Working directory for the spawned process */
  cwd?: string;
  
  /** Environment variables */
  env?: Record<string, string>;
  
  /** Whether to inherit stdio */
  stdio?: 'inherit' | 'pipe' | 'ignore';
  
  /** Whether to use shell */
  shell?: boolean;
}

export interface ProcessResult {
  /** Exit code of the process */
  code: number;
  
  /** Standard output */
  stdout: string;
  
  /** Standard error */
  stderr: string;
}

export interface FileStats {
  /** Whether this is a file */
  isFile: boolean;
  
  /** Whether this is a directory */
  isDirectory: boolean;
  
  /** File size in bytes */
  size: number;
  
  /** Last modified time */
  mtime: Date;
}

export interface CLIError extends Error {
  /** Error code for programmatic handling */
  code: string;
  
  /** Whether this error should show usage information */
  showUsage?: boolean;
  
  /** Exit code to use */
  exitCode?: number;
}

export class CLIError extends Error implements CLIError {
  constructor(
    message: string,
    public code: string = 'CLI_ERROR',
    public exitCode: number = 1,
    public showUsage: boolean = false
  ) {
    super(message);
    this.name = 'CLIError';
  }
}

export interface LogLevel {
  ERROR: 'error';
  WARN: 'warn';
  INFO: 'info';
  DEBUG: 'debug';
  VERBOSE: 'verbose';
}

export interface Logger {
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  verbose(message: string, ...args: any[]): void;
  success(message: string, ...args: any[]): void;
}