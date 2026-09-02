/**
 * Cliffy Node.js Adapter
 *
 * This adapter provides Node.js-compatible implementations of Cliffy modules
 * by wrapping existing Node.js packages to match the Cliffy API.
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import Table from 'cli-table3';

// Colors adapter - map Cliffy colors to chalk
export const colors = {
  green: chalk.green,
  red: chalk.red,
  yellow: chalk.yellow,
  blue: chalk.blue,
  gray: chalk.gray,
  cyan: chalk.cyan,
  magenta: chalk.magenta,
  white: chalk.white,
  black: chalk.black,
  bold: chalk.bold,
  dim: chalk.dim,
  italic: chalk.italic,
  underline: chalk.underline,
  bgRed: chalk.bgRed,
  bgGreen: chalk.bgGreen,
  bgYellow: chalk.bgYellow,
  bgBlue: chalk.bgBlue,
};

// Prompt adapter - map Cliffy prompt to inquirer
export const Input = async (options: { message: string; default?: string }) => {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'value',
      message: options.message,
      default: options.default,
    },
  ]);
  return answers.value;
};

export const Confirm = async (options: { message: string; default?: boolean }) => {
  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'value',
      message: options.message,
      default: options.default,
    },
  ]);
  return answers.value;
};

export const Select = async <T>(options: {
  message: string;
  options: Array<{ name: string; value: T }>;
  default?: T;
}): Promise<T> => {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'value',
      message: options.message,
      choices: options.options.map((opt) => ({ name: opt.name, value: opt.value })),
      default: options.default,
    },
  ]);
  return answers.value;
};

// Table adapter - re-export cli-table3 with Cliffy-like API
export { Table };
