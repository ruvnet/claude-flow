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
    swarmId: 'swarm_aipkebfuq_nexjqmitd',
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
