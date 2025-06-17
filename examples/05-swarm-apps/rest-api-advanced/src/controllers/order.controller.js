const Order = require('../models/order.model');
const Product = require('../models/product.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// Create new order
const createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, billingAddress, billingAddressSameAsShipping, paymentMethod, shippingMethod, discountCode, notes } = req.body;
  
  // Validate and prepare order items
  const orderItems = await Promise.all(
    items.map(async (item) => {
      const product = await Product.findById(item.product);
      
      if (!product) {
        throw new ApiError(404, `Product ${item.product} not found`);
      }
      
      if (!product.isAvailable) {
        throw new ApiError(400, `Product ${product.name} is not available`);
      }
      
      if (!product.checkAvailability(item.quantity)) {
        throw new ApiError(400, `Insufficient stock for ${product.name}. Available: ${product.inventory.quantity}`);
      }
      
      return {
        product: product._id,
        name: product.name,
        image: product.images.find(img => img.isMain)?.url || product.images[0]?.url,
        price: product.price,
        quantity: item.quantity,
        variant: item.variant,
      };
    })
  );
  
  // Calculate pricing
  const subtotal = orderItems.reduce((total, item) => total + (item.price * item.quantity), 0);
  const taxRate = 10; // 10% tax rate - in production, this would be calculated based on location
  const shippingAmount = calculateShipping(shippingMethod, subtotal);
  const discountAmount = await calculateDiscount(discountCode, subtotal);
  
  // Create order
  const order = await Order.create({
    user: req.user.id,
    items: orderItems,
    shippingAddress,
    billingAddress: billingAddressSameAsShipping ? shippingAddress : billingAddress,
    billingAddressSameAsShipping,
    payment: {
      method: paymentMethod,
      amount: subtotal + (subtotal * taxRate / 100) + shippingAmount - discountAmount,
      currency: 'USD',
    },
    shippingMethod,
    shippingAmount,
    taxRate,
    discountAmount,
    discountCode,
    notes: {
      customer: notes,
    },
    metadata: {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    },
  });
  
  // Update product inventory and sales count
  await Promise.all(
    orderItems.map(async (item) => {
      const product = await Product.findById(item.product);
      await product.updateInventory(item.quantity, 'decrement');
      product.salesCount += item.quantity;
      await product.save();
    })
  );
  
  // TODO: Process payment
  // In a real application, you would integrate with payment providers here
  
  // Populate order details for response
  await order.populate('user', 'name email');
  
  res.status(201).json({
    success: true,
    data: order,
  });
});

// Get user orders
const getUserOrders = asyncHandler(async (req, res) => {
  const filters = {
    userId: req.user.id,
    ...req.query,
  };
  
  const result = await Order.findOrders(filters);
  
  res.json({
    success: true,
    ...result,
  });
});

// Get all orders (admin only)
const getAllOrders = asyncHandler(async (req, res) => {
  const result = await Order.findOrders(req.query);
  
  res.json({
    success: true,
    ...result,
  });
});

// Get order by ID
const getOrder = asyncHandler(async (req, res) => {
  const query = { _id: req.params.id };
  
  // Non-admin users can only view their own orders
  if (req.user.role !== 'admin') {
    query.user = req.user.id;
  }
  
  const order = await Order.findOne(query)
    .populate('user', 'name email phone')
    .populate('items.product', 'name images slug');
  
  if (!order) {
    throw new ApiError(404, 'Order not found');
  }
  
  res.json({
    success: true,
    data: order,
  });
});

// Update order status (admin only)
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, comment } = req.body;
  
  const order = await Order.findById(req.params.id);
  if (!order) {
    throw new ApiError(404, 'Order not found');
  }
  
  await order.updateStatus(status, comment, req.user.id);
  
  // Send notification to user
  // TODO: Implement email/notification service
  
  res.json({
    success: true,
    message: `Order status updated to ${status}`,
    data: order,
  });
});

// Cancel order
const cancelOrder = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  
  const query = { _id: req.params.id };
  
  // Non-admin users can only cancel their own orders
  if (req.user.role !== 'admin') {
    query.user = req.user.id;
  }
  
  const order = await Order.findOne(query);
  if (!order) {
    throw new ApiError(404, 'Order not found');
  }
  
  await order.cancel(reason, req.user.id);
  
  // Restore inventory
  await Promise.all(
    order.items.map(async (item) => {
      const product = await Product.findById(item.product);
      if (product) {
        await product.updateInventory(item.quantity, 'increment');
        product.salesCount = Math.max(0, product.salesCount - item.quantity);
        await product.save();
      }
    })
  );
  
  res.json({
    success: true,
    message: 'Order cancelled successfully',
    data: order,
  });
});

