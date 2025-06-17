const request = require('supertest');
const app = require('../../server');
const User = require('../../src/models/User');
const Token = require('../../src/models/token.model');
const authService = require('../../src/services/auth.service');

describe('Auth Endpoints', () => {
  let server;

  beforeAll(() => {
    server = app;
  });

  beforeEach(async () => {
    // Clear users and tokens before each test
    await User.deleteMany({});
    await Token.deleteMany({});
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Password123!',
        name: 'Test User',
      };

      const response = await request(server)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
      expect(response.body.user).toMatchObject({
        email: userData.email,
        name: userData.name,
        role: 'user',
      });
      expect(response.body.user.password).toBeUndefined();

      // Verify user was created in database
      const user = await User.findOne({ email: userData.email });
      expect(user).toBeTruthy();
      expect(user.isEmailVerified).toBe(false);
    });

    it('should not register user with existing email', async () => {
      // Create existing user
      await User.create({
        email: 'existing@example.com',
        password: 'Password123!',
        name: 'Existing User',
      });

      const response = await request(server)
        .post('/api/auth/register')
        .send({
          email: 'existing@example.com',
          password: 'Password123!',
          name: 'New User',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('already exists');
    });

    it('should validate required fields', async () => {
      const response = await request(server)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          // missing password and name
        })
        .expect(400);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({ field: 'password' })
      );
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({ field: 'name' })
      );
    });

    it('should validate email format', async () => {
      const response = await request(server)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'Password123!',
          name: 'Test User',
        })
        .expect(400);

      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          field: 'email',
          message: expect.stringContaining('valid email'),
        })
      );
    });

    it('should validate password strength', async () => {
      const response = await request(server)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: '123', // too short
          name: 'Test User',
        })
        .expect(400);

      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          field: 'password',
          message: expect.stringContaining('at least 6 characters'),
        })
      );
    });
  });

  describe('POST /api/auth/login', () => {
    let testUser;

    beforeEach(async () => {
      // Create a test user
      testUser = await User.create({
        email: 'test@example.com',
        password: 'Password123!',
        name: 'Test User',
        isEmailVerified: true,
      });
    });

    it('should login with valid credentials', async () => {
      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
      expect(response.body.user).toMatchObject({
        email: testUser.email,
        name: testUser.name,
      });
    });

    it('should not login with invalid password', async () => {
      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword!',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid credentials');
    });

    it('should not login with non-existent email', async () => {
      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'Password123!',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid credentials');
    });

    it('should not login inactive user', async () => {
      // Deactivate user
      testUser.isActive = false;
      await testUser.save();

      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('deactivated');
    });

    it('should track login attempts', async () => {
      // Make multiple failed attempts
      for (let i = 0; i < 3; i++) {
        await request(server)
          .post('/api/auth/login')
          .send({
            email: 'test@example.com',
            password: 'WrongPassword!',
          });
      }

      const user = await User.findById(testUser._id);
      expect(user.loginAttempts).toBe(3);
    });
  });

  describe('GET /api/auth/me', () => {
    let authToken;
    let testUser;

    beforeEach(async () => {
      // Create and login a test user
      testUser = await User.create({
        email: 'test@example.com',
        password: 'Password123!',
        name: 'Test User',
        isEmailVerified: true,
      });

      authToken = authService.generateAccessToken(testUser);
    });

    it('should get current user with valid token', async () => {
      const response = await request(server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toMatchObject({
        email: testUser.email,
        name: testUser.name,
      });
    });

    it('should not get user without token', async () => {
      const response = await request(server)
        .get('/api/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Authentication required');
    });

    it('should not get user with invalid token', async () => {
      const response = await request(server)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/logout', () => {
    let authToken;
    let testUser;

    beforeEach(async () => {
      testUser = await User.create({
        email: 'test@example.com',
        password: 'Password123!',
        name: 'Test User',
      });

      authToken = authService.generateAccessToken(testUser);
    });

    it('should logout successfully', async () => {
      const response = await request(server)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Logged out successfully');
    });

    it('should require authentication for logout', async () => {
      await request(server)
        .post('/api/auth/logout')
        .expect(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    let testUser;
    let refreshToken;

    beforeEach(async () => {
      testUser = await User.create({
        email: 'test@example.com',
        password: 'Password123!',
        name: 'Test User',
      });

      refreshToken = await authService.generateRefreshToken(testUser._id);
    });

    it('should refresh access token', async () => {
      const response = await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
    });

    it('should not refresh with invalid token', async () => {
      const response = await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-refresh-token' })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid');
    });

    it('should not refresh with used token', async () => {
      // Mark token as used
      await Token.updateOne(
        { token: refreshToken },
        { used: true, usedAt: new Date() }
      );

      const response = await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    let testUser;

    beforeEach(async () => {
      testUser = await User.create({
        email: 'test@example.com',
        password: 'Password123!',
        name: 'Test User',
      });
    });

    it('should initiate password reset', async () => {
      const response = await request(server)
        .post('/api/auth/forgot-password')
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('email sent');

      // Verify reset token was created
      const token = await Token.findOne({
        user: testUser._id,
        type: 'passwordReset',
      });
      expect(token).toBeTruthy();
    });

    it('should handle non-existent email gracefully', async () => {
      const response = await request(server)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' })
        .expect(200); // Return 200 to prevent email enumeration

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('email sent');
    });
  });

  describe('POST /api/auth/reset-password', () => {
    let testUser;
    let resetToken;

    beforeEach(async () => {
      testUser = await User.create({
        email: 'test@example.com',
        password: 'OldPassword123!',
        name: 'Test User',
      });

      // Create reset token
      const tokenDoc = await Token.create({
        user: testUser._id,
        token: authService.generateSecureToken(),
        type: 'passwordReset',
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
      });
      resetToken = tokenDoc.token;
    });

    it('should reset password with valid token', async () => {
      const newPassword = 'NewPassword123!';

      const response = await request(server)
        .post('/api/auth/reset-password')
        .send({
          token: resetToken,
          password: newPassword,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Password reset successful');

      // Verify can login with new password
      const loginResponse = await request(server)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: newPassword,
        })
        .expect(200);

      expect(loginResponse.body.success).toBe(true);
    });

    it('should not reset with invalid token', async () => {
      const response = await request(server)
        .post('/api/auth/reset-password')
        .send({
          token: 'invalid-token',
          password: 'NewPassword123!',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid');
    });

    it('should not reset with expired token', async () => {
      // Expire the token
      await Token.updateOne(
        { token: resetToken },
        { expiresAt: new Date(Date.now() - 1000) }
      );

      const response = await request(server)
        .post('/api/auth/reset-password')
        .send({
          token: resetToken,
          password: 'NewPassword123!',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('expired');
    });
  });

  describe('GET /api/auth/verify-email/:token', () => {
    let testUser;
    let verificationToken;

    beforeEach(async () => {
      testUser = await User.create({
        email: 'test@example.com',
        password: 'Password123!',
        name: 'Test User',
        isEmailVerified: false,
      });

      // Create verification token
      const tokenDoc = await Token.create({
        user: testUser._id,
        token: authService.generateSecureToken(),
        type: 'emailVerification',
        expiresAt: new Date(Date.now() + 86400000), // 24 hours
      });
      verificationToken = tokenDoc.token;
    });

    it('should verify email with valid token', async () => {
      const response = await request(server)
        .get(`/api/auth/verify-email/${verificationToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('verified successfully');

      // Verify user email is verified
      const user = await User.findById(testUser._id);
      expect(user.isEmailVerified).toBe(true);
    });

    it('should not verify with invalid token', async () => {
      const response = await request(server)
        .get('/api/auth/verify-email/invalid-token')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid');
    });
  });

  describe('POST /api/auth/check-password', () => {
    it('should check password strength', async () => {
      const response = await request(server)
        .post('/api/auth/check-password')
        .send({ password: 'MyStr0ng!Pass' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.strength).toMatchObject({
        isValid: true,
        level: 'strong',
        score: 5,
      });
    });

    it('should identify weak passwords', async () => {
      const response = await request(server)
        .post('/api/auth/check-password')
        .send({ password: 'weak' })
        .expect(200);

      expect(response.body.data.strength).toMatchObject({
        isValid: false,
        level: 'weak',
      });
      expect(response.body.data.strength.feedback.length).toBeGreaterThan(0);
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit auth endpoints', async () => {
      // Make multiple requests quickly
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(server)
            .post('/api/auth/login')
            .send({
              email: `test${i}@example.com`,
              password: 'Password123!',
            })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.some(res => res.status === 429);

      expect(rateLimited).toBe(true);
    }, 10000); // Increase timeout for rate limit test
  });
});