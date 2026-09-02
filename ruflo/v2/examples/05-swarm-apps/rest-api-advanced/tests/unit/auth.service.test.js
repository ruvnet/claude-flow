const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const authService = require('../../src/services/auth.service');
const User = require('../../src/models/User');
const Token = require('../../src/models/token.model');
const ApiError = require('../../src/utils/ApiError');
const { getRedisClient } = require('../../src/config/redis');

// Mock dependencies
jest.mock('jsonwebtoken');
jest.mock('../../src/models/User');
jest.mock('../../src/models/token.model');
jest.mock('../../src/config/redis');
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set default environment variables
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_EXPIRE = '7d';
    process.env.API_URL = 'http://localhost:3000';
  });

  describe('generateAccessToken', () => {
    it('should generate a valid JWT token', () => {
      const user = {
        _id: '123456',
        email: 'test@example.com',
        role: 'user',
      };
      const mockToken = 'mock.jwt.token';
      
      jwt.sign.mockReturnValue(mockToken);

      const token = authService.generateAccessToken(user);

      expect(jwt.sign).toHaveBeenCalledWith(
        {
          id: user._id,
          email: user.email,
          role: user.role,
        },
        process.env.JWT_SECRET,
        {
          expiresIn: process.env.JWT_EXPIRE,
        }
      );
      expect(token).toBe(mockToken);
    });

    it('should use default expiry if JWT_EXPIRE is not set', () => {
      delete process.env.JWT_EXPIRE;
      const user = {
        _id: '123456',
        email: 'test@example.com',
        role: 'user',
      };

      authService.generateAccessToken(user);

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        {
          expiresIn: '7d',
        }
      );
    });
  });

  describe('generateRefreshToken', () => {
    it('should create and return a refresh token', async () => {
      const userId = '123456';
      const deviceInfo = { device: 'mobile', browser: 'Chrome' };
      const mockTokenDoc = { token: 'refresh-token-123' };

      Token.createRefreshToken.mockResolvedValue(mockTokenDoc);

      const token = await authService.generateRefreshToken(userId, deviceInfo);

      expect(Token.createRefreshToken).toHaveBeenCalledWith(userId, deviceInfo);
      expect(token).toBe('refresh-token-123');
    });

    it('should work without device info', async () => {
      const userId = '123456';
      const mockTokenDoc = { token: 'refresh-token-123' };

      Token.createRefreshToken.mockResolvedValue(mockTokenDoc);

      const token = await authService.generateRefreshToken(userId);

      expect(Token.createRefreshToken).toHaveBeenCalledWith(userId, {});
      expect(token).toBe('refresh-token-123');
    });
  });

  describe('refreshAccessToken', () => {
    it('should refresh access token with valid refresh token', async () => {
      const refreshToken = 'valid-refresh-token';
      const mockUser = {
        _id: '123456',
        email: 'test@example.com',
        role: 'user',
        isActive: true,
      };
      const mockTokenDoc = {
        token: refreshToken,
        user: mockUser,
        deviceInfo: { device: 'mobile' },
        save: jest.fn(),
      };

      Token.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockTokenDoc),
      });
      jwt.sign.mockReturnValue('new-access-token');

      const result = await authService.refreshAccessToken(refreshToken);

      expect(Token.findOne).toHaveBeenCalledWith({
        token: refreshToken,
        type: 'refresh',
        used: false,
        expiresAt: { $gt: expect.any(Date) },
      });
      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe(refreshToken);
      expect(result.user).toBe(mockUser);
    });

    it('should rotate refresh token when enabled', async () => {
      process.env.ROTATE_REFRESH_TOKENS = 'true';
      const refreshToken = 'old-refresh-token';
      const mockUser = {
        _id: '123456',
        email: 'test@example.com',
        role: 'user',
        isActive: true,
      };
      const mockTokenDoc = {
        token: refreshToken,
        user: mockUser,
        deviceInfo: { device: 'mobile' },
        save: jest.fn(),
      };

      Token.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockTokenDoc),
      });
      Token.createRefreshToken.mockResolvedValue({ token: 'new-refresh-token' });
      jwt.sign.mockReturnValue('new-access-token');

      const result = await authService.refreshAccessToken(refreshToken);

      expect(mockTokenDoc.used).toBe(true);
      expect(mockTokenDoc.usedAt).toBeInstanceOf(Date);
      expect(mockTokenDoc.save).toHaveBeenCalled();
      expect(result.refreshToken).toBe('new-refresh-token');
    });

    it('should throw error for invalid refresh token', async () => {
      const refreshToken = 'invalid-refresh-token';

      Token.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });

      await expect(authService.refreshAccessToken(refreshToken))
        .rejects
        .toThrow(new ApiError('Invalid or expired refresh token', 401));
    });

    it('should throw error for inactive user', async () => {
      const refreshToken = 'valid-refresh-token';
      const mockUser = {
        _id: '123456',
        email: 'test@example.com',
        role: 'user',
        isActive: false,
      };
      const mockTokenDoc = {
        token: refreshToken,
        user: mockUser,
      };

      Token.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockTokenDoc),
      });

      await expect(authService.refreshAccessToken(refreshToken))
        .rejects
        .toThrow(new ApiError('Account has been deactivated', 401));
    });
  });

  describe('blacklistToken', () => {
    it('should blacklist token in Redis', async () => {
      const token = 'jwt-token';
      const mockRedis = {
        setex: jest.fn().mockResolvedValue('OK'),
      };
      getRedisClient.mockReturnValue(mockRedis);
      jwt.decode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 });

      await authService.blacklistToken(token);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `blacklist_${token}`,
        expect.any(Number),
        '1'
      );
    });

    it('should use provided TTL', async () => {
      const token = 'jwt-token';
      const ttl = 1800; // 30 minutes
      const mockRedis = {
        setex: jest.fn().mockResolvedValue('OK'),
      };
      getRedisClient.mockReturnValue(mockRedis);

      await authService.blacklistToken(token, ttl);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `blacklist_${token}`,
        ttl,
        '1'
      );
    });

    it('should handle Redis not available', async () => {
      const token = 'jwt-token';
      getRedisClient.mockReturnValue(null);

      await expect(authService.blacklistToken(token)).resolves.not.toThrow();
    });

    it('should handle Redis errors gracefully', async () => {
      const token = 'jwt-token';
      const mockRedis = {
        setex: jest.fn().mockRejectedValue(new Error('Redis error')),
      };
      getRedisClient.mockReturnValue(mockRedis);

      await expect(authService.blacklistToken(token)).resolves.not.toThrow();
    });
  });

  describe('validatePasswordStrength', () => {
    it('should validate strong password', () => {
      const password = 'MyStr0ng!Pass';
      const result = authService.validatePasswordStrength(password);

      expect(result.isValid).toBe(true);
      expect(result.score).toBe(5);
      expect(result.level).toBe('strong');
      expect(result.feedback).toHaveLength(0);
    });

    it('should validate weak password', () => {
      const password = 'weak';
      const result = authService.validatePasswordStrength(password);

      expect(result.isValid).toBe(false);
      expect(result.level).toBe('weak');
      expect(result.feedback).toContain('Password must be at least 8 characters long');
      expect(result.feedback).toContain('Password should contain at least one uppercase letter');
      expect(result.feedback).toContain('Password should contain at least one number');
      expect(result.feedback).toContain('Password should contain at least one special character');
    });

    it('should validate medium strength password', () => {
      const password = 'password123';
      const result = authService.validatePasswordStrength(password);

      expect(result.isValid).toBe(true);
      expect(result.level).toBe('medium');
      expect(result.feedback).toContain('Password should contain at least one uppercase letter');
      expect(result.feedback).toContain('Password should contain at least one special character');
    });
  });

  describe('extractDeviceInfo', () => {
    it('should extract mobile device info', () => {
      const req = {
        headers: {
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) Mobile/15E148 Safari/604.1',
        },
        ip: '192.168.1.1',
      };

      const deviceInfo = authService.extractDeviceInfo(req);

      expect(deviceInfo.device).toBe('mobile');
      expect(deviceInfo.browser).toBe('Safari');
      expect(deviceInfo.os).toBe('iOS');
      expect(deviceInfo.ip).toBe('192.168.1.1');
    });

    it('should extract desktop device info', () => {
      const req = {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        ip: '192.168.1.2',
      };

      const deviceInfo = authService.extractDeviceInfo(req);

      expect(deviceInfo.device).toBe('desktop');
      expect(deviceInfo.browser).toBe('Chrome');
      expect(deviceInfo.os).toBe('Windows');
    });

    it('should handle missing user agent', () => {
      const req = {
        headers: {},
        ip: '192.168.1.1',
      };

      const deviceInfo = authService.extractDeviceInfo(req);

      expect(deviceInfo.device).toBe('unknown');
      expect(deviceInfo.browser).toBe('unknown');
      expect(deviceInfo.os).toBe('unknown');
    });
  });

  describe('generateSecureToken', () => {
    it('should generate a secure token with default length', () => {
      const mockBuffer = Buffer.from('1234567890abcdef1234567890abcdef', 'hex');
      jest.spyOn(crypto, 'randomBytes').mockReturnValue(mockBuffer);

      const token = authService.generateSecureToken();

      expect(crypto.randomBytes).toHaveBeenCalledWith(32);
      expect(token).toBe(mockBuffer.toString('hex'));
    });

    it('should generate a secure token with custom length', () => {
      const mockBuffer = Buffer.from('1234567890abcdef', 'hex');
      jest.spyOn(crypto, 'randomBytes').mockReturnValue(mockBuffer);

      const token = authService.generateSecureToken(16);

      expect(crypto.randomBytes).toHaveBeenCalledWith(16);
      expect(token).toBe(mockBuffer.toString('hex'));
    });
  });

  describe('hashToken', () => {
    it('should hash a token using SHA256', () => {
      const token = 'my-secret-token';
      const expectedHash = crypto.createHash('sha256').update(token).digest('hex');

      const hash = authService.hashToken(token);

      expect(hash).toBe(expectedHash);
      expect(hash).toHaveLength(64); // SHA256 produces 64 hex characters
    });
  });

  describe('sendVerificationEmail', () => {
    it('should prepare verification email', async () => {
      const user = {
        email: 'test@example.com',
        name: 'Test User',
      };
      const token = 'verification-token';

      const emailData = await authService.sendVerificationEmail(user, token);

      expect(emailData.to).toBe(user.email);
      expect(emailData.subject).toBe('Verify Your Email');
      expect(emailData.body).toContain(user.name);
      expect(emailData.body).toContain(`${process.env.API_URL}/api/auth/verify-email/${token}`);
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('should prepare password reset email', async () => {
      const user = {
        email: 'test@example.com',
        name: 'Test User',
      };
      const token = 'reset-token';

      const emailData = await authService.sendPasswordResetEmail(user, token);

      expect(emailData.to).toBe(user.email);
      expect(emailData.subject).toBe('Password Reset Request');
      expect(emailData.body).toContain(user.name);
      expect(emailData.body).toContain(`${process.env.API_URL}/reset-password?token=${token}`);
    });
  });
});