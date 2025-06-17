const { body, param, query } = require('express-validator');

const createOrderValidation = [
  body('items')
    .notEmpty().withMessage('Order items are required')
    .isArray({ min: 1 }).withMessage('Order must have at least one item'),
  
  body('items.*.product')
    .notEmpty().withMessage('Product ID is required')
    .isMongoId().withMessage('Invalid product ID'),
  
  body('items.*.quantity')
    .notEmpty().withMessage('Quantity is required')
    .isInt({ min: 1 }).withMessage('Quantity must be at least 1')
    .toInt(),
  
  body('items.*.variant')
    .optional()
    .isObject().withMessage('Variant must be an object'),
  
  body('shippingAddress')
    .notEmpty().withMessage('Shipping address is required')
    .isObject().withMessage('Shipping address must be an object'),
  
  body('shippingAddress.fullName')
    .trim()
    .notEmpty().withMessage('Full name is required'),
  
  body('shippingAddress.phone')
    .trim()
    .notEmpty().withMessage('Phone number is required')
    .matches(/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/)
    .withMessage('Invalid phone number'),
  
  body('shippingAddress.email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email address')
    .normalizeEmail(),
  
  body('shippingAddress.street')
    .trim()
    .notEmpty().withMessage('Street address is required'),
  
  body('shippingAddress.apartment')
    .optional()
    .trim(),
  
  body('shippingAddress.city')
    .trim()
    .notEmpty().withMessage('City is required'),
  
  body('shippingAddress.state')
    .trim()
    .notEmpty().withMessage('State is required'),
  
  body('shippingAddress.zipCode')
    .trim()
    .notEmpty().withMessage('Zip code is required'),
  
  body('shippingAddress.country')
    .trim()
    .notEmpty().withMessage('Country is required'),
  
  body('shippingAddress.instructions')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Instructions cannot exceed 500 characters'),
  
  body('billingAddressSameAsShipping')
    .optional()
    .isBoolean().withMessage('Billing address same as shipping must be a boolean')
    .toBoolean(),
  
  body('billingAddress')
    .if(body('billingAddressSameAsShipping').equals(false))
    .notEmpty().withMessage('Billing address is required when different from shipping')
    .isObject().withMessage('Billing address must be an object'),
  
  body('paymentMethod')
    .notEmpty().withMessage('Payment method is required')
    .isIn(['credit_card', 'debit_card', 'paypal', 'stripe', 'cash_on_delivery', 'bank_transfer'])
    .withMessage('Invalid payment method'),
  
  body('shippingMethod')
    .optional()
    .isIn(['standard', 'express', 'overnight', 'pickup'])
    .withMessage('Invalid shipping method'),
  
  body('discountCode')
    .optional()
    .trim()
    .toUpperCase(),
  
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters'),
];

const updateOrderStatusValidation = [
  param('id')
    .isMongoId().withMessage('Invalid order ID'),
  
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'])
    .withMessage('Invalid order status'),
  
  body('comment')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Comment cannot exceed 500 characters'),
];

const cancelOrderValidation = [
  param('id')
    .isMongoId().withMessage('Invalid order ID'),
  
  body('reason')
    .trim()
    .notEmpty().withMessage('Cancellation reason is required')
    .isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters'),
];

const addTrackingValidation = [
  param('id')
    .isMongoId().withMessage('Invalid order ID'),
  
  body('carrier')
    .trim()
    .notEmpty().withMessage('Carrier is required'),
  
  body('number')
    .trim()
    .notEmpty().withMessage('Tracking number is required'),
  
  body('url')
    .optional()
    .trim()
    .isURL().withMessage('Invalid tracking URL'),
  
  body('estimatedDelivery')
    .optional()
    .isISO8601().withMessage('Invalid date format')
    .toDate(),
];

const processRefundValidation = [
  param('id')
    .isMongoId().withMessage('Invalid order ID'),
  
  body('amount')
    .notEmpty().withMessage('Refund amount is required')
    .isFloat({ min: 0.01 }).withMessage('Refund amount must be greater than 0')
    .toFloat(),
  
  body('reason')
    .trim()
    .notEmpty().withMessage('Refund reason is required')
    .isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters'),
];

const orderIdValidation = [
  param('id')
    .isMongoId().withMessage('Invalid order ID'),
];

const searchOrdersValidation = [
  query('status')
    .optional()
    .isIn(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'])
    .withMessage('Invalid order status'),
  
  query('paymentStatus')
    .optional()
    .isIn(['pending', 'processing', 'completed', 'failed', 'refunded', 'partially_refunded'])
    .withMessage('Invalid payment status'),
  
  query('startDate')
    .optional()
    .isISO8601().withMessage('Invalid start date format')
    .toDate(),
  
  query('endDate')
    .optional()
    .isISO8601().withMessage('Invalid end date format')
    .toDate()
    .custom((value, { req }) => {
      if (value && req.query.startDate && value < req.query.startDate) {
        throw new Error('End date must be after start date');
      }
      return true;
    }),
  
  query('minAmount')
    .optional()
    .isFloat({ min: 0 }).withMessage('Minimum amount must be a positive number')
    .toFloat(),
  
  query('maxAmount')
    .optional()
    .isFloat({ min: 0 }).withMessage('Maximum amount must be a positive number')
    .toFloat()
    .custom((value, { req }) => {
      if (value && req.query.minAmount && value < req.query.minAmount) {
        throw new Error('Maximum amount must be greater than minimum amount');
      }
      return true;
    }),
  
  query('orderNumber')
    .optional()
    .trim(),
  
  query('trackingNumber')
    .optional()
    .trim(),
  
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer')
    .toInt(),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
    .toInt(),
  
  query('sort')
    .optional()
    .matches(/^-?(createdAt|totalAmount|status)$/).withMessage('Invalid sort option'),
];

const orderStatisticsValidation = [
  query('period')
    .optional()
    .isIn(['all', 'today', 'week', 'month', 'year'])
    .withMessage('Invalid period'),
];

const salesReportValidation = [
  query('startDate')
    .notEmpty().withMessage('Start date is required')
    .isISO8601().withMessage('Invalid start date format')
    .toDate(),
  
  query('endDate')
    .notEmpty().withMessage('End date is required')
    .isISO8601().withMessage('Invalid end date format')
    .toDate()
    .custom((value, { req }) => {
      if (value && req.query.startDate && value < req.query.startDate) {
        throw new Error('End date must be after start date');
      }
      return true;
    }),
  
  query('groupBy')
    .optional()
    .isIn(['day', 'week', 'month', 'year'])
    .withMessage('Invalid grouping option'),
];

const addInternalNoteValidation = [
  param('id')
    .isMongoId().withMessage('Invalid order ID'),
  
  body('note')
    .trim()
    .notEmpty().withMessage('Note is required')
    .isLength({ max: 1000 }).withMessage('Note cannot exceed 1000 characters'),
];

const exportOrdersValidation = [
  query('format')
    .optional()
    .isIn(['json', 'csv'])
    .withMessage('Invalid export format'),
  
  ...searchOrdersValidation,
];

module.exports = {
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
};