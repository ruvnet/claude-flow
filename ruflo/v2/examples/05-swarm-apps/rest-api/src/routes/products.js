const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const productsController = require('../controllers/productsController');

// Validation middleware
const validateProduct = [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be a non-negative integer')
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Routes
router.get('/', productsController.getAllProducts);
router.get('/:id', productsController.getProductById);
router.post('/', validateProduct, handleValidationErrors, productsController.createProduct);
router.put('/:id', validateProduct, handleValidationErrors, productsController.updateProduct);
router.delete('/:id', productsController.deleteProduct);

module.exports = router;