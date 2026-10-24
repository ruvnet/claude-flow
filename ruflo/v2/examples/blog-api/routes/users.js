const express = require('express');
const router = express.Router();

// In-memory storage (replace with database)
let users = [];
let nextId = 1;

// GET all users
router.get('/', (req, res) => {
  res.json(users);
});

// GET user by ID
router.get('/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// POST create user
router.post('/', (req, res) => {
  const user = {
    id: nextId++,
    ...req.body,
    createdAt: new Date()
  };
  users.push(user);
  res.status(201).json(user);
});

// PUT update user
router.put('/:id', (req, res) => {
  const index = users.findIndex(u => u.id === parseInt(req.params.id));
  if (index === -1) return res.status(404).json({ error: 'User not found' });
  
  users[index] = {
    ...users[index],
    ...req.body,
    updatedAt: new Date()
  };
  res.json(users[index]);
});

// DELETE user
router.delete('/:id', (req, res) => {
  const index = users.findIndex(u => u.id === parseInt(req.params.id));
  if (index === -1) return res.status(404).json({ error: 'User not found' });
  
  users.splice(index, 1);
  res.status(204).send();
});

module.exports = router;
