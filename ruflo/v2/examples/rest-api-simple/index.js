const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// In-memory data store
let items = [
  { id: 1, name: 'Item 1', description: 'This is the first item' },
  { id: 2, name: 'Item 2', description: 'This is the second item' }
];
let nextId = 3;

// Routes
// GET all items
app.get('/api/items', (req, res) => {
  res.json(items);
});

// GET single item
app.get('/api/items/:id', (req, res) => {
  const item = items.find(i => i.id === parseInt(req.params.id));
  if (!item) {
    return res.status(404).json({ error: 'Item not found' });
  }
  res.json(item);
});

// POST new item
app.post('/api/items', (req, res) => {
  const { name, description } = req.body;
  if (!name || !description) {
    return res.status(400).json({ error: 'Name and description are required' });
  }
  
  const newItem = {
    id: nextId++,
    name,
    description
  };
  items.push(newItem);
  res.status(201).json(newItem);
});

// PUT update item
app.put('/api/items/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { name, description } = req.body;
  
  const itemIndex = items.findIndex(i => i.id === id);
  if (itemIndex === -1) {
    return res.status(404).json({ error: 'Item not found' });
  }
  
  items[itemIndex] = {
    id,
    name: name || items[itemIndex].name,
    description: description || items[itemIndex].description
  };
  
  res.json(items[itemIndex]);
});

// DELETE item
app.delete('/api/items/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const itemIndex = items.findIndex(i => i.id === id);
  
  if (itemIndex === -1) {
    return res.status(404).json({ error: 'Item not found' });
  }
  
  items.splice(itemIndex, 1);
  res.status(204).send();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Simple REST API',
    endpoints: {
      'GET /api/items': 'Get all items',
      'GET /api/items/:id': 'Get a single item',
      'POST /api/items': 'Create a new item',
      'PUT /api/items/:id': 'Update an item',
      'DELETE /api/items/:id': 'Delete an item',
      'GET /health': 'Health check'
    }
  });
});

// Start server
app.listen(port, () => {
  console.log(`Simple REST API server running on http://localhost:${port}`);
});