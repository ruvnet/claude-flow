const { body, param, query } = require('express-validator');

const createProductValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Product name is required')
    .isLength({ min: 3, max: 200 }).withMessage('Name must be between 3 and 200 characters'),
  
  body('description')
    .trim()
    .notEmpty().withMessage('Product description is required')
    .isLength({ min: 10, max: 2000 }).withMessage('Description must be between 10 and 2000 characters'),
  
  body('price')
    .notEmpty().withMessage('Price is required')
    .isFloat({ min: 0 }).withMessage('Price must be a positive number')
    .toFloat(),
  
  body('comparePrice')
    .optional()
    .isFloat({ min: 0 }).withMessage('Compare price must be a positive number')
    .toFloat()
    .custom((value, { req }) => {
      if (value && value <= req.body.price) {
        throw new Error('Compare price must be greater than regular price');
      }
      return true;
    }),
  
  body('category')
    .trim()
    .notEmpty().withMessage('Category is required'),
  
  body('subcategory')
    .optional()
    .trim(),
  
  body('brand')
    .optional()
    .trim(),
  
  body('sku')
    .optional()
    .trim()
    .toUpperCase(),
  
  body('barcode')
    .optional()
    .trim(),
  
  body('inventory.quantity')
    .optional()
    .isInt({ min: 0 }).withMessage('Quantity must be a non-negative integer')
    .toInt(),
  
  body('inventory.trackInventory')
    .optional()
    .isBoolean().withMessage('Track inventory must be a boolean')
    .toBoolean(),
  
  body('inventory.allowBackorder')
    .optional()
    .isBoolean().withMessage('Allow backorder must be a boolean')
    .toBoolean(),
  
  body('inventory.lowStockThreshold')
    .optional()
    .isInt({ min: 0 }).withMessage('Low stock threshold must be a non-negative integer')
    .toInt(),
  
  body('images')
    .optional()
    .isArray().withMessage('Images must be an array'),
  
  body('images.*.url')
    .notEmpty().withMessage('Image URL is required')
    .isURL().withMessage('Invalid image URL'),
  
  body('images.*.alt')
    .optional()
    .trim(),
  
  body('tags')
    .optional()
    .isArray().withMessage('Tags must be an array'),
  
  body('tags.*')
    .trim()
    .toLowerCase(),
  
  body('specifications')
    .optional()
    .isArray().withMessage('Specifications must be an array'),
  
  body('specifications.*.key')
    .trim()
    .notEmpty().withMessage('Specification key is required'),
  
  body('specifications.*.value')
    .trim()
    .notEmpty().withMessage('Specification value is required'),
  
  body('status')
    .optional()
    .isIn(['active', 'inactive', 'draft', 'archived']).withMessage('Invalid status'),
  
  body('visibility')
    .optional()
    .isIn(['visible', 'hidden', 'catalog', 'search']).withMessage('Invalid visibility'),
  
  body('featured')
    .optional()
    .isBoolean().withMessage('Featured must be a boolean')
    .toBoolean(),
];

const updateProductValidation = [
  param('id')
    .isMongoId().withMessage('Invalid product ID'),
  
  body('name')
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 }).withMessage('Name must be between 3 and 200 characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ min: 10, max: 2000 }).withMessage('Description must be between 10 and 2000 characters'),
  
  body('price')
    .optional()
    .isFloat({ min: 0 }).withMessage('Price must be a positive number')
    .toFloat(),
  
  body('comparePrice')
    .optional()
    .isFloat({ min: 0 }).withMessage('Compare price must be a positive number')
    .toFloat()
    .custom((value, { req }) => {
      if (value && req.body.price && value <= req.body.price) {
        throw new Error('Compare price must be greater than regular price');
      }
      return true;
    }),
  
  body('category')
    .optional()
    .trim(),
  
  body('status')
    .optional()
    .isIn(['active', 'inactive', 'draft', 'archived']).withMessage('Invalid status'),
  
  body('visibility')
    .optional()
    .isIn(['visible', 'hidden', 'catalog', 'search']).withMessage('Invalid visibility'),
];

const productIdValidation = [
  param('id')
    .isMongoId().withMessage('Invalid product ID'),
];

