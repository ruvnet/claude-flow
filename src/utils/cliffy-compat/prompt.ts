/**
 * Compatibility layer for @cliffy/prompt
 * Maps to inquirer for Node.js compatibility
 */

import inquirer from 'inquirer';

export interface InputOptions {
  message: string;
  default?: string;
  hint?: string;
  validate?: (value: string) => boolean | string | Promise<boolean | string>;
  transform?: (value: string) => string;
  minLength?: number;
  maxLength?: number;
}

export interface ConfirmOptions {
  message: string;
  default?: boolean;
  hint?: string;
}

export interface SelectOptions<T = string> {
  message: string;
  options: Array<{ name: string; value: T } | T>;
  default?: T;
  hint?: string;
  maxRows?: number;
  search?: boolean;
}

export class Input {
  static async prompt(options: InputOptions | string): Promise<string> {
    const opts = typeof options === 'string' ? { message: options } : options;
    
    const result = await inquirer.prompt([{
      type: 'input',
      name: 'value',
      message: opts.message,
      default: opts.default,
      validate: opts.validate,
      transformer: opts.transform,
    }]);
    
    return result.value;
  }
}

export class Confirm {
  static async prompt(options: ConfirmOptions | string): Promise<boolean> {
    const opts = typeof options === 'string' ? { message: options } : options;
    
    const result = await inquirer.prompt([{
      type: 'confirm',
      name: 'value',
      message: opts.message,
      default: opts.default ?? false,
    }]);
    
    return result.value;
  }
}

export class Select<T = string> {
  static async prompt<T = string>(options: SelectOptions<T>): Promise<T> {
    const choices = options.options.map(opt => {
      if (typeof opt === 'object' && 'name' in opt) {
        return opt;
      }
      return { name: String(opt), value: opt };
    });
    
    const result = await inquirer.prompt([{
      type: options.search ? 'autocomplete' : 'list',
      name: 'value',
      message: options.message,
      choices,
      default: options.default,
      pageSize: options.maxRows,
    }]);
    
    return result.value;
  }
}

// Utility prompt functions
export async function prompt(questions: Array<{
  type: string;
  name: string;
  message: string;
  default?: any;
  choices?: any[];
  validate?: (value: any) => boolean | string | Promise<boolean | string>;
}>): Promise<Record<string, any>> {
  return inquirer.prompt(questions);
}