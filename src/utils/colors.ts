/**
 * Simple colors utility for terminal output
 * Provides ANSI color codes for text formatting
 */

const ANSI_CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  
  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  
  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
};

// Check if colors should be disabled
const NO_COLOR = process.env['NO_COLOR'] || process.env['NODE_ENV'] === 'test';

function colorize(code: string, text: string): string {
  if (NO_COLOR) return text;
  return `${code}${text}${ANSI_CODES.reset}`;
}

export const colors = {
  red: (text: string) => colorize(ANSI_CODES.red, text),
  green: (text: string) => colorize(ANSI_CODES.green, text),
  blue: (text: string) => colorize(ANSI_CODES.blue, text),
  yellow: (text: string) => colorize(ANSI_CODES.yellow, text),
  cyan: (text: string) => colorize(ANSI_CODES.cyan, text),
  magenta: (text: string) => colorize(ANSI_CODES.magenta, text),
  gray: (text: string) => colorize(ANSI_CODES.gray, text),
  white: (text: string) => colorize(ANSI_CODES.white, text),
  black: (text: string) => colorize(ANSI_CODES.black, text),
  
  bold: (text: string) => colorize(ANSI_CODES.bold, text),
  dim: (text: string) => colorize(ANSI_CODES.dim, text),
  italic: (text: string) => colorize(ANSI_CODES.italic, text),
  underline: (text: string) => colorize(ANSI_CODES.underline, text),
  
  // Background colors
  bgRed: (text: string) => colorize(ANSI_CODES.bgRed, text),
  bgGreen: (text: string) => colorize(ANSI_CODES.bgGreen, text),
  bgBlue: (text: string) => colorize(ANSI_CODES.bgBlue, text),
  bgYellow: (text: string) => colorize(ANSI_CODES.bgYellow, text),
  bgCyan: (text: string) => colorize(ANSI_CODES.bgCyan, text),
  bgMagenta: (text: string) => colorize(ANSI_CODES.bgMagenta, text),
  bgWhite: (text: string) => colorize(ANSI_CODES.bgWhite, text),
  
  // Utility functions
  stripColors: (text: string) => {
    // Remove all ANSI escape codes
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  },
  
  // Combination helpers
  error: (text: string) => colorize(ANSI_CODES.red + ANSI_CODES.bold, text),
  success: (text: string) => colorize(ANSI_CODES.green + ANSI_CODES.bold, text),
  warning: (text: string) => colorize(ANSI_CODES.yellow + ANSI_CODES.bold, text),
  info: (text: string) => colorize(ANSI_CODES.blue, text),
  
  // Check if colors are enabled
  enabled: !NO_COLOR
};

// Default export for convenience
export default colors;