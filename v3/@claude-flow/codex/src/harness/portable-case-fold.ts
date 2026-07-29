/**
 * Conservative, deterministic case-fold key for cross-platform collision
 * refusal. Upper-then-lower catches multi-code-point folds such as ß -> ss and
 * final sigma -> sigma. NFKC intentionally over-rejects compatibility aliases;
 * it is never used to rewrite a repository path.
 */
export function portableCaseFold(value: string): string {
  return value.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFC');
}

