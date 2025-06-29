/**
 * Generic state value types for the state management system
 */

// Base value types that can be stored in state
export type StateValue = 
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | StateObject
  | StateArray
  | StateMap
  | StateSet;

export interface StateObject {
  [key: string]: StateValue;
}

export interface StateArray extends Array<StateValue> {}

export interface StateMap extends Map<string, StateValue> {}

export interface StateSet extends Set<StateValue> {}

// Generic state change with proper typing
export interface TypedStateChange<T = StateValue> {
  id: string;
  timestamp: Date;
  action: StateAction;
  previousValue?: T;
  newValue?: T;
  path: string[];
}

// Generic state operation with proper typing
export interface TypedStateOperation<T = StateValue> {
  type: 'set' | 'update' | 'delete' | 'merge';
  path: string[];
  value?: T;
  updater?: (current: T) => T;
}

// State conflict with proper typing
export interface TypedStateConflict<T = StateValue> {
  path: string[];
  localValue: T;
  remoteValue: T;
  timestamp: Date;
}

// Conflict resolution with proper typing
export interface TypedConflictResolution<T = StateValue> {
  strategy: ConflictStrategy;
  resolvedValue: T;
  conflicts: TypedStateConflict<T>[];
}

// Type guards for state values
export function isStateObject(value: StateValue): value is StateObject {
  return typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);
}

export function isStateArray(value: StateValue): value is StateArray {
  return Array.isArray(value);
}

export function isStateMap(value: StateValue): value is StateMap {
  return value instanceof Map;
}

export function isStateSet(value: StateValue): value is StateSet {
  return value instanceof Set;
}

// Deep partial type for state updates
export type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>;
} : T;

// Path value type for accessing nested state
export type PathValue<T, P extends string[]> = P extends readonly []
  ? T
  : P extends readonly [infer K, ...infer R]
    ? K extends keyof T
      ? R extends string[]
        ? PathValue<T[K], R>
        : never
      : never
    : never;

// Re-export necessary types
export type { StateAction } from './missing-types.js';
export type ConflictStrategy = 'local-wins' | 'remote-wins' | 'merge' | 'custom';