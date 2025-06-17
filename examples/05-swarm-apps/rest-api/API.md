# REST API Documentation

## Base URL
```
http://localhost:3000/api/v1
```

## Authentication
Currently, this API does not require authentication. In production, you should implement proper authentication.

## Common Headers
```
Content-Type: application/json
Accept: application/json
```

## Endpoints

### Users Resource

#### List Users
```http
GET /api/v1/users
```

Query Parameters:
- `page` (integer): Page number (default: 1)
- `limit` (integer): Items per page (default: 10)
- `sort` (string): Sort field (id, name, email, age)

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "age": 30,
      "createdAt": "2024-01-13T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 3
  }
}
```

#### Get User
```http
GET /api/v1/users/:id
```

Response:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "age": 30,
    "createdAt": "2024-01-13T12:00:00.000Z"
  }
}
```

#### Create User
```http
POST /api/v1/users
```

Request Body:
```json
{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "age": 25
}
```

Response (201 Created):
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "id": 4,
    "name": "Jane Smith",
    "email": "jane@example.com",
    "age": 25,
    "createdAt": "2024-01-13T12:00:00.000Z"
  }
}
```

#### Update User
```http
PUT /api/v1/users/:id
```

Request Body:
```json
{
  "name": "Jane Doe",
  "email": "jane.doe@example.com",
  "age": 26
}
```

Response:
```json
{
  "success": true,
  "message": "User updated successfully",
  "data": {
    "id": 4,
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "age": 26,
    "updatedAt": "2024-01-13T12:30:00.000Z"
  }
}
```

#### Delete User
```http
DELETE /api/v1/users/:id
```

Response:
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

### Products Resource

#### List Products
```http
GET /api/v1/products
```

Query Parameters:
- `page` (integer): Page number (default: 1)
- `limit` (integer): Items per page (default: 10)
- `category` (string): Filter by category
- `minPrice` (number): Minimum price filter
- `maxPrice` (number): Maximum price filter

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Laptop",
      "price": 999.99,
      "category": "Electronics",
      "stock": 50,
      "description": "High-performance laptop",
      "createdAt": "2024-01-13T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 4
  }
}
```

#### Get Product
```http
GET /api/v1/products/:id
```

Response:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Laptop",
    "price": 999.99,
    "category": "Electronics",
    "stock": 50,
    "description": "High-performance laptop",
    "createdAt": "2024-01-13T12:00:00.000Z"
  }
}
```

#### Create Product
```http
POST /api/v1/products
```

Request Body:
```json
{
  "name": "Wireless Mouse",
  "price": 29.99,
  "category": "Accessories",
  "stock": 100,
  "description": "Ergonomic wireless mouse"
}
```

Response (201 Created):
```json
{
  "success": true,
  "message": "Product created successfully",
  "data": {
    "id": 5,
    "name": "Wireless Mouse",
    "price": 29.99,
    "category": "Accessories",
    "stock": 100,
    "description": "Ergonomic wireless mouse",
    "createdAt": "2024-01-13T12:00:00.000Z"
  }
}
```

#### Update Product
```http
PUT /api/v1/products/:id
```

Request Body:
```json
{
  "name": "Gaming Mouse",
  "price": 49.99,
  "category": "Gaming",
  "stock": 75,
  "description": "RGB gaming mouse with programmable buttons"
}
```

Response:
```json
{
  "success": true,
  "message": "Product updated successfully",
  "data": {
    "id": 5,
    "name": "Gaming Mouse",
    "price": 49.99,
    "category": "Gaming",
    "stock": 75,
    "description": "RGB gaming mouse with programmable buttons",
    "updatedAt": "2024-01-13T12:30:00.000Z"
  }
}
```

#### Delete Product
```http
DELETE /api/v1/products/:id
```

Response:
```json
{
  "success": true,
  "message": "Product deleted successfully"
}
```

## Error Responses

### Validation Error (400)
```json
{
  "errors": [
    {
      "type": "field",
      "value": "invalid-email",
      "msg": "Valid email is required",
      "path": "email",
      "location": "body"
    }
  ]
}
```

### Not Found (404)
```json
{
  "success": false,
  "message": "User not found"
}
```

### Server Error (500)
```json
{
  "success": false,
  "error": {
    "message": "Internal Server Error",
    "status": 500,
    "timestamp": "2024-01-13T12:00:00.000Z"
  }
}
```

## Rate Limiting
The API implements rate limiting (default: 100 requests per hour per IP). When exceeded:

```json
{
  "success": false,
  "error": {
    "message": "Too many requests",
    "status": 429,
    "timestamp": "2024-01-13T12:00:00.000Z"
  }
}
```

## CORS
The API supports CORS for all origins in development. Configure appropriate origins for production.

## Versioning
The API uses URL versioning (currently v1). Future versions will be available at `/api/v2`, etc.