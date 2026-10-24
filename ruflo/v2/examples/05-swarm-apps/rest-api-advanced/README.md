# Advanced REST API

A production-ready REST API built with Node.js, Express, and MongoDB, featuring comprehensive authentication, e-commerce functionality, and enterprise-grade security.

## Features

### Core Features
- **RESTful API Design**: Following REST principles and best practices
- **Authentication & Authorization**: JWT-based authentication with refresh tokens
- **Role-Based Access Control**: User and admin roles with permission-based routing
- **Database**: MongoDB with Mongoose ODM
- **Caching**: Redis integration for performance optimization
- **Validation**: Request validation using Joi and express-validator
- **Error Handling**: Centralized error handling with custom error classes
- **Logging**: Structured logging with Winston
- **Security**: Comprehensive security measures including rate limiting, helmet, CORS, XSS protection
- **API Documentation**: Auto-generated Swagger/OpenAPI documentation
- **Testing**: Comprehensive unit and integration tests with Jest
- **File Upload**: Multer integration for product images and avatars
- **Email**: Email service for notifications, verification, and password reset
- **Monitoring**: Health checks and readiness endpoints

### E-commerce Features
- **Product Management**: Full CRUD operations with categories, tags, and specifications
- **Inventory Tracking**: Real-time stock management with bulk operations
- **Product Reviews**: User reviews with ratings and helpful votes
- **Order Processing**: Complete order lifecycle from creation to delivery
- **Shopping Cart**: Session-based cart management
- **Payment Integration**: Support for multiple payment methods
- **Order Tracking**: Shipping information and status updates
- **Sales Reports**: Admin analytics and reporting

### Security Features
- Helmet.js for security headers
- CORS configuration with whitelisting
- Rate limiting (general: 100/15min, auth: 5/15min)
- MongoDB injection prevention
- XSS protection with input sanitization
- HTTP Parameter Pollution prevention
- JWT token blacklisting
- Bcrypt password hashing with salt rounds
- Password strength validation
- Account lockout after failed attempts
- Email verification
- Two-factor authentication ready

### Development Features
- Hot reloading with nodemon
- Environment-based configuration
- Docker support with docker-compose
- ESLint with Airbnb configuration
- Comprehensive error messages
- Request ID tracking
- Graceful shutdown handling
- Database seeders for test data
- Postman collection included
- VSCode debugging configuration

## Project Structure

```
rest-api-advanced/
├── src/
│   ├── config/          # Configuration files
│   │   ├── database.js  # MongoDB connection
│   │   ├── redis.js     # Redis connection
│   │   └── config.js    # App configuration
│   ├── controllers/     # Route controllers
│   │   ├── auth.controller.js
│   │   ├── user.controller.js
│   │   ├── product.controller.js
│   │   └── order.controller.js
│   ├── middleware/      # Custom middleware
│   │   ├── auth.js      # Authentication middleware
│   │   ├── errorHandler.js
│   │   ├── validate.js  # Validation middleware
│   │   └── upload.js    # File upload middleware
│   ├── models/          # Mongoose models
│   │   ├── User.js
│   │   ├── Product.js
│   │   ├── Order.js
│   │   └── Token.js
│   ├── routes/          # API routes
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   ├── product.routes.js
│   │   ├── order.routes.js
│   │   └── health.routes.js
│   ├── services/        # Business logic
│   │   ├── auth.service.js
│   │   ├── email.service.js
│   │   ├── cache.service.js
│   │   └── payment.service.js
│   ├── utils/           # Utility functions
│   │   ├── logger.js
│   │   ├── ApiError.js
│   │   ├── asyncHandler.js
│   │   └── helpers.js
│   └── validators/      # Request validators
│       ├── auth.validator.js
│       ├── user.validator.js
│       └── product.validator.js
├── tests/               # Test files
│   ├── unit/           # Unit tests
│   ├── integration/    # Integration tests
│   └── setup.js        # Test configuration
├── docs/               # Documentation
├── scripts/            # Utility scripts
├── .env.example        # Environment variables example
├── .eslintrc.js        # ESLint configuration
├── .gitignore         # Git ignore file
├── docker-compose.yml  # Docker compose for local development
├── Dockerfile         # Docker configuration
├── jest.config.js     # Jest configuration
├── package.json       # NPM dependencies
├── README.md          # Project documentation
└── server.js          # Application entry point
```

