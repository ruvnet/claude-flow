# REST API Advanced - Complete API Documentation

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Authentication](#authentication)
4. [Rate Limiting](#rate-limiting)
5. [Error Handling](#error-handling)
6. [API Endpoints](#api-endpoints)
   - [Authentication](#authentication-endpoints)
   - [Users](#user-endpoints)
   - [Products](#product-endpoints)
   - [Orders](#order-endpoints)
   - [Health](#health-endpoints)
7. [Data Models](#data-models)
8. [Example Workflows](#example-workflows)
9. [Best Practices](#best-practices)

## Overview

The Advanced REST API is a production-ready e-commerce API built with Node.js, Express, and MongoDB. It features:

- JWT-based authentication with refresh tokens
- Role-based access control (RBAC)
- Comprehensive input validation
- Rate limiting and security headers
- Redis caching for performance
- Detailed error handling
- API documentation with Swagger
- Health checks and monitoring
- Automated testing suite

### Base URL

```
Development: http://localhost:3000/api
Production: https://api.example.com/api
```

### API Version

Current version: `1.0.0`

## Getting Started

### Prerequisites

- Node.js >= 16.0.0
- MongoDB >= 4.4
- Redis >= 6.0 (optional, for caching)

### Quick Start

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables (see `.env.example`)
4. Start MongoDB and Redis
5. Run database seeders: `npm run seed`
6. Start the server: `npm run dev`

### Environment Variables

```env
# Server Configuration
PORT=3000
NODE_ENV=development
API_URL=http://localhost:3000

# Database
MONGODB_URI=mongodb://localhost:27017/rest-api-advanced

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRE=7d
JWT_REFRESH_EXPIRE=30d
ROTATE_REFRESH_TOKENS=true

# Security
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
BCRYPT_ROUNDS=10

# Email (for production)
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=noreply@example.com
EMAIL_PASS=your-email-password
EMAIL_FROM=noreply@example.com
```

## Authentication

The API uses JWT (JSON Web Tokens) for authentication with support for refresh tokens.

### Authentication Flow

1. **Register/Login**: User provides credentials and receives access and refresh tokens
2. **Access Protected Routes**: Include the access token in the Authorization header
3. **Token Refresh**: When access token expires, use refresh token to get a new one
4. **Logout**: Blacklist the current token

### Token Format

Include the JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### Token Expiration

- Access Token: 7 days (configurable)
- Refresh Token: 30 days (configurable)

### Password Requirements

- Minimum 6 characters
- Recommended: Include uppercase, lowercase, numbers, and special characters

## Rate Limiting

The API implements rate limiting to prevent abuse:

### General Endpoints
- **Limit**: 100 requests per 15 minutes per IP
- **Headers**: 
  - `X-RateLimit-Limit`: Total requests allowed
  - `X-RateLimit-Remaining`: Requests remaining
  - `X-RateLimit-Reset`: Reset timestamp

### Authentication Endpoints
- **Limit**: 5 requests per 15 minutes per IP
- **Note**: Only failed attempts count against the limit

### Rate Limit Response

When rate limit is exceeded:

```json
{
  "success": false,
  "message": "Too many requests from this IP, please try again later.",
  "error": {
    "statusCode": 429,
    "message": "Rate limit exceeded"
  }
}
```

## Error Handling

The API uses consistent error responses across all endpoints.

### Error Response Format

```json
{
  "success": false,
  "message": "Human-readable error message",
  "error": {
    "statusCode": 400,
    "message": "Detailed error description"
  }
}
```

### Validation Error Format

```json
{
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    },
    {
      "field": "password",
      "message": "Password must be at least 6 characters"
    }
  ]
}
```

### Common Error Codes

- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate resource)
- `429` - Too Many Requests (rate limit)
- `500` - Internal Server Error

## API Endpoints

### Authentication Endpoints

#### Register User

```http
POST /api/auth/register
```

Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "name": "John Doe"
}
```

**Response (201):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user",
    "isEmailVerified": false,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Login User

```http
POST /api/auth/login
```

Authenticate user and receive tokens.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user",
    "lastLogin": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Refresh Token

```http
POST /api/auth/refresh
```

Get new access token using refresh token.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Logout

```http
POST /api/auth/logout
```

Logout and blacklist current token.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

#### Get Current User

```http
GET /api/auth/me
```

Get authenticated user details.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "email": "user@example.com",
      "name": "John Doe",
      "role": "user",
      "isEmailVerified": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

#### Forgot Password

```http
POST /api/auth/forgot-password
```

Request password reset email.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Password reset email sent"
}
```

#### Reset Password

```http
POST /api/auth/reset-password
```

Reset password using token from email.

**Request Body:**
```json
{
  "token": "reset-token-from-email",
  "password": "NewSecurePass123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Password reset successful"
}
```

#### Verify Email

```http
GET /api/auth/verify-email/:token
```

Verify email address using token from email.

**Response (200):**
```json
{
  "success": true,
  "message": "Email verified successfully"
}
```

#### Check Password Strength

```http
POST /api/auth/check-password
```

Check password strength without creating account.

**Request Body:**
```json
{
  "password": "MyStr0ng!Pass"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "strength": {
      "isValid": true,
      "score": 5,
      "level": "strong",
      "feedback": []
    }
  }
}
```

### Product Endpoints

#### Get All Products

```http
GET /api/products
```

Get paginated list of products with filtering and sorting.

**Query Parameters:**
- `page` (default: 1) - Page number
- `limit` (default: 20) - Items per page
- `search` - Search by name or description
- `category` - Filter by category
- `minPrice` - Minimum price filter
- `maxPrice` - Maximum price filter
- `sort` - Sort field (price, -price, name, -name, createdAt, -createdAt)
- `inStock` - Filter by stock availability (true/false)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "507f1f77bcf86cd799439011",
      "name": "Laptop",
      "description": "High-performance laptop",
      "price": 999.99,
      "category": "Electronics",
      "sku": "LAP001",
      "stock": 10,
      "images": ["https://example.com/image1.jpg"],
      "tags": ["new", "featured"],
      "averageRating": 4.5,
      "reviewCount": 25,
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

#### Get Product by ID

```http
GET /api/products/:id
```

Get detailed product information.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Laptop",
    "description": "High-performance laptop with latest specs",
    "price": 999.99,
    "category": "Electronics",
    "sku": "LAP001",
    "stock": 10,
    "images": [
      "https://example.com/image1.jpg",
      "https://example.com/image2.jpg"
    ],
    "tags": ["new", "featured"],
    "specifications": {
      "brand": "TechBrand",
      "model": "TB-2024",
      "weight": "1.5kg",
      "dimensions": "35x25x2cm"
    },
    "reviews": [
      {
        "id": "507f1f77bcf86cd799439012",
        "user": "507f1f77bcf86cd799439013",
        "rating": 5,
        "title": "Excellent product!",
        "comment": "Very satisfied with this laptop.",
        "helpfulCount": 10,
        "createdAt": "2024-01-02T00:00:00.000Z"
      }
    ],
    "averageRating": 4.5,
    "reviewCount": 25,
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Create Product (Admin)

```http
POST /api/products
```

Create a new product.

**Headers:**
```
Authorization: Bearer <admin-token>
```

**Request Body:**
```json
{
  "name": "New Product",
  "description": "Product description",
  "price": 149.99,
  "category": "Electronics",
  "sku": "NEW001",
  "stock": 20,
  "tags": ["new"],
  "specifications": {
    "weight": "500g",
    "dimensions": "10x10x5cm"
  }
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439014",
    "name": "New Product",
    "price": 149.99,
    "category": "Electronics",
    "sku": "NEW001",
    "stock": 20,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Update Product (Admin)

```http
PUT /api/products/:id
```

Update product details.

**Headers:**
```
Authorization: Bearer <admin-token>
```

**Request Body:**
```json
{
  "name": "Updated Product Name",
  "price": 129.99,
  "stock": 15
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Updated Product Name",
    "price": 129.99,
    "stock": 15,
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Delete Product (Admin)

```http
DELETE /api/products/:id
```

Delete a product.

**Headers:**
```
Authorization: Bearer <admin-token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Product deleted successfully"
}
```

#### Add Product Review

```http
POST /api/products/:id/reviews
```

Add a review to a product.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "rating": 5,
  "title": "Excellent product!",
  "comment": "Very satisfied with this purchase."
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "reviews": [
      {
        "id": "507f1f77bcf86cd799439015",
        "user": "507f1f77bcf86cd799439013",
        "rating": 5,
        "title": "Excellent product!",
        "comment": "Very satisfied with this purchase.",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "averageRating": 5,
    "reviewCount": 1
  }
}
```

#### Update Inventory (Admin)

```http
PUT /api/products/:id/inventory
```

Update product inventory.

**Headers:**
```
Authorization: Bearer <admin-token>
```

**Request Body:**
```json
{
  "stock": 50,
  "operation": "set" // "set", "increment", "decrement"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "stock": 50,
    "lastStockUpdate": "2024-01-01T00:00:00.000Z"
  }
}
```

### Order Endpoints

#### Create Order

```http
POST /api/orders
```

Create a new order.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "items": [
    {
      "product": "507f1f77bcf86cd799439011",
      "quantity": 2
    }
  ],
  "shippingAddress": {
    "name": "John Doe",
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001",
    "country": "USA"
  },
  "paymentMethod": "credit_card",
  "notes": "Please deliver between 9 AM - 5 PM"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439016",
    "orderNumber": "ORD-2024-0001",
    "items": [
      {
        "product": "507f1f77bcf86cd799439011",
        "quantity": 2,
        "price": 99.99,
        "subtotal": 199.98
      }
    ],
    "subtotal": 199.98,
    "tax": 20.00,
    "shipping": 10.00,
    "totalAmount": 229.98,
    "status": "pending",
    "paymentStatus": "pending",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Get User Orders

```http
GET /api/orders
```

Get authenticated user's orders.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 20)
- `status` - Filter by order status
- `sort` - Sort orders

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "507f1f77bcf86cd799439016",
      "orderNumber": "ORD-2024-0001",
      "totalAmount": 229.98,
      "status": "pending",
      "paymentStatus": "completed",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "total": 10,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

#### Get Order Details

```http
GET /api/orders/:id
```

Get detailed order information.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439016",
    "orderNumber": "ORD-2024-0001",
    "user": {
      "id": "507f1f77bcf86cd799439013",
      "name": "John Doe",
      "email": "user@example.com"
    },
    "items": [
      {
        "product": {
          "id": "507f1f77bcf86cd799439011",
          "name": "Laptop",
          "price": 99.99
        },
        "quantity": 2,
        "price": 99.99,
        "subtotal": 199.98
      }
    ],
    "subtotal": 199.98,
    "tax": 20.00,
    "shipping": 10.00,
    "totalAmount": 229.98,
    "status": "pending",
    "paymentStatus": "completed",
    "paymentMethod": "credit_card",
    "shippingAddress": {
      "name": "John Doe",
      "street": "123 Main St",
      "city": "New York",
      "state": "NY",
      "zipCode": "10001",
      "country": "USA"
    },
    "tracking": null,
    "statusHistory": [
      {
        "status": "pending",
        "timestamp": "2024-01-01T00:00:00.000Z"
      }
    ],
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Cancel Order

```http
DELETE /api/orders/:id
```

Cancel an order (only pending/processing orders).

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Order cancelled successfully"
}
```

#### Update Order Status (Admin)

```http
PUT /api/orders/:id/status
```

Update order status.

**Headers:**
```
Authorization: Bearer <admin-token>
```

**Request Body:**
```json
{
  "status": "processing" // "pending", "processing", "shipped", "delivered", "cancelled"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439016",
    "status": "processing",
    "statusHistory": [
      {
        "status": "pending",
        "timestamp": "2024-01-01T00:00:00.000Z"
      },
      {
        "status": "processing",
        "timestamp": "2024-01-01T01:00:00.000Z",
        "updatedBy": "507f1f77bcf86cd799439017"
      }
    ]
  }
}
```

#### Add Tracking Information (Admin)

```http
POST /api/orders/:id/tracking
```

Add shipping tracking information.

**Headers:**
```
Authorization: Bearer <admin-token>
```

**Request Body:**
```json
{
  "carrier": "FedEx",
  "trackingNumber": "1234567890",
  "estimatedDelivery": "2024-01-20"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "tracking": {
      "carrier": "FedEx",
      "trackingNumber": "1234567890",
      "estimatedDelivery": "2024-01-20"
    }
  }
}
```

### Health Endpoints

#### Health Check

```http
GET /api/health
```

Basic health check.

**Response (200):**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "environment": "development"
}
```

#### Readiness Check

```http
GET /api/health/ready
```

Check if all services are ready.

**Response (200):**
```json
{
  "status": "ready",
  "checks": {
    "database": "connected",
    "redis": "connected"
  }
}
```

#### Liveness Check

```http
GET /api/health/live
```

Check if the service is alive.

**Response (200):**
```json
{
  "status": "alive",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Data Models

### User Model

```javascript
{
  _id: ObjectId,
  email: String (unique, required),
  password: String (hashed, required),
  name: String (required),
  role: String (enum: ['user', 'admin'], default: 'user'),
  isActive: Boolean (default: true),
  isEmailVerified: Boolean (default: false),
  emailVerificationToken: String,
  passwordResetToken: String,
  passwordResetExpires: Date,
  loginAttempts: Number (default: 0),
  lockUntil: Date,
  lastLogin: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### Product Model

```javascript
{
  _id: ObjectId,
  name: String (required),
  description: String,
  price: Number (required, min: 0),
  category: String (required),
  sku: String (unique, required),
  stock: Number (default: 0, min: 0),
  images: [String],
  tags: [String],
  specifications: Object,
  reviews: [{
    user: ObjectId (ref: 'User'),
    rating: Number (1-5),
    title: String,
    comment: String,
    helpfulCount: Number (default: 0),
    createdAt: Date
  }],
  averageRating: Number (default: 0),
  reviewCount: Number (default: 0),
  isActive: Boolean (default: true),
  createdAt: Date,
  updatedAt: Date
}
```

### Order Model

```javascript
{
  _id: ObjectId,
  orderNumber: String (unique, required),
  user: ObjectId (ref: 'User', required),
  items: [{
    product: ObjectId (ref: 'Product'),
    quantity: Number (min: 1),
    price: Number,
    subtotal: Number
  }],
  subtotal: Number (required),
  tax: Number (default: 0),
  shipping: Number (default: 0),
  totalAmount: Number (required),
  status: String (enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']),
  paymentStatus: String (enum: ['pending', 'completed', 'failed', 'refunded']),
  paymentMethod: String (enum: ['credit_card', 'debit_card', 'paypal', 'stripe']),
  paymentDetails: Object,
  shippingAddress: {
    name: String,
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  tracking: {
    carrier: String,
    trackingNumber: String,
    estimatedDelivery: Date
  },
  notes: String,
  statusHistory: [{
    status: String,
    timestamp: Date,
    updatedBy: ObjectId (ref: 'User')
  }],
  refunds: [{
    amount: Number,
    reason: String,
    processedAt: Date,
    processedBy: ObjectId (ref: 'User')
  }],
  createdAt: Date,
  updatedAt: Date
}
```

## Example Workflows

### Complete Purchase Flow

1. **Browse Products**
   ```http
   GET /api/products?category=Electronics&sort=-rating
   ```

2. **View Product Details**
   ```http
   GET /api/products/507f1f77bcf86cd799439011
   ```

3. **Register/Login**
   ```http
   POST /api/auth/register
   {
     "email": "user@example.com",
     "password": "SecurePass123!",
     "name": "John Doe"
   }
   ```

4. **Add Review (optional)**
   ```http
   POST /api/products/507f1f77bcf86cd799439011/reviews
   {
     "rating": 5,
     "comment": "Great product!"
   }
   ```

5. **Create Order**
   ```http
   POST /api/orders
   {
     "items": [
       {
         "product": "507f1f77bcf86cd799439011",
         "quantity": 1
       }
     ],
     "shippingAddress": {
       "name": "John Doe",
       "street": "123 Main St",
       "city": "New York",
       "state": "NY",
       "zipCode": "10001",
       "country": "USA"
     },
     "paymentMethod": "credit_card"
   }
   ```

6. **Track Order**
   ```http
   GET /api/orders/507f1f77bcf86cd799439016
   ```

### Admin Product Management

1. **Login as Admin**
   ```http
   POST /api/auth/login
   {
     "email": "admin@example.com",
     "password": "AdminPass123!"
   }
   ```

2. **Create Product**
   ```http
   POST /api/products
   {
     "name": "New Laptop",
     "description": "Latest model laptop",
     "price": 1299.99,
     "category": "Electronics",
     "sku": "LAP002",
     "stock": 25
   }
   ```

3. **Update Inventory**
   ```http
   PUT /api/products/507f1f77bcf86cd799439011/inventory
   {
     "stock": 50,
     "operation": "set"
   }
   ```

4. **Process Orders**
   ```http
   GET /api/orders/admin/all?status=pending
   
   PUT /api/orders/507f1f77bcf86cd799439016/status
   {
     "status": "processing"
   }
   
   POST /api/orders/507f1f77bcf86cd799439016/tracking
   {
     "carrier": "FedEx",
     "trackingNumber": "1234567890"
   }
   ```

## Best Practices

### Security

1. **Always use HTTPS in production**
2. **Store sensitive data in environment variables**
3. **Implement proper CORS configuration**
4. **Use strong JWT secrets (minimum 32 characters)**
5. **Enable rate limiting on all endpoints**
6. **Validate and sanitize all user inputs**
7. **Keep dependencies updated**

### Performance

1. **Use pagination for list endpoints**
2. **Implement caching with Redis**
3. **Create database indexes for frequently queried fields**
4. **Use projection to limit returned fields**
5. **Compress responses with gzip**

### API Usage

1. **Include proper error handling in your client**
2. **Implement token refresh logic**
3. **Use appropriate HTTP methods**
4. **Include meaningful request IDs for debugging**
5. **Handle rate limiting gracefully**

### Testing

1. **Test both success and error scenarios**
2. **Include edge cases in your tests**
3. **Test with different user roles**
4. **Verify data validation rules**
5. **Test concurrent requests**

## Support

For API support, please contact:
- Email: support@example.com
- Documentation: https://api.example.com/docs
- Status Page: https://status.example.com

## Changelog

### Version 1.0.0 (Current)
- Initial release
- Complete authentication system
- Product catalog with reviews
- Order management
- Admin functionality
- Health checks
- Rate limiting
- Comprehensive validation