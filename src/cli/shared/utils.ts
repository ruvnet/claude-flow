/**
 * CLI Utility Functions
 * Shared utility functions for CLI commands to prevent circular dependencies
 */

import chalk from "chalk";

// Helper functions for console output
export function success(message: string): void {
  console.log(chalk.green(`✅ ${message}`));
}

export function error(message: string): void {
  console.error(chalk.red(`❌ ${message}`));
}

export function warning(message: string): void {
  console.warn(chalk.yellow(`⚠️  ${message}`));
}

export function info(message: string): void {
  console.log(chalk.blue(`ℹ️  ${message}`));
}

