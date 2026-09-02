const express = require('express');
const router = express.Router();
const { validationResult } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const orderController = require('../controllers/order.controller');
const {
  createOrderValidation,
  updateOrderStatusValidation,
  cancelOrderValidation,
  addTrackingValidation,
  processRefundValidation,
  orderIdValidation,
  searchOrdersValidation,
  orderStatisticsValidation,
  salesReportValidation,
  addInternalNoteValidation,
  exportOrdersValidation,
} = require('../validators/order.validator');

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
 *     Order:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         user:
 *           type: string
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               product:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               price:
 *                 type: number
 *         totalAmount:
 *           type: number
 *         status:
 *           type: string
 *           enum: [pending, processing, shipped, delivered, cancelled]
 *         shippingAddress:
 *           type: object
 *         paymentMethod:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: Get user orders
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, processing, shipped, delivered, cancelled]
 *     responses:
 *       200:
 *         description: List of orders
 */
router.get('/', authenticate, searchOrdersValidation, validate, orderController.getUserOrders);

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     summary: Get order by ID
 *     tags: [Orders]
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
 *         description: Order details
 *       404:
 *         description: Order not found
 */
router.get('/:id', authenticate, orderIdValidation, validate, orderController.getOrder);

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Create new order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *               - shippingAddress
 *               - paymentMethod
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     product:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *               shippingAddress:
 *                 type: object
 *                 properties:
 *                   street:
 *                     type: string
 *                   city:
 *                     type: string
 *                   state:
 *                     type: string
 *                   zipCode:
 *                     type: string
 *                   country:
 *                     type: string
 *               paymentMethod:
 *                 type: string
 *                 enum: [credit_card, debit_card, paypal, stripe]
 *     responses:
 *       201:
 *         description: Order created successfully
 */
router.post('/', authenticate, createOrderValidation, validate, orderController.createOrder);

/**
 * @swagger
 * /api/orders/{id}/status:
 *   put:
 *     summary: Update order status (admin only)
 *     tags: [Orders]
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
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, processing, shipped, delivered, cancelled]
 *     responses:
 *       200:
 *         description: Order status updated
 */
router.put('/:id/status', authenticate, authorize('admin'), updateOrderStatusValidation, validate, orderController.updateOrderStatus);

/**
 * @swagger
 * /api/orders/{id}:
 *   delete:
 *     summary: Cancel order
 *     tags: [Orders]
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
 *         description: Order cancelled successfully
 *       400:
 *         description: Order cannot be cancelled
 */
router.delete('/:id', authenticate, cancelOrderValidation, validate, orderController.cancelOrder);

// Admin routes
router.get('/admin/all', authenticate, authorize('admin'), searchOrdersValidation, validate, orderController.getAllOrders);
router.post('/:id/tracking', authenticate, authorize('admin'), addTrackingValidation, validate, orderController.addTracking);
router.post('/:id/refund', authenticate, authorize('admin'), processRefundValidation, validate, orderController.processRefund);
router.post('/:id/note', authenticate, authorize('admin'), addInternalNoteValidation, validate, orderController.addInternalNote);

// Statistics and reports
router.get('/statistics/summary', authenticate, orderStatisticsValidation, validate, orderController.getOrderStatistics);
router.get('/reports/sales', authenticate, authorize('admin'), salesReportValidation, validate, orderController.getSalesReport);

// Invoice
router.get('/:id/invoice', authenticate, orderIdValidation, validate, orderController.getOrderInvoice);

// Export
router.get('/export/data', authenticate, authorize('admin'), exportOrdersValidation, validate, orderController.exportOrders);

module.exports = router;