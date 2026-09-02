/**
 * V3 Claude-Flow Password Hasher Unit Tests
 *
 * London School TDD - Behavior Verification
 * Tests password hashing and verification behavior
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock, createMockWithBehavior, type MockedInterface } from '../../helpers/create-mock';
import { securityConfigs } from '../../fixtures/configurations';

/**
 * Password hasher interface (to be implemented)
 */
interface IPasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
}

/**
 * Crypto provider interface (collaborator)
 */
interface ICryptoProvider {
  argon2Hash(password: string, options: Argon2Options): Promise<string>;
  argon2Verify(hash: string, password: string): Promise<boolean>;
  generateSalt(length: number): Promise<string>;
}

interface Argon2Options {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  salt?: string;
}

/**
 * Password hasher implementation for testing
 */
class PasswordHasher implements IPasswordHasher {
  constructor(
    private readonly cryptoProvider: ICryptoProvider,
    private readonly config: typeof securityConfigs.strict.hashing
  ) {}

  async hash(password: string): Promise<string> {
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    const salt = await this.cryptoProvider.generateSalt(16);

    return this.cryptoProvider.argon2Hash(password, {
      memoryCost: this.config.memoryCost ?? 65536,
      timeCost: this.config.timeCost ?? 3,
      parallelism: this.config.parallelism ?? 4,
      salt,
    });
  }

  async verify(password: string, hash: string): Promise<boolean> {
    if (!password || !hash) {
      return false;
    }

    return this.cryptoProvider.argon2Verify(hash, password);
  }

  needsRehash(hash: string): boolean {
    // Check if hash uses current algorithm and parameters
    const currentVersion = `$argon2id$v=19$m=${this.config.memoryCost},t=${this.config.timeCost},p=${this.config.parallelism}`;
    return !hash.startsWith(currentVersion);
  }
}

