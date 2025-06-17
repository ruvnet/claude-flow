// init/utils.ts - Utility functions for init module
export function printSuccess(message: string): void {
  console.log(`\x1b[32m✅ ${message}\x1b[0m`);
}

export function printError(message: string): void {
  console.log(`\x1b[31m❌ ${message}\x1b[0m`);
}

export function printWarning(message: string): void {
  console.log(`\x1b[33m⚠️  ${message}\x1b[0m`);
}

export function printInfo(message: string): void {
  console.log(`\x1b[36mℹ️  ${message}\x1b[0m`);
}