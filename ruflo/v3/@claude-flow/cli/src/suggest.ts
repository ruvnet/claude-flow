/**
 * V3 CLI Smart Error Suggestions
 * Levenshtein distance and command suggestions
 *
 * Created with ruv.io
 */

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Early termination for empty strings
  if (m === 0) return n;
  if (n === 0) return m;

  // Create distance matrix
  const d: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // Initialize first column
  for (let i = 0; i <= m; i++) {
    d[i][0] = i;
  }

  // Initialize first row
  for (let j = 0; j <= n; j++) {
    d[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let j = 1; j <= n; j++) {
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // deletion
        d[i][j - 1] + 1,      // insertion
        d[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return d[m][n];
}

/**
 * Calculate similarity score (0-1) between two strings
 */
export function similarityScore(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  return 1 - distance / maxLen;
}

/**
 * Find similar strings from a list
 */
export function findSimilar(
  input: string,
  candidates: string[],
  options: {
    maxSuggestions?: number;
    minSimilarity?: number;
    maxDistance?: number;
  } = {}
): string[] {
  const {
    maxSuggestions = 3,
    minSimilarity = 0.4,
    maxDistance = 3
  } = options;

  const inputLower = input.toLowerCase();

  // Score all candidates
  const scored = candidates
    .map(candidate => ({
      candidate,
      distance: levenshteinDistance(inputLower, candidate.toLowerCase()),
      similarity: similarityScore(inputLower, candidate),
      // Boost prefix matches
      prefixBoost: candidate.toLowerCase().startsWith(inputLower) ? 0.3 : 0
    }))
    .filter(s => s.distance <= maxDistance || s.similarity >= minSimilarity)
    .map(s => ({
      ...s,
      score: s.similarity + s.prefixBoost
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSuggestions);

  return scored.map(s => s.candidate);
}

/**
 * Format suggestion message for CLI errors
 */
export function formatSuggestion(
  invalidInput: string,
  suggestions: string[],
  context: 'command' | 'subcommand' | 'option' | 'value' = 'command'
): string {
  if (suggestions.length === 0) {
    return '';
  }

  const contextMap = {
    command: 'Did you mean',
    subcommand: 'Available subcommands',
    option: 'Did you mean',
    value: 'Valid values'
  };

  const prefix = contextMap[context];

  if (suggestions.length === 1) {
    return `\n  ${prefix}: ${suggestions[0]}`;
  }

  return `\n  ${prefix}:\n${suggestions.map(s => `    - ${s}`).join('\n')}`;
}

/**
 * Common typos and their corrections
 */
export const COMMON_TYPOS: Record<string, string> = {
  'init': 'init',
  'initi': 'init',
  'inizialize': 'init',
  'staus': 'status',
  'stauts': 'status',
  'stats': 'stats',
  'stat': 'status',
  'swarrm': 'swarm',
  'swarn': 'swarm',
  'agnet': 'agent',
  'agen': 'agent',
  'memroy': 'memory',
  'mem': 'memory',
  'memmory': 'memory',
  'confg': 'config',
  'conf': 'config',
  'configu': 'config',
  'hook': 'hooks',
  'hoks': 'hooks',
  'hive': 'hive-mind',
  'hivemind': 'hive-mind',
  'hive_mind': 'hive-mind',
  'neurl': 'neural',
  'nueral': 'neural',
  'securty': 'security',
  'sec': 'security',
  'perf': 'performance',
  'performace': 'performance',
  'provider': 'providers',
  'plugin': 'plugins',
  'dep': 'deployment',
  'depoly': 'deployment',
  'deploy': 'deployment',
  'claim': 'claims',
  'embed': 'embeddings',
  'embeding': 'embeddings',
  'daemon': 'daemon',
  'deamon': 'daemon',
  'doc': 'doctor',
  'docter': 'doctor',
  'complete': 'completions',
  'completion': 'completions',
  'comp': 'completions',
  'task': 'task',
  'taks': 'task',
  'sessio': 'session',
  'sess': 'session',
  'sesssion': 'session',
  'workflow': 'workflow',
  'wf': 'workflow',
  'wokflow': 'workflow'
};

/**
 * Get corrected command if it's a common typo
 */
export function getTypoCorrection(input: string): string | undefined {
  return COMMON_TYPOS[input.toLowerCase()];
}

/**
 * Smart command suggestion for unknown commands
 */
export function suggestCommand(
  unknownCommand: string,
  availableCommands: string[]
): {
  correction?: string;
  suggestions: string[];
  message: string;
} {
  // Check for common typo first
  const correction = getTypoCorrection(unknownCommand);
  if (correction && availableCommands.includes(correction)) {
    return {
      correction,
      suggestions: [correction],
      message: `Did you mean "${correction}"?`
    };
  }

  // Find similar commands
  const suggestions = findSimilar(unknownCommand, availableCommands, {
    maxSuggestions: 3,
    minSimilarity: 0.3,
    maxDistance: 4
  });

  if (suggestions.length === 0) {
    return {
      suggestions: [],
      message: 'Run "claude-flow --help" to see available commands.'
    };
  }

  if (suggestions.length === 1) {
    return {
      suggestions,
      message: `Did you mean "${suggestions[0]}"?`
    };
  }

  return {
    suggestions,
    message: `Did you mean one of these?\n${suggestions.map(s => `  - ${s}`).join('\n')}`
  };
}

export default {
  levenshteinDistance,
  similarityScore,
  findSimilar,
  formatSuggestion,
  suggestCommand,
  getTypoCorrection,
  COMMON_TYPOS
};