## Getting Started

### Prerequisites
- Node.js >= 16.0.0
- MongoDB >= 4.4
- Redis >= 6.0 (optional, but recommended)
- npm or yarn

### Quick Start

#### Option 1: Automated Setup (Recommended)

```bash
# Clone the repository
git clone <repository-url>
cd rest-api-advanced

# Run the quick start script
./scripts/quick-start.sh
```

This script will:
- Check all prerequisites
- Create .env with secure JWT secret
- Install dependencies
- Start MongoDB and Redis with Docker
- Seed the database
- Start the development server

#### Option 2: Manual Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd rest-api-advanced
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start services with Docker (recommended):
```bash
docker-compose up -d mongodb redis
```

Or install MongoDB and Redis locally.

5. Create `.env` file with required variables:
```env
# Server
PORT=3000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/rest-api-advanced

# JWT
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_EXPIRE=7d

# Redis (optional)
REDIS_HOST=localhost
REDIS_PORT=6379
```

6. Seed the database:
```bash
npm run seed
```

This creates:
- Admin user: `admin@example.com` / `password123`
- Test user: `user@example.com` / `password123`
- Sample products and categories

7. Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:3000`

### Using Docker (All Services)

1. Build and run everything with Docker Compose:
```bash
docker-compose up --build
```

This will start:
- The API server on port 3000
- MongoDB on port 27017
- Redis on port 6379
- Automatic database seeding

2. Access the API:
- API Base URL: `http://localhost:3000/api`
- Swagger Docs: `http://localhost:3000/api-docs`
- Health Check: `http://localhost:3000/api/health`

## API Documentation

### Interactive Documentation
Once the server is running, you can access:
- **Swagger UI**: `http://localhost:3000/api-docs`
- **Postman Collection**: Available in `/docs/postman-collection.json`
- **Full API Reference**: See `/docs/API.md`

### Quick Links
- Health Check: `http://localhost:3000/api/health`
- API Base URL: `http://localhost:3000/api`

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password
- `GET /api/auth/verify-email/:token` - Verify email address
- `POST /api/auth/resend-verification` - Resend verification email
- `GET /api/auth/me` - Get current user
- `POST /api/auth/check-password` - Check password strength

### Users
- `GET /api/users` - Get all users (admin only)
- `GET /api/users/profile` - Get current user profile
- `GET /api/users/:id` - Get user by ID (admin only)
- `PUT /api/users/profile` - Update current user profile
- `PUT /api/users/:id` - Update user (admin only)
- `DELETE /api/users/:id` - Delete user (admin only)
- `POST /api/users/avatar` - Upload user avatar
- `PUT /api/users/change-password` - Change password

### Products
- `GET /api/products` - Get all products (with pagination, filtering, sorting)
- `GET /api/products/:id` - Get product by ID
- `POST /api/products` - Create product (admin only)
- `PUT /api/products/:id` - Update product (admin only)
- `DELETE /api/products/:id` - Delete product (admin only)
- `POST /api/products/:id/images` - Upload product images (admin only)
- `DELETE /api/products/:id/images/:imageId` - Delete product image (admin only)
- `GET /api/products/category/:category` - Get products by category
- `GET /api/products/featured` - Get featured products
- `GET /api/products/popular` - Get popular products
- `GET /api/products/:id/related` - Get related products
- `POST /api/products/:id/reviews` - Add product review
- `PUT /api/products/:id/reviews` - Update product review
- `DELETE /api/products/:id/reviews` - Delete product review
- `POST /api/products/:id/reviews/:reviewId/helpful` - Mark review as helpful
- `PUT /api/products/:id/inventory` - Update inventory (admin only)
- `PUT /api/products/inventory/bulk` - Bulk update inventory (admin only)
- `GET /api/products/inventory/report` - Get inventory report (admin only)
- `GET /api/products/categories/list` - Get all categories
- `GET /api/products/export/data` - Export products (admin only)