describe('PasswordHasher', () => {
  let mockCryptoProvider: MockedInterface<ICryptoProvider>;
  let passwordHasher: PasswordHasher;
  const hashingConfig = securityConfigs.strict.hashing;

  beforeEach(() => {
    mockCryptoProvider = createMock<ICryptoProvider>();

    // Configure default mock behavior
    mockCryptoProvider.generateSalt.mockResolvedValue('randomsalt16byte');
    mockCryptoProvider.argon2Hash.mockResolvedValue(
      '$argon2id$v=19$m=65536,t=3,p=4$cmFuZG9tc2FsdA$hashedpassword'
    );
    mockCryptoProvider.argon2Verify.mockResolvedValue(true);

    passwordHasher = new PasswordHasher(mockCryptoProvider, hashingConfig);
  });

  describe('hash', () => {
    it('should generate salt before hashing', async () => {
      // Given
      const password = 'securePassword123!';

      // When
      await passwordHasher.hash(password);

      // Then - verify interaction
      expect(mockCryptoProvider.generateSalt).toHaveBeenCalledWith(16);
      expect(mockCryptoProvider.generateSalt).toHaveBeenCalledBefore(
        mockCryptoProvider.argon2Hash
      );
    });

    it('should hash password with configured parameters', async () => {
      // Given
      const password = 'securePassword123!';

      // When
      await passwordHasher.hash(password);

      // Then - verify interaction with correct parameters
      expect(mockCryptoProvider.argon2Hash).toHaveBeenCalledWith(
        password,
        expect.objectContaining({
          memoryCost: 65536,
          timeCost: 3,
          parallelism: 4,
        })
      );
    });

    it('should return hash from crypto provider', async () => {
      // Given
      const password = 'securePassword123!';
      const expectedHash = '$argon2id$v=19$m=65536,t=3,p=4$salt$hash';
      mockCryptoProvider.argon2Hash.mockResolvedValue(expectedHash);

      // When
      const result = await passwordHasher.hash(password);

      // Then
      expect(result).toBe(expectedHash);
    });

    it('should reject passwords shorter than 8 characters', async () => {
      // Given
      const shortPassword = 'short';

      // When/Then
      await expect(passwordHasher.hash(shortPassword)).rejects.toThrow(
        'Password must be at least 8 characters'
      );

      // Verify no interaction with crypto provider
      expect(mockCryptoProvider.generateSalt).not.toHaveBeenCalled();
      expect(mockCryptoProvider.argon2Hash).not.toHaveBeenCalled();
    });

    it('should reject empty passwords', async () => {
      // Given
      const emptyPassword = '';

      // When/Then
      await expect(passwordHasher.hash(emptyPassword)).rejects.toThrow(
        'Password must be at least 8 characters'
      );
    });

    it('should use generated salt in hash options', async () => {
      // Given
      const password = 'securePassword123!';
      const generatedSalt = 'unique-salt-value';
      mockCryptoProvider.generateSalt.mockResolvedValue(generatedSalt);

      // When
      await passwordHasher.hash(password);

      // Then
      expect(mockCryptoProvider.argon2Hash).toHaveBeenCalledWith(
        password,
        expect.objectContaining({
          salt: generatedSalt,
        })
      );
    });
  });

  describe('verify', () => {
    it('should delegate verification to crypto provider', async () => {
      // Given
      const password = 'securePassword123!';
      const hash = '$argon2id$v=19$m=65536,t=3,p=4$salt$hash';

      // When
      await passwordHasher.verify(password, hash);

      // Then - verify interaction
      expect(mockCryptoProvider.argon2Verify).toHaveBeenCalledWith(hash, password);
    });

    it('should return true for valid password', async () => {
      // Given
      const password = 'securePassword123!';
      const hash = '$argon2id$v=19$m=65536,t=3,p=4$salt$hash';
      mockCryptoProvider.argon2Verify.mockResolvedValue(true);

      // When
      const result = await passwordHasher.verify(password, hash);

      // Then
      expect(result).toBe(true);
    });

    it('should return false for invalid password', async () => {
      // Given
      const password = 'wrongPassword123!';
      const hash = '$argon2id$v=19$m=65536,t=3,p=4$salt$hash';
      mockCryptoProvider.argon2Verify.mockResolvedValue(false);

      // When
      const result = await passwordHasher.verify(password, hash);

      // Then
      expect(result).toBe(false);
    });

    it('should return false for empty password', async () => {
      // Given
      const emptyPassword = '';
      const hash = '$argon2id$v=19$m=65536,t=3,p=4$salt$hash';

      // When
      const result = await passwordHasher.verify(emptyPassword, hash);

      // Then
      expect(result).toBe(false);
      expect(mockCryptoProvider.argon2Verify).not.toHaveBeenCalled();
    });

    it('should return false for empty hash', async () => {
      // Given
      const password = 'securePassword123!';
      const emptyHash = '';

      // When
      const result = await passwordHasher.verify(password, emptyHash);

      // Then
      expect(result).toBe(false);
      expect(mockCryptoProvider.argon2Verify).not.toHaveBeenCalled();
    });
  });

  describe('needsRehash', () => {
    it('should return false for hash with current parameters', () => {
      // Given
      const currentHash = '$argon2id$v=19$m=65536,t=3,p=4$salt$hash';

      // When
      const result = passwordHasher.needsRehash(currentHash);

      // Then
      expect(result).toBe(false);
    });

    it('should return true for hash with different memory cost', () => {
      // Given
      const oldHash = '$argon2id$v=19$m=32768,t=3,p=4$salt$hash';

      // When
      const result = passwordHasher.needsRehash(oldHash);

      // Then
      expect(result).toBe(true);
    });

    it('should return true for hash with different time cost', () => {
      // Given
      const oldHash = '$argon2id$v=19$m=65536,t=2,p=4$salt$hash';

      // When
      const result = passwordHasher.needsRehash(oldHash);

      // Then
      expect(result).toBe(true);
    });

    it('should return true for hash with different parallelism', () => {
      // Given
      const oldHash = '$argon2id$v=19$m=65536,t=3,p=2$salt$hash';

      // When
      const result = passwordHasher.needsRehash(oldHash);

      // Then
      expect(result).toBe(true);
    });

    it('should return true for bcrypt hash', () => {
      // Given
      const bcryptHash = '$2b$10$salt.hash';

      // When
      const result = passwordHasher.needsRehash(bcryptHash);

      // Then
      expect(result).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should propagate crypto provider errors on hash', async () => {
      // Given
      const password = 'securePassword123!';
      const cryptoError = new Error('Crypto operation failed');
      mockCryptoProvider.argon2Hash.mockRejectedValue(cryptoError);

      // When/Then
      await expect(passwordHasher.hash(password)).rejects.toThrow('Crypto operation failed');
    });

    it('should propagate crypto provider errors on verify', async () => {
      // Given
      const password = 'securePassword123!';
      const hash = '$argon2id$v=19$m=65536,t=3,p=4$salt$hash';
      const cryptoError = new Error('Verification failed');
      mockCryptoProvider.argon2Verify.mockRejectedValue(cryptoError);

      // When/Then
      await expect(passwordHasher.verify(password, hash)).rejects.toThrow(
        'Verification failed'
      );
    });
  });

  describe('interaction verification', () => {
    it('should not call argon2Hash if salt generation fails', async () => {
      // Given
      const password = 'securePassword123!';
      mockCryptoProvider.generateSalt.mockRejectedValue(new Error('Salt generation failed'));

      // When
      try {
        await passwordHasher.hash(password);
      } catch {
        // Expected to fail
      }

      // Then
      expect(mockCryptoProvider.argon2Hash).not.toHaveBeenCalled();
    });

    it('should only call crypto provider once per operation', async () => {
      // Given
      const password = 'securePassword123!';

      // When
      await passwordHasher.hash(password);

      // Then
      expect(mockCryptoProvider.generateSalt).toHaveBeenCalledTimes(1);
      expect(mockCryptoProvider.argon2Hash).toHaveBeenCalledTimes(1);
    });
  });
});
