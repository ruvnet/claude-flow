/**
 * @claude-flow/mcp - JSON Schema Validator
 *
 * Lightweight JSON Schema validation for tool inputs
 * Implements JSON Schema Draft 2020-12 subset
 */

import type { JSONSchema } from './types.js';

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  params?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate data against JSON Schema
 */
export function validateSchema(
  data: unknown,
  schema: JSONSchema,
  path: string = ''
): ValidationResult {
  const errors: ValidationError[] = [];

  // Type validation
  if (schema.type) {
    const typeValid = validateType(data, schema.type);
    if (!typeValid) {
      errors.push({
        path: path || 'root',
        message: `Expected type "${schema.type}", got "${typeof data}"`,
        keyword: 'type',
        params: { expected: schema.type, actual: typeof data },
      });
      return { valid: false, errors };
    }
  }

  // Null check
  if (data === null || data === undefined) {
    if (schema.type && schema.type !== 'null') {
      errors.push({
        path: path || 'root',
        message: 'Value cannot be null or undefined',
        keyword: 'type',
      });
    }
    return { valid: errors.length === 0, errors };
  }

  // String validations
  if (schema.type === 'string' && typeof data === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({
        path,
        message: `String length must be >= ${schema.minLength}`,
        keyword: 'minLength',
        params: { limit: schema.minLength, actual: data.length },
      });
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({
        path,
        message: `String length must be <= ${schema.maxLength}`,
        keyword: 'maxLength',
        params: { limit: schema.maxLength, actual: data.length },
      });
    }
    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(data)) {
        errors.push({
          path,
          message: `String must match pattern "${schema.pattern}"`,
          keyword: 'pattern',
          params: { pattern: schema.pattern },
        });
      }
    }
    if (schema.enum && !schema.enum.includes(data)) {
      errors.push({
        path,
        message: `Value must be one of: ${schema.enum.join(', ')}`,
        keyword: 'enum',
        params: { allowedValues: schema.enum },
      });
    }
  }

  // Number validations
  if ((schema.type === 'number' || schema.type === 'integer') && typeof data === 'number') {
    if (schema.type === 'integer' && !Number.isInteger(data)) {
      errors.push({
        path,
        message: 'Value must be an integer',
        keyword: 'type',
      });
    }
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({
        path,
        message: `Value must be >= ${schema.minimum}`,
        keyword: 'minimum',
        params: { limit: schema.minimum, actual: data },
      });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({
        path,
        message: `Value must be <= ${schema.maximum}`,
        keyword: 'maximum',
        params: { limit: schema.maximum, actual: data },
      });
    }
  }

  // Array validations
  if (schema.type === 'array' && Array.isArray(data)) {
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        const itemResult = validateSchema(data[i], schema.items, `${path}[${i}]`);
        errors.push(...itemResult.errors);
      }
    }
  }

  // Object validations
  if (schema.type === 'object' && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;

    // Required properties
    if (schema.required) {
      for (const requiredProp of schema.required) {
        if (!(requiredProp in obj)) {
          errors.push({
            path: path ? `${path}.${requiredProp}` : requiredProp,
            message: `Required property "${requiredProp}" is missing`,
            keyword: 'required',
            params: { missingProperty: requiredProp },
          });
        }
      }
    }

    // Property validations
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (propName in obj) {
          const propPath = path ? `${path}.${propName}` : propName;
          const propResult = validateSchema(obj[propName], propSchema, propPath);
          errors.push(...propResult.errors);
        }
      }
    }

    // Additional properties check
    if (schema.additionalProperties === false && schema.properties) {
      const allowedProps = new Set(Object.keys(schema.properties));
      for (const propName of Object.keys(obj)) {
        if (!allowedProps.has(propName)) {
          errors.push({
            path: path ? `${path}.${propName}` : propName,
            message: `Additional property "${propName}" is not allowed`,
            keyword: 'additionalProperties',
            params: { additionalProperty: propName },
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate type
 */
function validateType(data: unknown, expectedType: string): boolean {
  if (expectedType === 'null') {
    return data === null;
  }
  if (expectedType === 'array') {
    return Array.isArray(data);
  }
  if (expectedType === 'integer') {
    return typeof data === 'number' && Number.isInteger(data);
  }
  if (expectedType === 'object') {
    return typeof data === 'object' && data !== null && !Array.isArray(data);
  }
  return typeof data === expectedType;
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((e) => `${e.path}: ${e.message}`).join('; ');
}

/**
 * Create a validator function for a specific schema
 */
export function createValidator(schema: JSONSchema): (data: unknown) => ValidationResult {
  return (data: unknown) => validateSchema(data, schema);
}
