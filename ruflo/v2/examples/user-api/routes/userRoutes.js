const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const { validateUser, validateUserUpdate } = require('../middleware/validation');

router.get('/', (req, res) => {
  const users = userService.getAllUsers();
  res.json(users);
});

router.get('/:id', (req, res, next) => {
  try {
    const user = userService.getUserById(req.params.id);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.post('/', validateUser, (req, res, next) => {
  try {
    const user = userService.createUser(req.body);
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', validateUserUpdate, (req, res, next) => {
  try {
    const user = userService.updateUser(req.params.id, req.body);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', validateUserUpdate, (req, res, next) => {
  try {
    const user = userService.updateUser(req.params.id, req.body);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const result = userService.deleteUser(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;