/**
 * Type guard utilities for exactOptionalPropertyTypes compatibility
 * 
 * These utilities help handle TypeScript's exactOptionalPropertyTypes mode
 * by providing safe type guards and access patterns.
 */

/**
 * Type guard to check if a value is defined (not undefined)
 * @param value - The value to check
 * @returns Type predicate indicating if value is defined
 */
export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/**
 * Safely access array elements with fallback to empty string
 * @param arr - Array to access
 * @param index - Index to access
 * @returns Element at index or empty string if undefined
 */
export function safeStringAccess(arr: string[], index: number): string {
  return arr[index] ?? '';
}

/**
 * Safely access array elements with fallback to undefined
 * @param arr - Array to access
 * @param index - Index to access
 * @returns Element at index or undefined
 */
export function safeArrayAccess<T>(arr: T[], index: number): T | undefined {
  return arr[index];
}

/**
 * Create conditional spread object with defined values only
 * @param condition - Whether to include the value
 * @param obj - Object to spread
 * @returns Empty object or spread object
 */
export function conditionalSpread<T extends Record<string, any>>(
  condition: boolean,
  obj: T
): Partial<T> | {} {
  return condition ? obj : {};
}

/**
 * Create conditional spread with value check
 * @param value - Value to check
 * @param key - Key name for the object
 * @returns Object with key-value pair or empty object
 */
export function conditionalValue<T>(
  value: T | undefined,
  key: string
): Record<string, T> | {} {
  return value !== undefined ? { [key]: value } : {};
}

/**
 * Safely create an object with optional properties, omitting undefined values
 * This helps with exactOptionalPropertyTypes compliance
 * @param obj - Object with potentially undefined values
 * @returns Object with undefined properties omitted
 */
export function omitUndefinedProperties<T extends Record<string, any>>(
  obj: T
): { [K in keyof T as T[K] extends undefined ? never : K]: T[K] } {
  const result = {} as any;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Conditionally add a property to an object only if the value is defined
 * @param obj - Base object
 * @param key - Property key
 * @param value - Property value (may be undefined)
 * @returns New object with property added if value is defined
 */
export function conditionalProperty<T extends Record<string, any>, K extends string, V>(
  obj: T,
  key: K,
  value: V | undefined
): T & (V extends undefined ? {} : Record<K, V>) {
  if (value !== undefined) {
    return { ...obj, [key]: value } as T & Record<K, V>;
  }
  return obj as T & {};
}

/**
 * Create a safe optional object builder that handles exactOptionalPropertyTypes
 * @param base - Base object properties
 * @returns Object with only defined properties
 */
export function safeOptionalObject<T>(
  base: { [K in keyof T]: T[K] | undefined }
): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) {
      (result as any)[key] = value;
    }
  }
  return result;
}

/**
 * Type-safe property accessor that handles undefined gracefully
 * @param obj - Object to access
 * @param key - Property key
 * @param fallback - Fallback value if property is undefined
 * @returns Property value or fallback
 */
export function safePropertyAccess<T, K extends keyof T, F>(
  obj: T,
  key: K,
  fallback: F
): NonNullable<T[K]> | F {
  const value = obj[key];
  return (value !== undefined && value !== null) ? value as NonNullable<T[K]> : fallback;
}