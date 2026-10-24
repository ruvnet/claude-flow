const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Token = require('../models/token.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { getRedisClient } = require('../config/redis');

/**
 * Protect routes - Verify JWT token
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  
  // Check for token in cookies
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    throw new ApiError('Not authorized to access this route', 401);
  }

  try {
    // Check if token is blacklisted (in Redis)
    const redis = getRedisClient();
    if (redis) {
      const isBlacklisted = await redis.get(`blacklist_${token}`);
      if (isBlacklisted) {
        throw new ApiError('Token has been invalidated', 401);
      }
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user still exists
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      throw new ApiError('User no longer exists', 401);
    }

    if (!user.isActive) {
      throw new ApiError('Account has been deactivated', 401);
    }

    // Grant access to protected route
    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      throw new ApiError('Invalid token', 401);
    }
    if (error.name === 'TokenExpiredError') {
      throw new ApiError('Token expired', 401);
    }
    throw error;
  }
});

/**
 * Grant access to specific roles
 * @param  {...string} roles - Allowed roles
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      throw new ApiError(`User role '${req.user.role}' is not authorized to access this route`, 403);
    }
    next();
  };
};

/**
 * Optional authentication - Attach user if token exists but don't require it
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      
      if (user && user.isActive) {
        req.user = user;
      }
    } catch (error) {
      // Ignore errors for optional auth
    }
  }

  next();
});

/**
 * Verify email confirmation token
 */
const verifyEmailToken = asyncHandler(async (req, res, next) => {
  const { token } = req.params;

  if (!token) {
    throw new ApiError('Email verification token is required', 400);
  }

  const user = await User.findOne({
    emailVerificationToken: token,
    emailVerificationExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw new ApiError('Invalid or expired email verification token', 400);
  }

  req.user = user;
  next();
});

/**
 * Verify password reset token
 */
const verifyResetToken = asyncHandler(async (req, res, next) => {
  const { token } = req.body;

  if (!token) {
    throw new ApiError('Password reset token is required', 400);
  }

  const user = await User.findOne({
    passwordResetToken: token,
    passwordResetExpires: { $gt: Date.now() },
  }).select('+password');

  if (!user) {
    throw new ApiError('Invalid or expired password reset token', 400);
  }

  req.user = user;
  next();
});

module.exports = {
  protect,
  authorize,
  optionalAuth,
  verifyEmailToken,
  verifyResetToken,
};