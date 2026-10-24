/**
 * Simple keyword-based sentiment classifier for review text.
 *
 * Returns 'positive', 'neutral', or 'negative' based on keyword
 * density in the text. Designed for restaurant review context.
 */

const POSITIVE_WORDS = new Set([
  'amazing', 'awesome', 'beautiful', 'best', 'brilliant', 'charming',
  'clean', 'cozy', 'creative', 'delicious', 'delightful', 'elegant',
  'excellent', 'exceptional', 'exquisite', 'fabulous', 'fantastic',
  'favorite', 'flavorful', 'fresh', 'friendly', 'generous', 'gorgeous',
  'great', 'heavenly', 'helpful', 'impressive', 'incredible', 'inviting',
  'lovely', 'magnificent', 'outstanding', 'perfect', 'phenomenal',
  'pleasant', 'polished', 'professional', 'recommend', 'refreshing',
  'remarkable', 'romantic', 'satisfied', 'savory', 'spectacular',
  'splendid', 'stellar', 'stunning', 'sublime', 'superb', 'terrific',
  'thoughtful', 'top-notch', 'wonderful', 'wow', 'yummy',
]);

const NEGATIVE_WORDS = new Set([
  'appalling', 'atrocious', 'awful', 'bad', 'bland', 'boring',
  'broken', 'careless', 'cheap', 'cold', 'complaint', 'confusing',
  'cramped', 'damp', 'dirty', 'disappointed', 'disappointing',
  'disgusting', 'dreadful', 'dry', 'dull', 'expensive', 'flavorless',
  'freezing', 'greasy', 'gross', 'horrible', 'horrid', 'ignored',
  'inattentive', 'inconsistent', 'inedible', 'loud', 'mediocre',
  'mess', 'mistake', 'nasty', 'noisy', 'overcooked', 'overpriced',
  'pathetic', 'poor', 'raw', 'rude', 'ruined', 'salty', 'slow',
  'soggy', 'stale', 'tasteless', 'terrible', 'undercooked',
  'unfriendly', 'unpleasant', 'unprofessional', 'wait', 'worst',
  'wrong',
]);

/**
 * Classify review text sentiment.
 */
export function analyzeSentiment(text: string): 'positive' | 'neutral' | 'negative' {
  if (!text || text.trim().length === 0) return 'neutral';

  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) positiveCount++;
    if (NEGATIVE_WORDS.has(word)) negativeCount++;
  }

  const total = positiveCount + negativeCount;
  if (total === 0) return 'neutral';

  const ratio = positiveCount / total;

  if (ratio >= 0.65) return 'positive';
  if (ratio <= 0.35) return 'negative';
  return 'neutral';
}
