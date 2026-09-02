const express = require('express');
const router = express.Router();
const { validationResult } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const productController = require('../controllers/product.controller');
const {
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
} = require('../validators/product.validator');

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * @swagger
 * components:
 *   schemas:
 *     Product:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         price:
 *           type: number
 *         category:
 *           type: string
 *         stock:
 *           type: integer
 *         images:
 *           type: array
 *           items:
 *             type: string
 *         isActive:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Get all products
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [price, -price, name, -name, createdAt, -createdAt]
 *     responses:
 *       200:
 *         description: List of products
 */
router.get('/', searchProductsValidation, validate, productController.getProducts);

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Get product by ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product details
 *       404:
 *         description: Product not found
 */
router.get('/:id', productIdValidation, validate, productController.getProduct);

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create new product (admin only)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - price
 *               - category
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               category:
 *                 type: string
 *               stock:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Product created successfully
 */
router.post('/', authenticate, authorize('admin'), createProductValidation, validate, productController.createProduct);

/**
 * @swagger
 * /api/products/{id}:
 *   put:
 *     summary: Update product (admin only)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               category:
 *                 type: string
 *               stock:
 *                 type: integer
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Product updated successfully
 */
router.put('/:id', authenticate, authorize('admin'), updateProductValidation, validate, productController.updateProduct);

/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: Delete product (admin only)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product deleted successfully
 *       404:
 *         description: Product not found
 */
router.delete('/:id', authenticate, authorize('admin'), productIdValidation, validate, productController.deleteProduct);

/**
 * @swagger
 * /api/products/{id}/images:
 *   post:
 *     summary: Upload product images
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Images uploaded successfully
 */
router.post('/:id/images', authenticate, authorize('admin'), uploadImagesValidation, validate, productController.uploadImages);

// Additional routes
router.get('/category/:category', productController.getProductsByCategory);
router.get('/featured', productController.getFeaturedProducts);
router.get('/popular', productController.getPopularProducts);
router.get('/:id/related', productIdValidation, validate, productController.getRelatedProducts);

// Review routes
router.post('/:id/reviews', authenticate, addReviewValidation, validate, productController.addReview);
router.put('/:id/reviews', authenticate, updateReviewValidation, validate, productController.updateReview);
router.delete('/:id/reviews', authenticate, productIdValidation, validate, productController.deleteReview);
router.post('/:productId/reviews/:reviewId/helpful', authenticate, markReviewHelpfulValidation, validate, productController.markReviewHelpful);

// Inventory routes
router.put('/:id/inventory', authenticate, authorize('admin'), updateInventoryValidation, validate, productController.updateInventory);
router.put('/inventory/bulk', authenticate, authorize('admin'), bulkUpdateInventoryValidation, validate, productController.bulkUpdateInventory);
router.get('/inventory/report', authenticate, authorize('admin'), productController.getInventoryReport);

// Category routes
router.get('/categories/list', productController.getCategories);

// Image management
router.delete('/:id/images/:imageId', authenticate, authorize('admin'), productController.deleteImage);

// Export
router.get('/export/data', authenticate, authorize('admin'), productController.exportProducts);

module.exports = router;