# REST API Technical Specification

## API Overview

**Base URL**: `http://localhost:3000/api/v1`  
**Content-Type**: `application/json`  
**API Version**: 1.0.0

## Data Models

### Task Resource

```typescript
interface Task {
  id: number;           // Auto-generated, unique
  title: string;        // Required, task title
  description: string;  // Optional, detailed description
  completed: boolean;   // Default: false
  createdAt: string;    // ISO 8601 timestamp
  updatedAt: string;    // ISO 8601 timestamp
}
```

### Error Response

```typescript
interface ErrorResponse {
  error: {
    message: string;    // Human-readable error message
    status: number;     // HTTP status code
    timestamp: string;  // ISO 8601 timestamp
  }
}
```

## API Endpoints

### 1. Health Check

**Endpoint**: `GET /health`  
**Description**: Check if the API is running and healthy  
**Authentication**: None

#### Response

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "version": "1.0.0"
}
```

**Status Codes**:
- `200 OK`: Service is healthy

---

### 2. List All Tasks

**Endpoint**: `GET /api/v1/tasks`  
**Description**: Retrieve all tasks  
**Authentication**: None

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| completed | boolean | No | Filter by completion status |
| limit | number | No | Number of results (default: 100) |
| offset | number | No | Pagination offset (default: 0) |

#### Response

```json
{
  "tasks": [
    {
      "id": 1,
      "title": "Complete API documentation",
      "description": "Write comprehensive API docs",
      "completed": false,
      "createdAt": "2024-01-15T10:00:00.000Z",
      "updatedAt": "2024-01-15T10:00:00.000Z"
    }
  ],
  "total": 1,
  "limit": 100,
  "offset": 0
}
```

**Status Codes**:
- `200 OK`: Success

---

### 3. Get Single Task

**Endpoint**: `GET /api/v1/tasks/:id`  
**Description**: Retrieve a specific task by ID  
**Authentication**: None

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | number | Yes | Task ID |

#### Response

```json
{
  "id": 1,
  "title": "Complete API documentation",
  "description": "Write comprehensive API docs",
  "completed": false,
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T10:00:00.000Z"
}
```

**Status Codes**:
- `200 OK`: Success
- `404 Not Found`: Task not found

---

### 4. Create Task

**Endpoint**: `POST /api/v1/tasks`  
**Description**: Create a new task  
**Authentication**: None

#### Request Body

```json
{
  "title": "New task",
  "description": "Task description (optional)",
  "completed": false
}
```

#### Validation Rules

- `title`: Required, string, 1-255 characters
- `description`: Optional, string, max 1000 characters
- `completed`: Optional, boolean, defaults to false

#### Response

```json
{
  "id": 2,
  "title": "New task",
  "description": "Task description",
  "completed": false,
  "createdAt": "2024-01-15T11:00:00.000Z",
  "updatedAt": "2024-01-15T11:00:00.000Z"
}
```

**Status Codes**:
- `201 Created`: Success
- `400 Bad Request`: Invalid input

---

### 5. Update Task

**Endpoint**: `PUT /api/v1/tasks/:id`  
**Description**: Update an existing task  
**Authentication**: None

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | number | Yes | Task ID |

#### Request Body

```json
{
  "title": "Updated task title",
  "description": "Updated description",
  "completed": true
}
```

#### Validation Rules

- All fields are optional
- If provided, same rules as creation apply

#### Response

```json
{
  "id": 1,
  "title": "Updated task title",
  "description": "Updated description",
  "completed": true,
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T12:00:00.000Z"
}
```

**Status Codes**:
- `200 OK`: Success
- `400 Bad Request`: Invalid input
- `404 Not Found`: Task not found

---

### 6. Delete Task

**Endpoint**: `DELETE /api/v1/tasks/:id`  
**Description**: Delete a task  
**Authentication**: None

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | number | Yes | Task ID |

#### Response

```json
{
  "message": "Task deleted successfully",
  "id": 1
}
```

**Status Codes**:
- `200 OK`: Success
- `404 Not Found`: Task not found

---

## Common Headers

### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| Content-Type | Yes (for POST/PUT) | Must be `application/json` |
| Accept | No | Preferred: `application/json` |

### Response Headers

| Header | Description |
|--------|-------------|
| Content-Type | Always `application/json` |
| X-Request-ID | Unique request identifier |

## Error Handling

All errors follow a consistent format:

```json
{
  "error": {
    "message": "Descriptive error message",
    "status": 400,
    "timestamp": "2024-01-15T12:00:00.000Z"
  }
}
```

### Common Error Codes

| Status Code | Description |
|-------------|-------------|
| 400 | Bad Request - Invalid input |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

## Rate Limiting

No rate limiting implemented in the simple version.

## CORS

Currently allows all origins (`*`) for development purposes.

## Example Usage

### Create a Task

```bash
curl -X POST http://localhost:3000/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Learn REST APIs",
    "description": "Build a simple REST API with Express"
  }'
```

### List All Tasks

```bash
curl http://localhost:3000/api/v1/tasks
```

### Update a Task

```bash
curl -X PUT http://localhost:3000/api/v1/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{
    "completed": true
  }'
```

### Delete a Task

```bash
curl -X DELETE http://localhost:3000/api/v1/tasks/1
```

## Testing the API

The API includes a comprehensive test suite using Jest and Supertest. Tests cover:

- All endpoints with various scenarios
- Error cases and edge conditions
- Input validation
- Response format verification

Run tests with:
```bash
npm test
```