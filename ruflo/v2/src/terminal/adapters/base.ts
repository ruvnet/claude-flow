/**
 * Base terminal adapter interface
 */

export interface Terminal {
  id: string;
  pid?: number;
  executeCommand(command: string): Promise<string>;
  write(data: string): Promise<void>;
  read(): Promise<string>;
  isAlive(): boolean;
  kill(): Promise<void>;
  addOutputListener?(listener: (data: string) => void): void;
  removeOutputListener?(listener: (data: string) => void): void;
}

export interface ITerminalAdapter {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  createTerminal(): Promise<Terminal>;
  destroyTerminal(terminal: Terminal): Promise<void>;
}

export interface TerminalEvents {
  'terminal:created': { terminalId: string; pid?: number };
  'terminal:closed': { terminalId: string; code?: number; signal?: string };
  'terminal:error': { terminalId: string; error: Error };
  'terminal:output': { terminalId: string; data: string };
}