// Add tracking information (admin only)
const addTracking = asyncHandler(async (req, res) => {
  const { carrier, number, url, estimatedDelivery } = req.body;
  
  const order = await Order.findById(req.params.id);
  if (!order) {
    throw new ApiError(404, 'Order not found');
  }
  
  await order.addTracking(carrier, number, url, estimatedDelivery);
  
  // Update status to shipped if not already
  if (order.status === 'processing') {
    await order.updateStatus('shipped', 'Tracking information added', req.user.id);
  }
  
  res.json({
    success: true,
    message: 'Tracking information added',
    data: order.tracking,
  });
});

// Process refund (admin only)
const processRefund = asyncHandler(async (req, res) => {
  const { amount, reason } = req.body;
  
  const order = await Order.findById(req.params.id);
  if (!order) {
    throw new ApiError(404, 'Order not found');
  }
  
  await order.processRefund(amount, reason, req.user.id);
  
  // TODO: Process actual refund through payment provider
  
  res.json({
    success: true,
    message: 'Refund processed successfully',
    data: {
      refundedAmount: order.payment.refundedAmount,
      paymentStatus: order.payment.status,
      orderStatus: order.status,
    },
  });
});

// Get order statistics
const getOrderStatistics = asyncHandler(async (req, res) => {
  const { period = 'month' } = req.query;
  const userId = req.user.role === 'admin' ? null : req.user.id;
  
  const stats = await Order.getStatistics(userId, period);
  
  res.json({
    success: true,
    data: stats,
  });
});

// Get sales report (admin only)
const getSalesReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, groupBy = 'day' } = req.query;
  
  if (!startDate || !endDate) {
    throw new ApiError(400, 'Start date and end date are required');
  }
  
  const report = await Order.getSalesReport(startDate, endDate, groupBy);
  
  res.json({
    success: true,
    data: report,
  });
});

// Add internal note (admin only)
const addInternalNote = asyncHandler(async (req, res) => {
  const { note } = req.body;
  
  const order = await Order.findById(req.params.id);
  if (!order) {
    throw new ApiError(404, 'Order not found');
  }
  
  order.notes.internal = note;
  await order.save();
  
  res.json({
    success: true,
    message: 'Internal note added',
  });
});

// Get order invoice
const getOrderInvoice = asyncHandler(async (req, res) => {
  const query = { _id: req.params.id };
  
  // Non-admin users can only view their own order invoices
  if (req.user.role !== 'admin') {
    query.user = req.user.id;
  }
  
  const order = await Order.findOne(query)
    .populate('user', 'name email phone address')
    .populate('items.product', 'name sku');
  
  if (!order) {
    throw new ApiError(404, 'Order not found');
  }
  
  // In a real application, you would generate a PDF invoice here
  const invoice = {
    orderNumber: order.orderNumber,
    date: order.createdAt,
    customer: {
      name: order.user.name,
      email: order.user.email,
      phone: order.user.phone,
      billingAddress: order.billingAddress,
    },
    items: order.items.map(item => ({
      name: item.name,
      sku: item.product?.sku,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.subtotal,
    })),
    subtotal: order.subtotal,
    tax: order.taxAmount,
    shipping: order.shippingAmount,
    discount: order.discountAmount,
    total: order.totalAmount,
    paymentMethod: order.payment.method,
    paymentStatus: order.payment.status,
  };
  
  res.json({
    success: true,
    data: invoice,
  });
});

// Export orders (admin only)
const exportOrders = asyncHandler(async (req, res) => {
  const { format = 'json', ...filters } = req.query;
  
  const result = await Order.findOrders({ ...filters, limit: 1000 });
  
  if (format === 'csv') {
    // In a real application, you would convert to CSV format
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
    // TODO: Implement CSV conversion
    res.send('CSV export not implemented yet');
  } else {
    res.json({
      success: true,
      count: result.orders.length,
      data: result.orders,
    });
  }
});

// Helper function to calculate shipping
function calculateShipping(method, subtotal) {
  const rates = {
    standard: subtotal > 50 ? 0 : 5.99,
    express: 14.99,
    overnight: 29.99,
    pickup: 0,
  };
  
  return rates[method] || rates.standard;
}

// Helper function to calculate discount
async function calculateDiscount(code, subtotal) {
  if (!code) return 0;
  
  // In a real application, you would validate the discount code
  // against a discounts collection
  const discounts = {
    'SAVE10': { type: 'percentage', value: 10 },
    'SAVE20': { type: 'percentage', value: 20 },
    'SHIP5': { type: 'fixed', value: 5 },
  };
  
  const discount = discounts[code];
  if (!discount) return 0;
  
  if (discount.type === 'percentage') {
    return subtotal * (discount.value / 100);
  } else {
    return Math.min(discount.value, subtotal);
  }
}

module.exports = {
  createOrder,
  getUserOrders,
  getAllOrders,
  getOrder,
  updateOrderStatus,
  cancelOrder,
  addTracking,
  processRefund,
  getOrderStatistics,
  getSalesReport,
  addInternalNote,
  getOrderInvoice,
  exportOrders,
};