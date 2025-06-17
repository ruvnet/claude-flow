# REST API Example

A complete REST API built with Node.js and Express, demonstrating best practices for API development.

## Features

- **RESTful Design**: Full CRUD operations for Users and Products
- **Validation**: Input validation using express-validator
- **Error Handling**: Centralized error handling middleware
- **Security**: Helmet for security headers, CORS support
- **Testing**: Comprehensive test suite with Jest and Supertest
- **Pagination**: Built-in pagination support for list endpoints
- **Filtering**: Query parameter filtering for products
- **Documentation**: Clear API documentation and examples

## Project Structure

```
rest-api/
├── src/
│   ├── controllers/      # Request handlers
│   ├── models/          # Data models (in-memory for demo)
│   ├── routes/          # API route definitions
│   ├── middleware/      # Custom middleware
│   └── server.js        # Express server setup
├── tests/               # Test suites
├── package.json         # Dependencies and scripts
├── .env.example        # Environment variables template
└── README.md           # This file
```

## Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
```

## Running the API

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

The API will be available at `http://localhost:3000`

## API Endpoints

### Health Check
- `GET /health` - Server health status

### API Info
- `GET /api/v1` - API information and available endpoints

### Users
- `GET /api/v1/users` - List all users (with pagination)
- `GET /api/v1/users/:id` - Get user by ID
- `POST /api/v1/users` - Create new user
- `PUT /api/v1/users/:id` - Update user
- `DELETE /api/v1/users/:id` - Delete user

### Products
- `GET /api/v1/products` - List all products (with pagination and filtering)
- `GET /api/v1/products/:id` - Get product by ID
- `POST /api/v1/products` - Create new product
- `PUT /api/v1/products/:id` - Update product
- `DELETE /api/v1/products/:id` - Delete product

## Request Examples

### Create User
```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "age": 30
  }'
```

### List Products with Filters
```bash
# Filter by category
curl http://localhost:3000/api/v1/products?category=Electronics

# Filter by price range
curl http://localhost:3000/api/v1/products?minPrice=50&maxPrice=200

# With pagination
curl http://localhost:3000/api/v1/products?page=2&limit=5
```

### Update Product
```bash
curl -X PUT http://localhost:3000/api/v1/products/1 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Product",
    "price": 149.99,
    "category": "Electronics",
    "stock": 25
  }'
```

## Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run tests in watch mode
npm run test:watch
```

## Response Format

All API responses follow a consistent format:

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "message": "Error description",
    "status": 400,
    "timestamp": "2024-01-13T12:00:00.000Z"
  }
}
```

### Paginated Response
```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 50
  }
}
```

## Validation

The API validates all input data:

- **Users**: Name and valid email required, age must be 0-120
- **Products**: Name, price, and category required, stock must be non-negative

Validation errors return a 400 status with details:

```json
{
  "errors": [
    {
      "type": "field",
      "msg": "Valid email is required",
      "path": "email",
      "location": "body"
    }
  ]
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 3000 |
| NODE_ENV | Environment (development/production) | development |
| API_PREFIX | API route prefix | /api/v1 |
| API_RATE_LIMIT | Rate limit per hour | 100 |

## Security Features

- **Helmet**: Sets various HTTP headers for security
- **CORS**: Configured for cross-origin requests
- **Input Validation**: All inputs are validated and sanitized
- **Error Messages**: Production error messages don't expose sensitive details

## Development

```bash
# Linting
npm run lint

# Format code
npm run format
```

## Production Considerations

This example uses in-memory storage for simplicity. For production:

1. Replace in-memory models with database integration (PostgreSQL, MongoDB, etc.)
2. Add authentication and authorization
3. Implement rate limiting
4. Add request logging and monitoring
5. Configure environment-specific settings
6. Set up CI/CD pipeline
7. Add API versioning strategy
8. Implement caching for better performance

## License

MIT