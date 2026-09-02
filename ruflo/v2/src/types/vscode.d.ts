// Type definitions for VS Code extension API (minimal)
// This is a placeholder for the actual VS Code types when running in extension context

declare module 'vscode' {
  export interface ExtensionContext {
    subscriptions: { dispose(): any }[];
    workspaceState: any;
    globalState: any;
    extensionPath: string;
  }

  export interface OutputChannel {
    append(value: string): void;
    appendLine(value: string): void;
    clear(): void;
    dispose(): void;
    hide(): void;
    show(preserveFocus?: boolean): void;
  }

  export interface Terminal {
    name: string;
    processId: Thenable<number | undefined>;
    sendText(text: string, addNewLine?: boolean): void;
    show(preserveFocus?: boolean): void;
    hide(): void;
    dispose(): void;
  }

  export interface TerminalOptions {
    name?: string;
    shellPath?: string;
    shellArgs?: string[];
    cwd?: string;
    env?: { [key: string]: string | undefined };
    strictEnv?: boolean;
    hideFromUser?: boolean;
    location?: any;
  }

  export interface Event<T> {
    (listener: (e: T) => any, thisArgs?: any, disposables?: any[]): any;
  }

  export class EventEmitter<T> {
    event: Event<T>;
    fire(data: T): void;
    dispose(): void;
  }

  export namespace window {
    export function createOutputChannel(name: string): OutputChannel;
    export function createTerminal(options: TerminalOptions): Terminal;
    export function createTerminal(
      name: string,
      shellPath?: string,
      shellArgs?: string[],
    ): Terminal;
    export function showErrorMessage(
      message: string,
      ...items: string[]
    ): Thenable<string | undefined>;
    export function showInformationMessage(
      message: string,
      ...items: string[]
    ): Thenable<string | undefined>;
    export function showWarningMessage(
      message: string,
      ...items: string[]
    ): Thenable<string | undefined>;
    export const onDidCloseTerminal: Event<Terminal>;
    export function registerTerminalProfileProvider(id: string, provider: any): any;
  }

  export namespace workspace {
    export const workspaceFolders: readonly WorkspaceFolder[] | undefined;
  }

  export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
  }

  export class Uri {
    static file(path: string): Uri;
    static parse(value: string): Uri;
    readonly scheme: string;
    readonly authority: string;
    readonly path: string;
    readonly query: string;
    readonly fragment: string;
    readonly fsPath: string;
    toString(): string;
  }
}
