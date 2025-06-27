/**
 * Compatibility layer for @cliffy/ansi/colors
 * Maps to chalk for Node.js compatibility
 */

import chalk from 'chalk';
import stripAnsi from 'strip-ansi';

// Create a colors object that matches cliffy's API
export const colors = {
  // Basic colors
  black: chalk.black,
  red: chalk.red,
  green: chalk.green,
  yellow: chalk.yellow,
  blue: chalk.blue,
  magenta: chalk.magenta,
  cyan: chalk.cyan,
  white: chalk.white,
  gray: chalk.gray,
  grey: chalk.gray,
  
  // Bright colors
  brightBlack: chalk.blackBright,
  brightRed: chalk.redBright,
  brightGreen: chalk.greenBright,
  brightYellow: chalk.yellowBright,
  brightBlue: chalk.blueBright,
  brightMagenta: chalk.magentaBright,
  brightCyan: chalk.cyanBright,
  brightWhite: chalk.whiteBright,
  
  // Background colors
  bgBlack: chalk.bgBlack,
  bgRed: chalk.bgRed,
  bgGreen: chalk.bgGreen,
  bgYellow: chalk.bgYellow,
  bgBlue: chalk.bgBlue,
  bgMagenta: chalk.bgMagenta,
  bgCyan: chalk.bgCyan,
  bgWhite: chalk.bgWhite,
  
  // Styles
  bold: chalk.bold,
  dim: chalk.dim,
  italic: chalk.italic,
  underline: chalk.underline,
  inverse: chalk.inverse,
  hidden: chalk.hidden,
  strikethrough: chalk.strikethrough,
  visible: chalk.visible,
  
  // Utility functions
  stripColor: stripAnsi,
  
  // Additional cliffy-specific color methods
  brightGray: chalk.gray,
  brightGrey: chalk.gray,
} as const;

// Export individual color functions for direct imports
export const {
  black,
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  white,
  gray,
  grey,
  bold,
  dim,
  italic,
  underline,
  inverse,
  hidden,
  strikethrough,
  visible,
} = colors;

// Default export
export default colors;