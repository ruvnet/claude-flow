# Authentication System Documentation

This REST API includes a comprehensive authentication system with JWT tokens, refresh tokens, email verification, and password reset functionality.

## Features

### Authentication Features
- **User Registration** with email verification
- **User Login** with JWT token generation
- **Refresh Token** mechanism for token rotation
- **Logout** with token blacklisting
- **Password Reset** via email
- **Email Verification** system
- **Password Strength** validation
- **Account Lockout** after failed login attempts

### User Management Features
- **Get All Users** (Admin only) with pagination and filtering
- **Get User by ID** with authorization checks
- **Update User Profile** with field validation
- **Delete User** with soft/hard delete options
- **Change Password** with old password verification
- **Change Email** with re-verification
- **User Statistics** (Admin only)
- **Activity Logs** tracking

## API Endpoints

### Authentication Endpoints

#### Register New User
```
POST /api/auth/register
```
Body:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123",
  "confirmPassword": "SecurePass123",
  "name": "John Doe",
  "phone": "+1234567890",
  "address": {
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001",
    "country": "USA"
  }
}
```

#### Login
```
POST /api/auth/login
```
Body:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123",
  "rememberMe": true
}
```

#### Logout
```
POST /api/auth/logout
Authorization: Bearer <token>
```

#### Refresh Token
```
POST /api/auth/refresh
```
Body:
```json
{
  "refreshToken": "<refresh_token>"
}
```

#### Forgot Password
```
POST /api/auth/forgot-password
```
Body:
```json
{
  "email": "user@example.com"
}
```

#### Reset Password
```
POST /api/auth/reset-password
```
Body:
```json
{
  "token": "<reset_token>",
  "password": "NewSecurePass123",
  "confirmPassword": "NewSecurePass123"
}
```

#### Verify Email
```
GET /api/auth/verify-email/:token
```

#### Resend Verification Email
```
POST /api/auth/resend-verification
Authorization: Bearer <token>
```

#### Get Current User
```
GET /api/auth/me
Authorization: Bearer <token>
```

#### Check Password Strength
```
POST /api/auth/check-password
```
Body:
```json
{
  "password": "TestPassword123!"
}
```

### User Management Endpoints

#### Get All Users (Admin Only)
```
GET /api/users?page=1&limit=20&sort=-createdAt&role=user&search=john
Authorization: Bearer <admin_token>
```

#### Get User Statistics (Admin Only)
```
GET /api/users/stats
Authorization: Bearer <admin_token>
```

#### Get User by ID
```
GET /api/users/:id
Authorization: Bearer <token>
```

#### Update User
```
PUT /api/users/:id
Authorization: Bearer <token>
```
Body:
```json
{
  "name": "Jane Doe",
  "phone": "+0987654321",
  "address": {
    "street": "456 Oak Ave",
    "city": "Los Angeles",
    "state": "CA"
  },
  "avatar": "https://example.com/avatar.jpg"
}
```

#### Delete User
```
DELETE /api/users/:id
Authorization: Bearer <token>
```

#### Change Password
```
PUT /api/users/change-password
Authorization: Bearer <token>
```
Body:
```json
{
  "currentPassword": "OldPassword123",
  "newPassword": "NewPassword123",
  "confirmPassword": "NewPassword123"
}
```

#### Change Email
```
PUT /api/users/change-email
Authorization: Bearer <token>
```
Body:
```json
{
  "newEmail": "newemail@example.com",
  "password": "CurrentPassword123"
}
```

#### Get User Activity
```
GET /api/users/:id/activity?page=1&limit=50
Authorization: Bearer <token>
```

## Security Features

### Password Requirements
- Minimum 6 characters
- Must contain at least one uppercase letter
- Must contain at least one lowercase letter
- Must contain at least one number
- Recommended: Include special characters for stronger passwords

### Account Security
- **Account Lockout**: After 5 failed login attempts, account is locked for 2 hours
- **Token Blacklisting**: Logout tokens are blacklisted in Redis
- **Refresh Token Rotation**: Optional refresh token rotation for enhanced security
- **Email Verification**: Required for login (configurable)

### JWT Token Details
- **Access Token**: Default expiry of 7 days (configurable)
- **Refresh Token**: Default expiry of 30 days
- **Token Storage**: HTTP-only cookies for web clients
- **Authorization Header**: Bearer token for API clients

## Models

### User Model
- Email (unique, required)
- Password (hashed with bcrypt)
- Name (required)
- Role (user/admin)
- Phone (optional)
- Address (optional)
- Avatar URL (optional)
- Email verification status
- Account active status
- Login attempts tracking
- Last login timestamp

### Token Model
- Token value (hashed)
- User reference
- Type (refresh/passwordReset/emailVerification)
- Expiry date
- Usage status
- Device information

## Environment Variables

Required environment variables for authentication:

```env
# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRE=7d
JWT_COOKIE_EXPIRE=7

# Security
BCRYPT_SALT_ROUNDS=10

# Features
ENABLE_EMAIL_VERIFICATION=true
SOFT_DELETE=true
ROTATE_REFRESH_TOKENS=true

# Email (for password reset and verification)
EMAIL_HOST=smtp.mailtrap.io
EMAIL_PORT=2525
EMAIL_USER=your-email-user
EMAIL_PASS=your-email-password
EMAIL_FROM=noreply@example.com
```

## Error Handling

The authentication system returns appropriate HTTP status codes:

- `200`: Success
- `201`: Created (registration)
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (invalid credentials)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (user not found)

Error responses include detailed messages:

```json
{
  "success": false,
  "error": "Validation Error",
  "errors": {
    "body": {
      "email": "Please provide a valid email address",
      "password": "Password must be at least 6 characters long"
    }
  }
}
```

## Testing the Authentication System

1. **Start the server**:
   ```bash
   npm run dev
   ```

2. **Register a new user**:
   ```bash
   curl -X POST http://localhost:3000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{
       "email": "test@example.com",
       "password": "Test123!",
       "confirmPassword": "Test123!",
       "name": "Test User"
     }'
   ```

3. **Login**:
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{
       "email": "test@example.com",
       "password": "Test123!"
     }'
   ```

4. **Use the access token** for protected routes:
   ```bash
   curl -X GET http://localhost:3000/api/auth/me \
     -H "Authorization: Bearer <access_token>"
   ```

## Best Practices

1. **Always use HTTPS** in production
2. **Store tokens securely** (HTTP-only cookies for web, secure storage for mobile)
3. **Implement rate limiting** on authentication endpoints
4. **Log authentication events** for security monitoring
5. **Regularly rotate JWT secrets** in production
6. **Implement proper CORS** configuration
7. **Use strong password policies**
8. **Enable email verification** for production environments

## Integration Notes

### Email Service
The current implementation includes mock email sending. For production, integrate with:
- SendGrid
- AWS SES
- Mailgun
- Custom SMTP server

### Redis Integration
Redis is used for:
- Token blacklisting (logout)
- Rate limiting
- Session management

### Database Indexes
Ensure the following indexes are created for optimal performance:
- User email (unique)
- User role
- Token expiry date
- Token type and user