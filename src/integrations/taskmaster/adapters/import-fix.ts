/**
 * Import path converter for Deno compatibility
 * Converts .js extensions to .ts for Deno module resolution
 */

export function fixImportPath(path: string): string {
  return path.replace(/\.js$/, '.ts');
}