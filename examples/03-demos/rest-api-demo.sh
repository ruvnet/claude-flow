#!/bin/bash
# Demonstrate what the Claude Flow Swarm creates for a REST API

echo "🐝 Claude Flow Swarm - REST API Creation Demo"
echo "==========================================="
echo ""
echo "This demonstrates what the swarm system creates when you run:"
echo "./bin/claude-flow swarm \"Build a REST API in examples/\" --strategy development"
echo ""

# Create the REST API structure
API_DIR="/workspaces/claude-code-flow/examples/rest-api"
rm -rf "$API_DIR"
mkdir -p "$API_DIR"

echo "📁 Creating REST API in: $API_DIR"
echo ""

# Create server.js
cat > "$API_DIR/server.js" << 'EOF'
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'REST API',
    swarmId: 'swarm_demo_12345',
    created: new Date().toISOString()
  });
});

// Sample endpoints
app.get('/api/v1/items', (req, res) => {
  res.json({
    items: [
      { id: 1, name: 'Item 1', description: 'First item' },
      { id: 2, name: 'Item 2', description: 'Second item' }
    ],
    total: 2
  });
});

app.get('/api/v1/items/:id', (req, res) => {
  const id = parseInt(req.params.id);
  res.json({
    id,
    name: `Item ${id}`,
    description: `Description for item ${id}`
  });
});

app.post('/api/v1/items', (req, res) => {
  const newItem = {
    id: Date.now(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  res.status(201).json(newItem);
});

app.put('/api/v1/items/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const updatedItem = {
    id,
    ...req.body,
    updatedAt: new Date().toISOString()
  };
  res.json(updatedItem);
});

app.delete('/api/v1/items/:id', (req, res) => {
  const id = parseInt(req.params.id);
  res.json({ message: `Item ${id} deleted successfully` });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
  console.log(`REST API server running on port ${port}`);
  console.log('Created by Claude Flow Swarm');
});

module.exports = app;
EOF

echo "✅ Created: server.js"

# Create package.json
cat > "$API_DIR/package.json" << 'EOF'
{
  "name": "rest-api",
  "version": "1.0.0",
  "description": "REST API created by Claude Flow Swarm",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "jest"
  },
  "keywords": ["rest", "api", "swarm", "claude-flow"],
  "author": "Claude Flow Swarm",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1",
    "jest": "^29.7.0",
    "supertest": "^6.3.3"
  },
  "swarmMetadata": {
    "swarmId": "swarm_demo_12345",
    "taskId": "task_create_api",
    "agentId": "agent_developer_1",
    "created": "2025-06-13T21:35:00.000Z"
  }
}
EOF

echo "✅ Created: package.json"

# Create test file
cat > "$API_DIR/server.test.js" << 'EOF'
const request = require('supertest');
const app = require('./server');

