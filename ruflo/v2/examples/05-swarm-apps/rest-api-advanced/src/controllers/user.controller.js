const User = require('../models/User');
const Token = require('../models/token.model');
const authService = require('../services/auth.service');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

const userController = {
  /**
   * @desc    Get all users (with pagination, filtering, and search)
   * @route   GET /api/users
   * @access  Private/Admin
   */
  getAllUsers: asyncHandler(async (req, res, next) => {
    const {
      page = 1,
      limit = 20,
      sort = '-createdAt',
      role,
      isActive,
      isEmailVerified,
      search,
    } = req.query;

    // Build query
    const query = {};
    
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive;
    if (isEmailVerified !== undefined) query.isEmailVerified = isEmailVerified;
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    // Execute query with pagination
    const startIndex = (page - 1) * limit;
    const total = await User.countDocuments(query);
    
    const users = await User.find(query)
      .sort(sort)
      .limit(limit)
      .skip(startIndex)
      .select('-refreshTokens');

    // Pagination result
    const pagination = {
      current: parseInt(page),
      pageSize: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    };

    // Add next and previous page info
    if (startIndex + limit < total) {
      pagination.next = {
        page: page + 1,
        limit,
      };
    }

    if (startIndex > 0) {
      pagination.prev = {
        page: page - 1,
        limit,
      };
    }

    res.status(200).json({
      success: true,
      count: users.length,
      pagination,
      data: users,
    });
  }),

  /**
   * @desc    Get single user by ID
   * @route   GET /api/users/:id
   * @access  Private/Admin or User (own profile)
   */
  getUserById: asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    // Check if user is accessing their own profile or is admin
    if (req.user.role !== 'admin' && req.user._id.toString() !== id) {
      throw new ApiError('Not authorized to access this resource', 403);
    }

    const user = await User.findById(id).select('-refreshTokens');

    if (!user) {
      throw new ApiError('User not found', 404);
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  }),

  /**
   * @desc    Update user profile
   * @route   PUT /api/users/:id
   * @access  Private/Admin or User (own profile)
   */
  updateUser: asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const { name, phone, address, avatar } = req.body;

    // Check if user is updating their own profile or is admin
    if (req.user.role !== 'admin' && req.user._id.toString() !== id) {
      throw new ApiError('Not authorized to update this resource', 403);
    }

    // Fields that can be updated
    const updateFields = {
      name,
      phone,
      address,
      avatar,
    };

    // Remove undefined fields
    Object.keys(updateFields).forEach(key => {
      if (updateFields[key] === undefined) {
        delete updateFields[key];
      }
    });

    // Admin-only fields
    if (req.user.role === 'admin' && req.body.role) {
      updateFields.role = req.body.role;
    }

    if (req.user.role === 'admin' && req.body.isActive !== undefined) {
      updateFields.isActive = req.body.isActive;
    }

    const user = await User.findByIdAndUpdate(
      id,
      updateFields,
      {
        new: true,
        runValidators: true,
      }
    ).select('-refreshTokens');

    if (!user) {
      throw new ApiError('User not found', 404);
    }

    logger.info(`User profile updated: ${user.email}`);

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: user,
    });
  }),

  /**
   * @desc    Delete user
   * @route   DELETE /api/users/:id
   * @access  Private/Admin or User (own account)
   */
  deleteUser: asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    // Check if user is deleting their own account or is admin
    if (req.user.role !== 'admin' && req.user._id.toString() !== id) {
      throw new ApiError('Not authorized to delete this resource', 403);
    }

    const user = await User.findById(id);

    if (!user) {
      throw new ApiError('User not found', 404);
    }

    // Soft delete or hard delete based on configuration
    if (process.env.SOFT_DELETE === 'true') {
      user.isActive = false;
      user.deletedAt = new Date();
      await user.save();
    } else {
      // Remove all user tokens
      await Token.removeUserTokens(user._id);
      
      // Delete user
      await user.deleteOne();
    }

    // Blacklist current token if user is deleting their own account
    if (req.user._id.toString() === id) {
      await authService.blacklistToken(req.token);
    }

    logger.info(`User account deleted: ${user.email}`);

    res.status(200).json({
      success: true,
      message: 'User deleted successfully',
    });
  }),

  /**
   * @desc    Change user password
   * @route   PUT /api/users/change-password
   * @access  Private
   */
  changePassword: asyncHandler(async (req, res, next) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    // Get user with password field
    const user = await User.findById(userId).select('+password');

    // Check current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      throw new ApiError('Current password is incorrect', 401);
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Generate new tokens (logout from other devices)
    const accessToken = authService.generateAccessToken(user);
    const deviceInfo = authService.extractDeviceInfo(req);
    const refreshToken = await authService.generateRefreshToken(user._id, deviceInfo);

    // Remove all other refresh tokens
    await Token.deleteMany({
      user: userId,
      type: 'refresh',
      token: { $ne: refreshToken },
    });

    logger.info(`Password changed for: ${user.email}`);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      data: {
        accessToken,
        refreshToken,
      },
    });
  }),

  /**
   * @desc    Update user email
   * @route   PUT /api/users/change-email
   * @access  Private
   */
  changeEmail: asyncHandler(async (req, res, next) => {
    const { newEmail, password } = req.body;
    const userId = req.user._id;

    // Check if new email already exists
    const existingUser = await User.findOne({ email: newEmail });
    if (existingUser) {
      throw new ApiError('Email already in use', 400);
    }

    // Get user with password field
    const user = await User.findById(userId).select('+password');

    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new ApiError('Password is incorrect', 401);
    }

    // Update email
    user.email = newEmail;
    user.isEmailVerified = false;
    await user.save();

    // Send verification email to new address
    if (process.env.ENABLE_EMAIL_VERIFICATION === 'true') {
      const verificationToken = await Token.createEmailVerificationToken(user._id);
      await authService.sendVerificationEmail(user, verificationToken.token);
    }

    logger.info(`Email changed from ${req.user.email} to ${newEmail}`);

    res.status(200).json({
      success: true,
      message: 'Email updated successfully. Please verify your new email address.',
      data: {
        email: newEmail,
      },
    });
  }),

  /**
   * @desc    Get user statistics (Admin only)
   * @route   GET /api/users/stats
   * @access  Private/Admin
   */
  getUserStats: asyncHandler(async (req, res, next) => {
    const stats = await User.aggregate([
      {
        $facet: {
          totalUsers: [{ $count: 'count' }],
          activeUsers: [
            { $match: { isActive: true } },
            { $count: 'count' },
          ],
          verifiedUsers: [
            { $match: { isEmailVerified: true } },
            { $count: 'count' },
          ],
          usersByRole: [
            { $group: { _id: '$role', count: { $sum: 1 } } },
          ],
          recentSignups: [
            {
              $match: {
                createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              },
            },
            { $count: 'count' },
          ],
          userGrowth: [
            {
              $group: {
                _id: {
                  year: { $year: '$createdAt' },
                  month: { $month: '$createdAt' },
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } },
            { $limit: 12 },
          ],
        },
      },
    ]);

    // Format the statistics
    const formattedStats = {
      totalUsers: stats[0].totalUsers[0]?.count || 0,
      activeUsers: stats[0].activeUsers[0]?.count || 0,
      verifiedUsers: stats[0].verifiedUsers[0]?.count || 0,
      recentSignups: stats[0].recentSignups[0]?.count || 0,
      usersByRole: stats[0].usersByRole.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      userGrowth: stats[0].userGrowth.map(item => ({
        month: `${item._id.year}-${String(item._id.month).padStart(2, '0')}`,
        count: item.count,
      })),
    };

    res.status(200).json({
      success: true,
      data: formattedStats,
    });
  }),

  /**
   * @desc    Get user activity logs
   * @route   GET /api/users/:id/activity
   * @access  Private/Admin or User (own activity)
   */
  getUserActivity: asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Check authorization
    if (req.user.role !== 'admin' && req.user._id.toString() !== id) {
      throw new ApiError('Not authorized to access this resource', 403);
    }

    // This is a placeholder - in a real application, you would have an Activity or Log model
    // For now, we'll return login history from refresh tokens
    const tokens = await Token.find({
      user: id,
      type: 'refresh',
    })
      .sort('-createdAt')
      .limit(limit)
      .skip((page - 1) * limit)
      .select('createdAt deviceInfo used usedAt');

    const activities = tokens.map(token => ({
      type: 'login',
      timestamp: token.createdAt,
      device: token.deviceInfo,
      status: token.used ? 'expired' : 'active',
    }));

    res.status(200).json({
      success: true,
      count: activities.length,
      data: activities,
    });
  }),
};

module.exports = userController;