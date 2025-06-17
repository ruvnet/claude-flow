const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const Token = require('../models/token.model');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { getRedisClient } = require('../config/redis');

class AuthService {
  /**
   * Generate JWT access token
   * @param {Object} user - User object
   * @returns {string} JWT token
   */
  generateAccessToken(user) {
    return jwt.sign(
      {
        id: user._id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRE || '7d',
      }
    );
  }

  /**
   * Generate refresh token
   * @param {string} userId - User ID
   * @param {Object} deviceInfo - Device information
   * @returns {Promise<string>} Refresh token
   */
  async generateRefreshToken(userId, deviceInfo = {}) {
    const tokenDoc = await Token.createRefreshToken(userId, deviceInfo);
    return tokenDoc.token;
  }

  /**
   * Verify refresh token and generate new access token
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<Object>} New tokens
   */
  async refreshAccessToken(refreshToken) {
    const tokenDoc = await Token.findOne({
      token: refreshToken,
      type: 'refresh',
      used: false,
      expiresAt: { $gt: new Date() },
    }).populate('user');

    if (!tokenDoc) {
      throw new ApiError('Invalid or expired refresh token', 401);
    }

    const user = tokenDoc.user;
    if (!user.isActive) {
      throw new ApiError('Account has been deactivated', 401);
    }

    // Generate new access token
    const accessToken = this.generateAccessToken(user);

    // Optionally rotate refresh token
    const shouldRotate = process.env.ROTATE_REFRESH_TOKENS === 'true';
    let newRefreshToken = refreshToken;

    if (shouldRotate) {
      // Mark old token as used
      tokenDoc.used = true;
      tokenDoc.usedAt = new Date();
      await tokenDoc.save();

      // Generate new refresh token
      newRefreshToken = await this.generateRefreshToken(user._id, tokenDoc.deviceInfo);
    }

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user,
    };
  }

  /**
   * Blacklist token (logout)
   * @param {string} token - JWT token to blacklist
   * @param {number} ttl - Time to live in seconds
   */
  async blacklistToken(token, ttl = null) {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis not available for token blacklisting');
      return;
    }

    try {
      let expiry = ttl;
      if (!expiry) {
        // Get token expiry time
        const decoded = jwt.decode(token);
        if (decoded && decoded.exp) {
          expiry = decoded.exp - Math.floor(Date.now() / 1000);
        } else {
          expiry = 7 * 24 * 60 * 60; // Default 7 days
        }
      }

      await redis.setex(`blacklist_${token}`, expiry, '1');
      logger.info('Token blacklisted successfully');
    } catch (error) {
      logger.error('Error blacklisting token:', error);
    }
  }

  /**
   * Send verification email (mock implementation)
   * @param {Object} user - User object
   * @param {string} token - Verification token
   */
  async sendVerificationEmail(user, token) {
    const verificationUrl = `${process.env.API_URL}/api/auth/verify-email/${token}`;
    
    // Mock email sending - in production, integrate with email service
    logger.info(`Sending verification email to ${user.email}`);
    logger.info(`Verification URL: ${verificationUrl}`);

    // In production, you would use services like:
    // - SendGrid
    // - AWS SES
    // - Mailgun
    // - Nodemailer with SMTP

    return {
      to: user.email,
      subject: 'Verify Your Email',
      body: `
        <h1>Welcome ${user.name}!</h1>
        <p>Please verify your email by clicking the link below:</p>
        <a href="${verificationUrl}">Verify Email</a>
        <p>This link will expire in 24 hours.</p>
        <p>If you didn't create this account, please ignore this email.</p>
      `,
    };
  }

  /**
   * Send password reset email (mock implementation)
   * @param {Object} user - User object
   * @param {string} token - Reset token
   */
  async sendPasswordResetEmail(user, token) {
    const resetUrl = `${process.env.API_URL}/reset-password?token=${token}`;
    
    // Mock email sending
    logger.info(`Sending password reset email to ${user.email}`);
    logger.info(`Reset URL: ${resetUrl}`);

    return {
      to: user.email,
      subject: 'Password Reset Request',
      body: `
        <h1>Password Reset Request</h1>
        <p>Hi ${user.name},</p>
        <p>You requested to reset your password. Click the link below to proceed:</p>
        <a href="${resetUrl}">Reset Password</a>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email and your password will remain unchanged.</p>
      `,
    };
  }

  /**
   * Validate password strength
   * @param {string} password - Password to validate
   * @returns {Object} Validation result
   */
  validatePasswordStrength(password) {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    const strength = {
      isValid: true,
      score: 0,
      feedback: [],
    };

    if (password.length < minLength) {
      strength.isValid = false;
      strength.feedback.push(`Password must be at least ${minLength} characters long`);
    } else {
      strength.score += 1;
    }

    if (!hasUpperCase) {
      strength.feedback.push('Password should contain at least one uppercase letter');
    } else {
      strength.score += 1;
    }

    if (!hasLowerCase) {
      strength.feedback.push('Password should contain at least one lowercase letter');
    } else {
      strength.score += 1;
    }

    if (!hasNumbers) {
      strength.feedback.push('Password should contain at least one number');
    } else {
      strength.score += 1;
    }

    if (!hasSpecialChar) {
      strength.feedback.push('Password should contain at least one special character');
    } else {
      strength.score += 1;
    }

    // Calculate strength level
    if (strength.score <= 2) {
      strength.level = 'weak';
    } else if (strength.score <= 3) {
      strength.level = 'medium';
    } else {
      strength.level = 'strong';
    }

    return strength;
  }

  /**
   * Extract device info from request
   * @param {Object} req - Express request object
   * @returns {Object} Device information
   */
  extractDeviceInfo(req) {
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || req.connection.remoteAddress;

    // Simple device detection - in production use a library like 'useragent'
    const deviceInfo = {
      userAgent,
      ip,
      device: 'unknown',
      browser: 'unknown',
      os: 'unknown',
    };

    // Basic detection
    if (userAgent.includes('Mobile')) {
      deviceInfo.device = 'mobile';
    } else if (userAgent.includes('Tablet')) {
      deviceInfo.device = 'tablet';
    } else {
      deviceInfo.device = 'desktop';
    }

    if (userAgent.includes('Chrome')) {
      deviceInfo.browser = 'Chrome';
    } else if (userAgent.includes('Firefox')) {
      deviceInfo.browser = 'Firefox';
    } else if (userAgent.includes('Safari')) {
      deviceInfo.browser = 'Safari';
    }

    if (userAgent.includes('Windows')) {
      deviceInfo.os = 'Windows';
    } else if (userAgent.includes('Mac')) {
      deviceInfo.os = 'macOS';
    } else if (userAgent.includes('Linux')) {
      deviceInfo.os = 'Linux';
    } else if (userAgent.includes('Android')) {
      deviceInfo.os = 'Android';
    } else if (userAgent.includes('iOS')) {
      deviceInfo.os = 'iOS';
    }

    return deviceInfo;
  }

  /**
   * Generate secure random token
   * @param {number} length - Token length in bytes
   * @returns {string} Random token
   */
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Hash token for storage
   * @param {string} token - Token to hash
   * @returns {string} Hashed token
   */
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}

module.exports = new AuthService();