/** Shared input contract for learned patterns supplied by feedback callers. */
export const feedbackPatternsSchema = {
  type: 'array', items: { type: 'string', minLength: 1, maxLength: 10_000 }, maxItems: 100,
  description: 'Learned patterns to retain; successful tasks with quality >= 0.9 may create reusable skills',
};

export function validateFeedbackPatterns(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100 || value.some(
    item => typeof item !== 'string' || !item.trim() || item.length > 10_000,
  )) {
    throw new Error('patterns must be an array of at most 100 non-empty strings (maximum 10000 characters each)');
  }
  return value;
}
