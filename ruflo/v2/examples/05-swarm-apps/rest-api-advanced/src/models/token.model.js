const mongoose = require('mongoose');
const crypto = require('crypto');

const tokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    index: true,
    unique: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    enum: ['refresh', 'passwordReset', 'emailVerification'],
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
  used: {
    type: Boolean,
    default: false,
  },
  usedAt: {
    type: Date,
  },
  deviceInfo: {
    userAgent: String,
    ip: String,
    device: String,
    browser: String,
    os: String,
  },
}, {
  timestamps: true,
});

// Indexes for performance
tokenSchema.index({ user: 1, type: 1 });
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Generate random token
tokenSchema.statics.generateToken = function() {
  return crypto.randomBytes(32).toString('hex');
};

// Create refresh token
tokenSchema.statics.createRefreshToken = async function(userId, deviceInfo = {}) {
  const token = this.generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  return await this.create({
    token,
    user: userId,
    type: 'refresh',
    expiresAt,
    deviceInfo,
  });
};

// Create password reset token
tokenSchema.statics.createPasswordResetToken = async function(userId) {
  const token = this.generateToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  return await this.create({
    token,
    user: userId,
    type: 'passwordReset',
    expiresAt,
  });
};

// Create email verification token
tokenSchema.statics.createEmailVerificationToken = async function(userId) {
  const token = this.generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  return await this.create({
    token,
    user: userId,
    type: 'emailVerification',
    expiresAt,
  });
};

// Verify and use token
tokenSchema.statics.verifyToken = async function(token, type) {
  const tokenDoc = await this.findOne({
    token,
    type,
    used: false,
    expiresAt: { $gt: new Date() },
  }).populate('user');

  if (!tokenDoc) {
    return null;
  }

  // Mark token as used
  tokenDoc.used = true;
  tokenDoc.usedAt = new Date();
  await tokenDoc.save();

  return tokenDoc;
};

// Clean up expired tokens
tokenSchema.statics.cleanupExpiredTokens = async function() {
  return await this.deleteMany({
    expiresAt: { $lt: new Date() },
  });
};

// Remove all tokens for a user
tokenSchema.statics.removeUserTokens = async function(userId, type = null) {
  const query = { user: userId };
  if (type) {
    query.type = type;
  }
  return await this.deleteMany(query);
};

const Token = mongoose.model('Token', tokenSchema);

module.exports = Token;