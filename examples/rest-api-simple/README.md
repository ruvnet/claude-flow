# Simple REST API

A super simple REST API built with Express.js that demonstrates basic CRUD operations.

## Features

- In-memory data storage
- Full CRUD operations (Create, Read, Update, Delete)
- JSON request/response format
- Health check endpoint
- No database required

## Installation

```bash
npm install
```

## Running the API

```bash
# Production mode
npm start

# Development mode with auto-reload
npm run dev
```

The API will start on port 3000 by default, or use the PORT environment variable.

## API Endpoints

### Root Endpoint
- **GET /** - Welcome message and endpoint list

### Items Resource
- **GET /api/items** - Get all items
- **GET /api/items/:id** - Get a single item by ID
- **POST /api/items** - Create a new item
- **PUT /api/items/:id** - Update an existing item
- **DELETE /api/items/:id** - Delete an item

### Health Check
- **GET /health** - API health status

## Example Usage

### Get all items
```bash
curl http://localhost:3000/api/items
```

### Get a single item
```bash
curl http://localhost:3000/api/items/1
```

### Create a new item
```bash
curl -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d '{"name": "New Item", "description": "This is a new item"}'
```

### Update an item
```bash
curl -X PUT http://localhost:3000/api/items/1 \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Item", "description": "This is an updated item"}'
```

### Delete an item
```bash
curl -X DELETE http://localhost:3000/api/items/1
```

## Response Format

### Success Response
```json
{
  "id": 1,
  "name": "Item 1",
  "description": "This is the first item"
}
```

### Error Response
```json
{
  "error": "Item not found"
}
```

## Notes

- Data is stored in memory and will be lost when the server restarts
- No authentication or authorization is implemented
- This is a demonstration API for learning purposes