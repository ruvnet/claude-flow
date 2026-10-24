// DEPRECATED: Type definitions for Cliffy modules
// These definitions are no longer used as @cliffy has been replaced with:
// - @cliffy/command -> commander.js
// - @cliffy/prompt -> inquirer
// - @cliffy/table -> cli-table3
// - @cliffy/ansi/colors -> chalk
// This file is kept for reference only and should be removed once migration is complete.
declare module '@cliffy/ansi/colors' {
  export interface ColorFunction {
    (text: string): string;
  }

  export interface Colors {
    green: ColorFunction;
    red: ColorFunction;
    yellow: ColorFunction;
    blue: ColorFunction;
    gray: ColorFunction;
    cyan: ColorFunction;
    magenta: ColorFunction;
    white: ColorFunction;
    black: ColorFunction;
    bold: ColorFunction;
    dim: ColorFunction;
    italic: ColorFunction;
    underline: ColorFunction;
    bgRed: ColorFunction;
    bgGreen: ColorFunction;
    bgYellow: ColorFunction;
    bgBlue: ColorFunction;
    // Add more as needed
  }

  export const colors: Colors;
}

declare module '@cliffy/prompt' {
  export function select<T>(options: {
    message: string;
    options: Array<{ name: string; value: T }>;
    default?: T;
  }): Promise<T>;

  export function input(options: {
    message: string;
    default?: string;
    validate?: (value: string) => boolean | string;
  }): Promise<string>;

  export function confirm(options: { message: string; default?: boolean }): Promise<boolean>;

  export function number(options: {
    message: string;
    default?: number;
    min?: number;
    max?: number;
  }): Promise<number>;

  // Legacy capitalized exports for backward compatibility
  export const Select: typeof select;
  export const Input: typeof input;
  export const Confirm: typeof confirm;
  export const Number: typeof number;
}

declare module '@cliffy/command' {
  export class Command {
    name(name: string): this;
    version(version: string): this;
    description(desc: string): this;
    command(name: string, cmd: Command): this;
    option(flags: string, desc: string, opts?: any): this;
    action(fn: Function): this;
    parse(argv?: string[]): Promise<any>;
    showHelp(): void;
  }
}
