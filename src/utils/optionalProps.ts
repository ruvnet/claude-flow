/**
 * Optional Properties Utilities
 * 
 * Helpers for handling exactOptionalPropertyTypes compliance.
 * These utilities ensure type safety when working with optional properties
 * in TypeScript strict mode with exactOptionalPropertyTypes enabled.
 */

/**
 * Type helper for removing undefined properties
 */
type DefinedProps<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] };

/**
 * Helper 1: conditionally add ONE property
 * ---------------------------------------
 * Usage:
 *   const payload = {
 *     id,
 *     ...withDefined('name', maybeName),
 *     ...withDefined('email', maybeEmail),
 *   }
 */
export function withDefined<K extends PropertyKey, V>(
  key: K,
  value: V | undefined
): V extends undefined ? {} : { [P in K]: V } {
  return (value === undefined ? {} : { [key]: value }) as any;
}

/**
 * Helper 2: strip *all* undefined values in a shallow object
 * ----------------------------------------------------------
 * Usage:
 *   const payload = pickDefined({
 *     name: maybeName,
 *     email: maybeEmail,
 *     // more props...
 *   })
 */
export function pickDefined<T extends Record<PropertyKey, unknown>>(
  obj: T
): DefinedProps<T> {
  const out: Record<PropertyKey, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as any;
}

/**
 * Helper 3: conditionally add multiple properties
 * -----------------------------------------------
 * Usage:
 *   const payload = {
 *     id,
 *     ...withDefinedProps({
 *       name: maybeName,
 *       email: maybeEmail,
 *       age: maybeAge
 *     })
 *   }
 */
export function withDefinedProps<T extends Record<PropertyKey, unknown>>(
  obj: T
): DefinedProps<T> {
  return pickDefined(obj);
}

/**
 * Type guard to check if a value is defined (not undefined)
 */
export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/**
 * Filter an array to only include defined values
 */
export function filterDefined<T>(arr: (T | undefined)[]): T[] {
  return arr.filter(isDefined);
}