### Orders
- `GET /api/orders` - Get user orders
- `GET /api/orders/:id` - Get order by ID
- `POST /api/orders` - Create order
- `DELETE /api/orders/:id` - Cancel order
- `GET /api/orders/admin/all` - Get all orders (admin only)
- `PUT /api/orders/:id/status` - Update order status (admin only)
- `POST /api/orders/:id/tracking` - Add tracking info (admin only)
- `POST /api/orders/:id/refund` - Process refund (admin only)
- `POST /api/orders/:id/note` - Add internal note (admin only)
- `GET /api/orders/statistics/summary` - Get order statistics
- `GET /api/orders/reports/sales` - Get sales report (admin only)
- `GET /api/orders/:id/invoice` - Get order invoice
- `GET /api/orders/export/data` - Export orders (admin only)

### Health
- `GET /api/health` - Basic health check
- `GET /api/health/ready` - Readiness check
- `GET /api/health/live` - Liveness check

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### Token Management
- Access tokens expire in 7 days (configurable)
- Refresh tokens expire in 30 days (configurable)
- Use `/api/auth/refresh` endpoint to get new access token
- Tokens are blacklisted on logout
- Support for token rotation on refresh

## Request & Response Format

### Request Format
```json
{
  "data": {
    "field1": "value1",
    "field2": "value2"
  }
}
```

### Success Response
```json
{
  "success": true,
  "data": {
    "id": "123",
    "field1": "value1",
    "field2": "value2"
  },
  "message": "Operation successful"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Pagination Response
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## Testing

The project includes comprehensive test suites for both unit and integration testing.

### Run all tests
```bash
npm test
```

### Run unit tests
```bash
npm run test:unit
```

### Run integration tests
```bash
npm run test:integration
```

### Run tests with coverage
```bash
npm run test:coverage
```

### Test Structure
- **Unit Tests**: Located in `/tests/unit/`
  - Auth service tests
  - Validation tests
  - Utility function tests
  
- **Integration Tests**: Located in `/tests/integration/`
  - Authentication endpoints
  - Product management
  - Order processing
  - Full API workflow tests

### Test Data
- Tests use MongoDB Memory Server for isolation
- Each test suite has its own setup and teardown
- No test data persists between runs

## Development

### Code Style
The project uses ESLint with Airbnb base configuration. Run linting:

```bash
npm run lint
npm run lint:fix
```

### Environment Variables

Key environment variables (see `.env.example` for complete list):

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
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_EXPIRE=7d
JWT_REFRESH_EXPIRE=30d
ROTATE_REFRESH_TOKENS=true

# Security
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
BCRYPT_ROUNDS=10

# Rate Limiting
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX=100
AUTH_RATE_LIMIT_MAX=5
```

### Seeding Data
```bash
# Seed all data (users, products, orders)
npm run seed

# Seed specific data
npm run seed:products
npm run seed:orders

# Clean and reseed database
npm run seed:clean
```

Default seed accounts:
- Admin: `admin@example.com` / `password123`
- User: `user@example.com` / `password123`

## Deployment

### Production Checklist
- [ ] Set `NODE_ENV=production`
- [ ] Use strong JWT secret
- [ ] Configure proper CORS origins
- [ ] Set up SSL/TLS certificates
- [ ] Configure rate limiting appropriately
- [ ] Set up monitoring (e.g., Sentry)
- [ ] Configure log aggregation
- [ ] Set up database backups
- [ ] Configure Redis persistence
- [ ] Set up health monitoring
- [ ] Configure auto-scaling

### Docker Deployment
```bash
docker build -t rest-api-advanced .
docker run -p 3000:3000 --env-file .env rest-api-advanced
```

### PM2 Deployment
```bash
pm2 start ecosystem.config.js --env production
```

## Performance Optimization

- Redis caching for frequently accessed data
- Database indexing on commonly queried fields
- Response compression with gzip
- Query optimization with Mongoose lean()
- Pagination for large datasets
- Rate limiting to prevent abuse
- Connection pooling for database

## Security Best Practices

- Input validation on all endpoints
- SQL/NoSQL injection prevention
- XSS protection
- CSRF protection
- Security headers with Helmet
- Rate limiting
- JWT token expiration
- Password complexity requirements
- Account lockout after failed attempts
- Audit logging for sensitive operations

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, email support@example.com or create an issue in the repository.