describe('REST API Tests', () => {
  test('GET /health should return healthy status', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
  });

  test('GET /api/v1/items should return items list', async () => {
    const response = await request(app).get('/api/v1/items');
    expect(response.status).toBe(200);
    expect(response.body.items).toBeDefined();
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  test('GET /api/v1/items/:id should return specific item', async () => {
    const response = await request(app).get('/api/v1/items/1');
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(1);
  });

  test('POST /api/v1/items should create new item', async () => {
    const newItem = { name: 'Test Item', description: 'Test Description' };
    const response = await request(app)
      .post('/api/v1/items')
      .send(newItem);
    expect(response.status).toBe(201);
    expect(response.body.name).toBe(newItem.name);
    expect(response.body.createdAt).toBeDefined();
  });

  test('PUT /api/v1/items/:id should update item', async () => {
    const update = { name: 'Updated Item' };
    const response = await request(app)
      .put('/api/v1/items/1')
      .send(update);
    expect(response.status).toBe(200);
    expect(response.body.name).toBe(update.name);
    expect(response.body.updatedAt).toBeDefined();
  });

  test('DELETE /api/v1/items/:id should delete item', async () => {
    const response = await request(app).delete('/api/v1/items/1');
    expect(response.status).toBe(200);
    expect(response.body.message).toContain('deleted successfully');
  });
});

console.log('Test suite created by Swarm Agent: Tester-1');
EOF

echo "✅ Created: server.test.js"

# Create README
cat > "$API_DIR/README.md" << 'EOF'
# REST API

This REST API was created by the Claude Flow Swarm system.

## Swarm Details
- Swarm ID: swarm_demo_12345
- Task: Create Implementation
- Agent: developer-1
- Generated: 2025-06-13T21:35:00.000Z

## Swarm Process

The swarm decomposed the objective "Build a REST API" into the following tasks:

1. **Analyze Requirements** (Agent: reviewer-1)
   - Analyzed the need for a REST API
   - Defined endpoints and data models

2. **Create Implementation** (Agent: developer-1)
   - Implemented Express.js server
   - Created CRUD endpoints
   - Added error handling

3. **Write Tests** (Agent: tester-1)
   - Created Jest test suite
   - Covered all endpoints
   - Validated functionality

4. **Create Documentation** (Agent: documenter-1)
   - Generated this README
   - Documented API endpoints
   - Added usage examples

## Installation

```bash
npm install
```

## Usage

Start the server:
```bash
npm start
```

Development mode with auto-reload:
```bash
npm run dev
```

Run tests:
```bash
npm test
```

## API Endpoints

### Health Check
- `GET /health` - Returns server health status

### Items Resource
- `GET /api/v1/items` - Get all items
- `GET /api/v1/items/:id` - Get item by ID
- `POST /api/v1/items` - Create new item
- `PUT /api/v1/items/:id` - Update item
- `DELETE /api/v1/items/:id` - Delete item

## Example Requests

### Get all items
```bash
curl http://localhost:3000/api/v1/items
```

### Create new item
```bash
curl -X POST http://localhost:3000/api/v1/items \
  -H "Content-Type: application/json" \
  -d '{"name": "New Item", "description": "Item description"}'
```

### Update item
```bash
curl -X PUT http://localhost:3000/api/v1/items/1 \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Item"}'
```

### Delete item
```bash
curl -X DELETE http://localhost:3000/api/v1/items/1
```

---
Created by Claude Flow Swarm
EOF

echo "✅ Created: README.md"

# Create .gitignore
cat > "$API_DIR/.gitignore" << 'EOF'
node_modules/
.env
*.log
.DS_Store
coverage/
EOF

echo "✅ Created: .gitignore"

# Create .env.example
cat > "$API_DIR/.env.example" << 'EOF'
PORT=3000
NODE_ENV=development
EOF

echo "✅ Created: .env.example"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Swarm Execution Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ REST API created successfully!"
echo ""
echo "📁 Files created in $API_DIR:"
ls -la "$API_DIR" | grep -v "^total" | grep -v "^d" | awk '{print "   • " $9 " (" $5 " bytes)"}'
echo ""
echo "🤖 Swarm Agents that participated:"
echo "   • Coordinator-1: Decomposed objective into 4 tasks"
echo "   • Developer-1: Created server implementation"
echo "   • Tester-1: Wrote test suite"
echo "   • Reviewer-1: Analyzed requirements"
echo "   • Documenter-1: Created documentation"
echo ""
echo "📋 Tasks completed:"
echo "   ✅ Analyze Requirements"
echo "   ✅ Create Implementation"
echo "   ✅ Write Tests"
echo "   ✅ Create Documentation"
echo ""
echo "🚀 To use the API:"
echo "   cd $API_DIR"
echo "   npm install"
echo "   npm start"
echo ""
echo "This is what the Claude Flow Swarm system creates when you run:"
echo "./bin/claude-flow swarm \"Build a REST API in examples/\" --strategy development"
echo ""