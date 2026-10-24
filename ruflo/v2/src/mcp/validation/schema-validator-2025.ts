/**
 * JSON Schema 1.1 Validator for MCP 2025-11
 *
 * Implements comprehensive schema validation per MCP 2025-11 specification
 * using JSON Schema Draft 2020-12
 */

import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import addErrors from 'ajv-errors';
import type { ILogger } from '../../interfaces/logger.js';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
    params?: any;
  }>;
}

/**
 * Schema cache entry
 */
interface CachedSchema {
  schema: object;
  validate: any;
  timestamp: number;
}

/**
 * MCP 2025-11 JSON Schema Validator
 *
 * Features:
 * - JSON Schema Draft 2020-12 support
 * - Format validation (uri, email, date-time, etc.)
 * - Schema caching for performance
 * - Custom error messages
 * - $ref support
 */
export class SchemaValidator {
  private ajv: Ajv;
  private schemaCache: Map<string, CachedSchema> = new Map();
  private cacheTTL = 3600000; // 1 hour
  private readonly MAX_CACHE_SIZE = 1000; // Maximum cached schemas

  constructor(private logger: ILogger) {
    this.ajv = new Ajv({
      allErrors: true,
      strict: true,
      validateFormats: true,
      allowUnionTypes: true,
      // Support JSON Schema Draft 2020-12
      schemaId: 'auto',
    });

    // Add format validators (email, uri, date-time, etc.)
    addFormats(this.ajv);

    // Add custom error messages support
    addErrors(this.ajv);

    this.logger.info('Schema validator initialized', {
      draft: '2020-12',
      formats: 'enabled',
    });
  }

  /**
   * Validate input against JSON Schema 1.1
   */
  validateInput(schema: object, input: unknown): ValidationResult {
    try {
      const validate = this.getValidator(schema);
      const valid = validate(input);

      if (!valid && validate.errors) {
        return {
          valid: false,
          errors: this.formatErrors(validate.errors),
        };
      }

      return { valid: true };
    } catch (error) {
      this.logger.error('Schema validation error', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        valid: false,
        errors: [{
          path: '',
          message: 'Schema validation failed',
        }],
      };
    }
  }

  /**
   * Validate output against schema
   */
  validateOutput(schema: object, output: unknown): ValidationResult {
    return this.validateInput(schema, output);
  }

  /**
   * Validate tool schema itself
   */
  validateToolSchema(toolSchema: object): ValidationResult {
    // Ensure schema has required fields
    const requiredFields = ['$schema', 'type', 'properties'];
    const schemaObj = toolSchema as any;

    const missing = requiredFields.filter(field => !(field in schemaObj));
    if (missing.length > 0) {
      return {
        valid: false,
        errors: missing.map(field => ({
          path: '/',
          message: `Missing required field: ${field}`,
        })),
      };
    }

    // Validate schema is valid JSON Schema
    try {
      this.ajv.compile(toolSchema);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errors: [{
          path: '/',
          message: error instanceof Error ? error.message : 'Invalid schema',
        }],
      };
    }
  }

  /**
   * Get or create validator for schema
   */
  private getValidator(schema: object): any {
    const schemaKey = JSON.stringify(schema);
    const cached = this.schemaCache.get(schemaKey);

    // Return cached validator if still valid
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.validate;
    }

    // Compile new validator
    try {
      const validate = this.ajv.compile(schema);

      // Enforce cache size limit (LRU eviction - remove oldest entry)
      if (this.schemaCache.size >= this.MAX_CACHE_SIZE) {
        const oldest = Array.from(this.schemaCache.entries())
          .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];

        if (oldest) {
          this.schemaCache.delete(oldest[0]);
          this.logger.debug('Evicted oldest schema from cache', {
            cacheSize: this.schemaCache.size,
            maxSize: this.MAX_CACHE_SIZE,
          });
        }
      }

      // Cache for future use
      this.schemaCache.set(schemaKey, {
        schema,
        validate,
        timestamp: Date.now(),
      });

      return validate;
    } catch (error) {
      this.logger.error('Failed to compile schema', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Format ajv errors to user-friendly format
   */
  private formatErrors(errors: ErrorObject[]): ValidationResult['errors'] {
    return errors.map(err => ({
      path: err.instancePath || '/',
      message: this.getErrorMessage(err),
      params: err.params,
    }));
  }

  /**
   * Get user-friendly error message
   */
  private getErrorMessage(error: ErrorObject): string {
    const { keyword, message, params } = error;

    switch (keyword) {
      case 'required':
        return `Missing required property: ${params.missingProperty}`;
      case 'type':
        return `Expected ${params.type} but got ${typeof params.data}`;
      case 'format':
        return `Invalid format for ${params.format}`;
      case 'minimum':
        return `Value must be >= ${params.limit}`;
      case 'maximum':
        return `Value must be <= ${params.limit}`;
      case 'minLength':
        return `String must be at least ${params.limit} characters`;
      case 'maxLength':
        return `String must be at most ${params.limit} characters`;
      case 'pattern':
        return `String must match pattern: ${params.pattern}`;
      case 'enum':
        return `Value must be one of: ${params.allowedValues?.join(', ')}`;
      default:
        return message || `Validation failed: ${keyword}`;
    }
  }

  /**
   * Clear schema cache
   */
  clearCache(): void {
    this.schemaCache.clear();
    this.logger.info('Schema cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.schemaCache.size,
      entries: Array.from(this.schemaCache.values()).map(entry => ({
        age: Date.now() - entry.timestamp,
        expired: Date.now() - entry.timestamp > this.cacheTTL,
      })),
    };
  }

  /**
   * Cleanup expired cache entries
   */
  cleanupCache(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.schemaCache.entries()) {
      if (now - entry.timestamp > this.cacheTTL) {
        this.schemaCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info('Cleaned up expired schema cache entries', { count: cleaned });
    }

    return cleaned;
  }
}

/**
 * Convert legacy tool schema to MCP 2025-11 format
 */
export function upgradeToolSchema(legacySchema: any): object {
  // If already in 2025-11 format, return as-is
  if (legacySchema.$schema && legacySchema.$schema.includes('2020-12')) {
    return legacySchema;
  }

  // Convert to 2025-11 format
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: legacySchema.type || 'object',
    properties: legacySchema.properties || {},
    required: legacySchema.required || [],
    additionalProperties: legacySchema.additionalProperties !== undefined
      ? legacySchema.additionalProperties
      : false,
    description: legacySchema.description,
  };
}