const searchProductsValidation = [
  query('q')
    .optional()
    .trim(),
  
  query('category')
    .optional()
    .trim(),
  
  query('subcategory')
    .optional()
    .trim(),
  
  query('brand')
    .optional()
    .trim(),
  
  query('minPrice')
    .optional()
    .isFloat({ min: 0 }).withMessage('Minimum price must be a positive number')
    .toFloat(),
  
  query('maxPrice')
    .optional()
    .isFloat({ min: 0 }).withMessage('Maximum price must be a positive number')
    .toFloat()
    .custom((value, { req }) => {
      if (value && req.query.minPrice && value < req.query.minPrice) {
        throw new Error('Maximum price must be greater than minimum price');
      }
      return true;
    }),
  
  query('tags')
    .optional()
    .customSanitizer(value => {
      if (typeof value === 'string') {
        return value.split(',').map(tag => tag.trim().toLowerCase());
      }
      return value;
    }),
  
  query('inStock')
    .optional()
    .isBoolean().withMessage('In stock must be a boolean')
    .toBoolean(),
  
  query('featured')
    .optional()
    .isBoolean().withMessage('Featured must be a boolean')
    .toBoolean(),
  
  query('minRating')
    .optional()
    .isFloat({ min: 0, max: 5 }).withMessage('Minimum rating must be between 0 and 5')
    .toFloat(),
  
  query('sort')
    .optional()
    .isIn(['price', '-price', 'name', '-name', 'createdAt', '-createdAt', 'rating', '-rating'])
    .withMessage('Invalid sort option'),
  
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer')
    .toInt(),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
    .toInt(),
];

const addReviewValidation = [
  param('id')
    .isMongoId().withMessage('Invalid product ID'),
  
  body('rating')
    .notEmpty().withMessage('Rating is required')
    .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5')
    .toInt(),
  
  body('comment')
    .trim()
    .notEmpty().withMessage('Review comment is required')
    .isLength({ max: 500 }).withMessage('Comment cannot exceed 500 characters'),
  
  body('images')
    .optional()
    .isArray().withMessage('Images must be an array')
    .custom(images => images.length <= 5).withMessage('Maximum 5 images allowed'),
  
  body('images.*')
    .isURL().withMessage('Invalid image URL'),
];

const updateReviewValidation = [
  param('id')
    .isMongoId().withMessage('Invalid product ID'),
  
  body('rating')
    .optional()
    .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5')
    .toInt(),
  
  body('comment')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Comment cannot exceed 500 characters'),
  
  body('images')
    .optional()
    .isArray().withMessage('Images must be an array')
    .custom(images => images.length <= 5).withMessage('Maximum 5 images allowed'),
];

const markReviewHelpfulValidation = [
  param('productId')
    .isMongoId().withMessage('Invalid product ID'),
  
  param('reviewId')
    .isMongoId().withMessage('Invalid review ID'),
  
  body('helpful')
    .notEmpty().withMessage('Helpful value is required')
    .isBoolean().withMessage('Helpful must be a boolean')
    .toBoolean(),
];

const updateInventoryValidation = [
  param('id')
    .isMongoId().withMessage('Invalid product ID'),
  
  body('quantity')
    .notEmpty().withMessage('Quantity is required')
    .isInt({ min: 0 }).withMessage('Quantity must be a non-negative integer')
    .toInt(),
  
  body('operation')
    .optional()
    .isIn(['set', 'increment', 'decrement']).withMessage('Invalid operation'),
];

const bulkUpdateInventoryValidation = [
  body('updates')
    .notEmpty().withMessage('Updates array is required')
    .isArray().withMessage('Updates must be an array'),
  
  body('updates.*.productId')
    .isMongoId().withMessage('Invalid product ID'),
  
  body('updates.*.quantity')
    .isInt({ min: 0 }).withMessage('Quantity must be a non-negative integer')
    .toInt(),
  
  body('updates.*.operation')
    .optional()
    .isIn(['set', 'increment', 'decrement']).withMessage('Invalid operation'),
];

const uploadImagesValidation = [
  param('id')
    .isMongoId().withMessage('Invalid product ID'),
  
  body('images')
    .notEmpty().withMessage('Images array is required')
    .isArray().withMessage('Images must be an array')
    .custom(images => images.length <= 10).withMessage('Maximum 10 images can be uploaded at once'),
  
  body('images.*.url')
    .notEmpty().withMessage('Image URL is required')
    .isURL().withMessage('Invalid image URL'),
  
  body('images.*.alt')
    .optional()
    .trim(),
];

module.exports = {
  createProductValidation,
  updateProductValidation,
  productIdValidation,
  searchProductsValidation,
  addReviewValidation,
  updateReviewValidation,
  markReviewHelpfulValidation,
  updateInventoryValidation,
  bulkUpdateInventoryValidation,
  uploadImagesValidation,
};