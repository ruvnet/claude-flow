/**
 * Secure Random Utilities
 *
 * Cryptographically secure random ID and token generation.
 * Replaces Math.random() for security-sensitive operations.
 *
 * @module v3/shared/security/secure-random
 */

import { randomBytes, randomUUID } from 'crypto';

/**
 * Generate a cryptographically secure random ID
 * @param prefix Optional prefix for the ID
 * @param length Number of random bytes (default 12)
 * @returns Secure random ID string
 */
export function generateSecureId(prefix?: string, length: number = 12): string {
  const timestamp = Date.now().toString(36);
  const randomPart = randomBytes(length).toString('hex');
  return prefix ? `${prefix}_${timestamp}_${randomPart}` : `${timestamp}_${randomPart}`;
}

/**
 * Generate a UUID v4 (cryptographically secure)
 * @returns UUID string
 */
export function generateUUID(): string {
  return randomUUID();
}

/**
 * Generate a secure token for authentication
 * @param length Number of bytes (default 32)
 * @returns Hex-encoded token string
 */
export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Generate a short secure ID (for display purposes)
 * @param prefix Optional prefix
 * @returns Short secure ID
 */
export function generateShortId(prefix?: string): string {
  const id = randomBytes(6).toString('base64url');
  return prefix ? `${prefix}-${id}` : id;
}

/**
 * Generate a secure session ID
 * @returns Session ID string
 */
export function generateSessionId(): string {
  return generateSecureId('session', 16);
}

/**
 * Generate a secure agent ID
 * @returns Agent ID string
 */
export function generateAgentId(): string {
  return generateSecureId('agent', 12);
}

/**
 * Generate a secure task ID
 * @returns Task ID string
 */
export function generateTaskId(): string {
  return generateSecureId('task', 12);
}

/**
 * Generate a secure memory ID
 * @returns Memory ID string
 */
export function generateMemoryId(): string {
  return generateSecureId('mem', 12);
}

/**
 * Generate a secure event ID
 * @returns Event ID string
 */
export function generateEventId(): string {
  return generateSecureId('evt', 12);
}

/**
 * Generate a secure swarm ID
 * @returns Swarm ID string
 */
export function generateSwarmId(): string {
  return generateSecureId('swarm', 12);
}

/**
 * Generate a secure pattern ID
 * @returns Pattern ID string
 */
export function generatePatternId(): string {
  return generateSecureId('pat', 12);
}

/**
 * Generate a secure trajectory ID
 * @returns Trajectory ID string
 */
export function generateTrajectoryId(): string {
  return generateSecureId('traj', 12);
}

/**
 * Generate a random integer in range [min, max] using crypto
 * @param min Minimum value (inclusive)
 * @param max Maximum value (inclusive)
 * @returns Cryptographically random integer
 */
export function secureRandomInt(min: number, max: number): number {
  const range = max - min + 1;
  const bytesNeeded = Math.ceil(Math.log2(range) / 8);
  const maxValid = Math.pow(256, bytesNeeded) - (Math.pow(256, bytesNeeded) % range);

  let randomValue: number;
  do {
    const bytes = randomBytes(bytesNeeded);
    randomValue = bytes.reduce((acc, byte, i) => acc + byte * Math.pow(256, i), 0);
  } while (randomValue >= maxValid);

  return min + (randomValue % range);
}

/**
 * Secure random selection from array
 * @param array Array to select from
 * @returns Random element
 */
export function secureRandomChoice<T>(array: T[]): T {
  if (array.length === 0) {
    throw new Error('Cannot select from empty array');
  }
  return array[secureRandomInt(0, array.length - 1)]!;
}

/**
 * Secure shuffle array (Fisher-Yates with crypto)
 * @param array Array to shuffle
 * @returns New shuffled array
 */
export function secureShuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = secureRandomInt(0, i);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
