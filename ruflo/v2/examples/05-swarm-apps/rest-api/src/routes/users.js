const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const usersController = require('../controllers/usersController');

// Validation middleware
const validateUser = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').trim().isEmail().withMessage('Valid email is required'),
  body('age').optional().isInt({ min: 0, max: 120 }).withMessage('Age must be between 0 and 120')
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Routes
router.get('/', usersController.getAllUsers);
router.get('/:id', usersController.getUserById);
router.post('/', validateUser, handleValidationErrors, usersController.createUser);
router.put('/:id', validateUser, handleValidationErrors, usersController.updateUser);
router.delete('/:id', usersController.deleteUser);

module.exports = router;