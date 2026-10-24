/**
 * CLI Parameter Validation Helper
 * Provides standardized error messages for invalid parameters
 */

import { HelpFormatter } from './help-formatter.js';

export class ValidationHelper {
  /**
   * Validate enum parameter
   */
  static validateEnum(
    value: string,
    paramName: string,
    validOptions: string[],
    commandPath: string,
  ): void {
    if (!validOptions.includes(value)) {
      console.error(
        HelpFormatter.formatValidationError(value, paramName, validOptions, commandPath),
      );
      process.exit(1);
    }
  }

  /**
   * Validate numeric parameter
   */
  static validateNumber(
    value: string,
    paramName: string,
    min?: number,
    max?: number,
    commandPath?: string,
  ): number {
    const num = parseInt(value, 10);

    if (isNaN(num)) {
      console.error(
        HelpFormatter.formatError(
          `'${value}' is not a valid number for ${paramName}.`,
          commandPath || 'claude-flow',
        ),
      );
      process.exit(1);
    }

    if (min !== undefined && num < min) {
      console.error(
        HelpFormatter.formatError(
          `${paramName} must be at least ${min}. Got: ${num}`,
          commandPath || 'claude-flow',
        ),
      );
      process.exit(1);
    }

    if (max !== undefined && num > max) {
      console.error(
        HelpFormatter.formatError(
          `${paramName} must be at most ${max}. Got: ${num}`,
          commandPath || 'claude-flow',
        ),
      );
      process.exit(1);
    }

    return num;
  }

  /**
   * Validate required parameter
   */
  static validateRequired(value: any, paramName: string, commandPath?: string): void {
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      console.error(
        HelpFormatter.formatError(
          `Missing required parameter: ${paramName}`,
          commandPath || 'claude-flow',
        ),
      );
      process.exit(1);
    }
  }

  /**
   * Validate file path exists
   */
  static async validateFilePath(
    path: string,
    paramName: string,
    commandPath?: string,
  ): Promise<void> {
    try {
      const fs = await import('fs/promises');
      await fs.access(path);
    } catch (error) {
      console.error(
        HelpFormatter.formatError(
          `File not found for ${paramName}: ${path}`,
          commandPath || 'claude-flow',
        ),
      );
      process.exit(1);
    }
  }

  /**
   * Validate boolean flag
   */
  static validateBoolean(value: string, paramName: string, commandPath?: string): boolean {
    const lowerValue = value.toLowerCase();
    if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes') {
      return true;
    }
    if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no') {
      return false;
    }

    console.error(
      HelpFormatter.formatError(
        `'${value}' is not a valid boolean for ${paramName}. Use: true, false, yes, no, 1, or 0.`,
        commandPath || 'claude-flow',
      ),
    );
    process.exit(1);
  }
}
