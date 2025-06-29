/**
 * Cryptographically secure utility functions
 * Replaces insecure Math.random() usage throughout the codebase
 */

import { randomBytes, createHash } from 'node:crypto';

/**
 * Secure random string generation utilities
 */
export class SecureCrypto {
  /**
   * Generate a cryptographically secure random string
   * @param length - Length of the string to generate
   * @param charset - Character set to use (default: alphanumeric)
   * @returns Secure random string
   */
  static generateSecureRandomString(length: number = 32, charset: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'): string {
    const bytes = randomBytes(length);
    let result = '';
    
    for (let i = 0; i < length; i++) {
      result += charset[bytes[i] % charset.length];
    }
    
    return result;
  }

  /**
   * Generate a secure random ID with timestamp prefix
   * @param prefix - Prefix for the ID (e.g., 'session', 'token', 'scan')
   * @param randomLength - Length of the random suffix (default: 16)
   * @returns Secure ID string
   */
  static generateSecureId(prefix: string, randomLength: number = 16): string {
    const timestamp = Date.now().toString(36);
    const randomSuffix = this.generateSecureRandomString(randomLength, 'abcdefghijklmnopqrstuvwxyz0123456789');
    return `${prefix}_${timestamp}_${randomSuffix}`;
  }

  /**
   * Generate a cryptographically secure token
   * @param length - Length of the token (default: 32)
   * @returns Secure token string
   */
  static generateSecureToken(length: number = 32): string {
    const timestamp = Date.now().toString(36);
    const randomPart = this.generateSecureRandomString(length - timestamp.length - 5); // Account for prefix
    const hash = createHash('sha256')
      .update(`${timestamp}${randomPart}${randomBytes(16).toString('hex')}`)
      .digest('hex')
      .substring(0, 32);
    
    return `mcp_${timestamp}_${hash}`;
  }

  /**
   * Generate a secure session ID
   * @returns Secure session ID
   */
  static generateSecureSessionId(): string {
    return this.generateSecureId('session', 12);
  }

  /**
   * Generate secure random bytes in base36 format
   * @param length - Number of characters to generate
   * @returns Secure base36 string
   */
  static generateSecureBase36(length: number): string {
    const bytes = randomBytes(Math.ceil(length * 0.8)); // Slightly more bytes for better entropy
    return Array.from(bytes)
      .map(byte => byte.toString(36))
      .join('')
      .substring(0, length);
  }

  /**
   * Generate a secure UUID-like identifier
   * @returns Secure UUID-like string
   */
  static generateSecureUUID(): string {
    const bytes = randomBytes(16);
    const hex = bytes.toString('hex');
    
    // Format as UUID-like string
    return [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20, 32)
    ].join('-');
  }

  /**
   * Generate entropy for various security purposes
   * @param bytes - Number of bytes of entropy to generate
   * @returns Hex string of random bytes
   */
  static generateEntropy(bytes: number = 32): string {
    return randomBytes(bytes).toString('hex');
  }

  /**
   * Generate secure random number in a range
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (exclusive)
   * @returns Secure random number
   */
  static generateSecureRandomNumber(min: number, max: number): number {
    const range = max - min;
    const bytes = randomBytes(4);
    const randomValue = bytes.readUInt32BE(0);
    return min + (randomValue % range);
  }

  /**
   * Generate secure random array index
   * @param arrayLength - Length of the array
   * @returns Secure random index
   */
  static generateSecureArrayIndex(arrayLength: number): number {
    return this.generateSecureRandomNumber(0, arrayLength);
  }
}

/**
 * Legacy compatibility functions for easier migration
 */
export const CryptoUtils = {
  /**
   * Secure replacement for Math.random().toString(36).substring(2)
   * @param length - Length of random string to generate
   * @returns Secure random string in base36 format
   */
  secureRandomBase36: (length: number = 9): string => {
    return SecureCrypto.generateSecureBase36(length);
  },

  /**
   * Secure replacement for Math.random() * array.length
   * @param arrayLength - Length of the array
   * @returns Secure random index
   */
  secureRandomIndex: (arrayLength: number): number => {
    return SecureCrypto.generateSecureArrayIndex(arrayLength);
  },

  /**
   * Secure replacement for Math.floor(Math.random() * chars.length)
   * @param max - Maximum value (exclusive)
   * @returns Secure random number between 0 and max-1
   */
  secureRandomFloor: (max: number): number => {
    return SecureCrypto.generateSecureRandomNumber(0, max);
  }
};

/**
 * Export default instance for convenience
 */
export default SecureCrypto;