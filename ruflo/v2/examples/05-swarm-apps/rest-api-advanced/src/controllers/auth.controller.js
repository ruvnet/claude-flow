const User = require('../models/User');
const Token = require('../models/token.model');
const authService = require('../services/auth.service');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

const authController = {
  /**
   * @desc    Register new user
   * @route   POST /api/auth/register
   * @access  Public
   */
  register: asyncHandler(async (req, res, next) => {
    const { email, password, name, phone, address } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new ApiError('User already exists with this email', 400);
    }

    // Create user
    const user = await User.create({
      email,
      password,
      name,
      phone,
      address,
    });

    // Generate tokens
    const accessToken = authService.generateAccessToken(user);
    const deviceInfo = authService.extractDeviceInfo(req);
    const refreshToken = await authService.generateRefreshToken(user._id, deviceInfo);

    // Generate email verification token
    if (process.env.ENABLE_EMAIL_VERIFICATION === 'true') {
      const verificationToken = await Token.createEmailVerificationToken(user._id);
      await authService.sendVerificationEmail(user, verificationToken.token);
    }

    // Set cookie options
    const cookieOptions = {
      expires: new Date(Date.now() + parseInt(process.env.JWT_COOKIE_EXPIRE) * 24 * 60 * 60 * 1000),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    };

    res.status(201)
      .cookie('token', accessToken, cookieOptions)
      .json({
        success: true,
        message: 'Registration successful. Please check your email to verify your account.',
        data: {
          user,
          accessToken,
          refreshToken,
        },
      });
  }),

  /**
   * @desc    Login user
   * @route   POST /api/auth/login
   * @access  Public
   */
  login: asyncHandler(async (req, res, next) => {
    const { email, password, rememberMe } = req.body;

    // Find user by credentials
    const user = await User.findByCredentials(email, password);

    // Check if email is verified (if verification is enabled)
    if (process.env.ENABLE_EMAIL_VERIFICATION === 'true' && !user.isEmailVerified) {
      throw new ApiError('Please verify your email before logging in', 401);
    }

    // Generate tokens
    const accessToken = authService.generateAccessToken(user);
    const deviceInfo = authService.extractDeviceInfo(req);
    const refreshToken = await authService.generateRefreshToken(user._id, deviceInfo);

    // Set cookie options
    const cookieExpiry = rememberMe ? 30 : parseInt(process.env.JWT_COOKIE_EXPIRE) || 7;
    const cookieOptions = {
      expires: new Date(Date.now() + cookieExpiry * 24 * 60 * 60 * 1000),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    };

    logger.info(`User logged in: ${user.email}`);

    res.status(200)
      .cookie('token', accessToken, cookieOptions)
      .json({
        success: true,
        message: 'Login successful',
        data: {
          user,
          accessToken,
          refreshToken,
        },
      });
  }),

  /**
   * @desc    Logout user
   * @route   POST /api/auth/logout
   * @access  Private
   */
  logout: asyncHandler(async (req, res, next) => {
    const { token } = req;

    // Blacklist the current token
    await authService.blacklistToken(token);

    // Remove refresh tokens for this device
    if (req.body.refreshToken) {
      await Token.findOneAndDelete({
        token: req.body.refreshToken,
        user: req.user._id,
        type: 'refresh',
      });
    }

    // Clear cookie
    res.cookie('token', 'none', {
      expires: new Date(Date.now() + 10 * 1000),
      httpOnly: true,
    });

    logger.info(`User logged out: ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  }),

  /**
   * @desc    Refresh access token
   * @route   POST /api/auth/refresh
   * @access  Public
   */
  refreshToken: asyncHandler(async (req, res, next) => {
    const { refreshToken } = req.body;

    const result = await authService.refreshAccessToken(refreshToken);

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
    });
  }),

  /**
   * @desc    Forgot password
   * @route   POST /api/auth/forgot-password
   * @access  Public
   */
  forgotPassword: asyncHandler(async (req, res, next) => {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if user exists or not
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link.',
      });
    }

    // Generate reset token
    const resetToken = await Token.createPasswordResetToken(user._id);
    
    // Send reset email
    await authService.sendPasswordResetEmail(user, resetToken.token);

    logger.info(`Password reset requested for: ${email}`);

    res.status(200).json({
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.',
    });
  }),

  /**
   * @desc    Reset password
   * @route   POST /api/auth/reset-password
   * @access  Public
   */
  resetPassword: asyncHandler(async (req, res, next) => {
    const { token, password } = req.body;

    // Verify token
    const tokenDoc = await Token.verifyToken(token, 'passwordReset');
    if (!tokenDoc) {
      throw new ApiError('Invalid or expired password reset token', 400);
    }

    const user = tokenDoc.user;

    // Update password
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    // Generate new tokens for auto-login
    const accessToken = authService.generateAccessToken(user);
    const deviceInfo = authService.extractDeviceInfo(req);
    const refreshToken = await authService.generateRefreshToken(user._id, deviceInfo);

    logger.info(`Password reset successful for: ${user.email}`);

    res.status(200).json({
      success: true,
      message: 'Password reset successful',
      data: {
        user,
        accessToken,
        refreshToken,
      },
    });
  }),

  /**
   * @desc    Verify email
   * @route   GET /api/auth/verify-email/:token
   * @access  Public
   */
  verifyEmail: asyncHandler(async (req, res, next) => {
    const { token } = req.params;

    // Verify token
    const tokenDoc = await Token.verifyToken(token, 'emailVerification');
    if (!tokenDoc) {
      throw new ApiError('Invalid or expired verification token', 400);
    }

    const user = tokenDoc.user;

    // Update user
    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    logger.info(`Email verified for: ${user.email}`);

    res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      data: {
        user,
      },
    });
  }),

  /**
   * @desc    Resend verification email
   * @route   POST /api/auth/resend-verification
   * @access  Private
   */
  resendVerification: asyncHandler(async (req, res, next) => {
    const user = req.user;

    if (user.isEmailVerified) {
      throw new ApiError('Email is already verified', 400);
    }

    // Check for existing unexpired token
    const existingToken = await Token.findOne({
      user: user._id,
      type: 'emailVerification',
      used: false,
      expiresAt: { $gt: new Date() },
    });

    if (existingToken) {
      // Resend email with existing token
      await authService.sendVerificationEmail(user, existingToken.token);
    } else {
      // Generate new token
      const verificationToken = await Token.createEmailVerificationToken(user._id);
      await authService.sendVerificationEmail(user, verificationToken.token);
    }

    res.status(200).json({
      success: true,
      message: 'Verification email sent',
    });
  }),

  /**
   * @desc    Get current user
   * @route   GET /api/auth/me
   * @access  Private
   */
  getMe: asyncHandler(async (req, res, next) => {
    res.status(200).json({
      success: true,
      data: {
        user: req.user,
      },
    });
  }),

  /**
   * @desc    Check password strength
   * @route   POST /api/auth/check-password
   * @access  Public
   */
  checkPasswordStrength: asyncHandler(async (req, res, next) => {
    const { password } = req.body;

    if (!password) {
      throw new ApiError('Password is required', 400);
    }

    const strength = authService.validatePasswordStrength(password);

    res.status(200).json({
      success: true,
      data: strength,
    });
  }),
};

module.exports = authController;