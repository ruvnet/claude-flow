const Order = require('../models/order.model');
const Product = require('../models/product.model');
const ApiError = require('../utils/ApiError');
const redis = require('../config/redis');

class OrderService {
  /**
   * Calculate order totals
   */
  static calculateOrderTotals(items, taxRate, shippingAmount, discountAmount) {
    const subtotal = items.reduce((total, item) => total + (item.price * item.quantity), 0);
    const taxAmount = subtotal * (taxRate / 100);
    const totalAmount = subtotal + taxAmount + shippingAmount - discountAmount;
    
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
    };
  }
  
  /**
   * Validate discount code
   */
  static async validateDiscountCode(code, subtotal, userId) {
    // In a real application, this would check against a discounts collection
    const discounts = {
      'WELCOME10': { 
        type: 'percentage', 
        value: 10, 
        minPurchase: 0,
        maxUses: 1,
        validUntil: new Date('2025-12-31'),
      },
      'SAVE20': { 
        type: 'percentage', 
        value: 20, 
        minPurchase: 100,
        maxUses: null,
        validUntil: new Date('2025-12-31'),
      },
      'FREESHIP': { 
        type: 'fixed', 
        value: 10, 
        minPurchase: 50,
        maxUses: null,
        validUntil: new Date('2025-12-31'),
      },
    };
    
    const discount = discounts[code];
    if (!discount) {
      throw new ApiError(400, 'Invalid discount code');
    }
    
    // Check validity
    if (discount.validUntil < new Date()) {
      throw new ApiError(400, 'Discount code has expired');
    }
    
    // Check minimum purchase
    if (subtotal < discount.minPurchase) {
      throw new ApiError(400, `Minimum purchase of $${discount.minPurchase} required for this discount`);
    }
    
    // Check usage limit (would check against database in real app)
    // For now, we'll skip this check
    
    // Calculate discount amount
    let discountAmount = 0;
    if (discount.type === 'percentage') {
      discountAmount = subtotal * (discount.value / 100);
    } else {
      discountAmount = Math.min(discount.value, subtotal);
    }
    
    return {
      code,
      discountAmount: Math.round(discountAmount * 100) / 100,
      description: `${discount.value}${discount.type === 'percentage' ? '%' : '$'} off`,
    };
  }
  
  /**
   * Reserve inventory for order
   */
  static async reserveInventory(items) {
    const reservations = [];
    
    try {
      for (const item of items) {
        const product = await Product.findById(item.product);
        
        if (!product) {
          throw new ApiError(404, `Product ${item.product} not found`);
        }
        
        if (!product.checkAvailability(item.quantity)) {
          throw new ApiError(400, `Insufficient stock for ${product.name}`);
        }
        
        // Reserve inventory
        await product.updateInventory(item.quantity, 'decrement');
        reservations.push({ productId: item.product, quantity: item.quantity });
      }
      
      return reservations;
    } catch (error) {
      // Rollback reservations on error
      await this.releaseInventory(reservations);
      throw error;
    }
  }
  
  /**
   * Release reserved inventory
   */
  static async releaseInventory(reservations) {
    await Promise.all(
      reservations.map(async ({ productId, quantity }) => {
        const product = await Product.findById(productId);
        if (product) {
          await product.updateInventory(quantity, 'increment');
        }
      })
    );
  }
  
  /**
   * Process payment
   */
  static async processPayment(paymentDetails) {
    // In a real application, this would integrate with payment providers
    // For now, we'll simulate payment processing
    
    const { method, amount, currency } = paymentDetails;
    
    // Simulate payment processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Simulate 95% success rate
    const success = Math.random() > 0.05;
    
    if (!success) {
      throw new ApiError(400, 'Payment processing failed. Please try again.');
    }
    
    return {
      transactionId: `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'completed',
      amount,
      currency,
      processedAt: new Date(),
    };
  }
  
  /**
   * Send order confirmation email
   */
  static async sendOrderConfirmation(order) {
    // In a real application, this would send an actual email
    console.log(`Sending order confirmation email for order ${order.orderNumber}`);
    
    // Cache email template
    const cacheKey = `email:order-confirmation:${order._id}`;
    await redis.setex(cacheKey, 3600, JSON.stringify({
      to: order.shippingAddress.email,
      subject: `Order Confirmation - ${order.orderNumber}`,
      sentAt: new Date(),
    }));
  }
  
  /**
   * Calculate shipping estimates
   */
  static async calculateShippingEstimates(shippingAddress, items) {
    // In a real application, this would integrate with shipping providers
    const baseDate = new Date();
    
    const estimates = {
      standard: {
        cost: 5.99,
        estimatedDays: 5-7,
        estimatedDelivery: new Date(baseDate.setDate(baseDate.getDate() + 7)),
      },
      express: {
        cost: 14.99,
        estimatedDays: 2-3,
        estimatedDelivery: new Date(baseDate.setDate(baseDate.getDate() + 3)),
      },
      overnight: {
        cost: 29.99,
        estimatedDays: 1,
        estimatedDelivery: new Date(baseDate.setDate(baseDate.getDate() + 1)),
      },
      pickup: {
        cost: 0,
        estimatedDays: 0,
        estimatedDelivery: null,
      },
    };
    
    // Free standard shipping for orders over $50
    const subtotal = items.reduce((total, item) => total + (item.price * item.quantity), 0);
    if (subtotal > 50) {
      estimates.standard.cost = 0;
    }
    
    return estimates;
  }
  
  /**
   * Get order timeline
   */
  static async getOrderTimeline(orderId) {
    const order = await Order.findById(orderId);
    if (!order) {
      throw new ApiError(404, 'Order not found');
    }
    
    const timeline = [
      {
        status: 'created',
        timestamp: order.createdAt,
        description: 'Order placed',
      },
    ];
    
    // Add history entries
    order.history.forEach(entry => {
      timeline.push({
        status: entry.status,
        timestamp: entry.timestamp,
        description: entry.comment || `Order ${entry.status}`,
        updatedBy: entry.updatedBy,
      });
    });
    
    // Add payment events
    if (order.payment.paidAt) {
      timeline.push({
        status: 'payment_completed',
        timestamp: order.payment.paidAt,
        description: 'Payment processed successfully',
      });
    }
    
    // Add shipping events
    if (order.tracking?.shippedAt) {
      timeline.push({
        status: 'shipped',
        timestamp: order.tracking.shippedAt,
        description: `Shipped via ${order.tracking.carrier}`,
        trackingNumber: order.tracking.number,
      });
    }
    
    if (order.tracking?.deliveredAt) {
      timeline.push({
        status: 'delivered',
        timestamp: order.tracking.deliveredAt,
        description: 'Package delivered',
      });
    }
    
    // Sort by timestamp
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    return timeline;
  }
  
  /**
   * Get customer order history
   */
  static async getCustomerOrderHistory(userId) {
    const orders = await Order.find({ user: userId })
      .sort('-createdAt')
      .select('orderNumber status totalAmount createdAt items')
      .limit(10);
    
    const stats = await Order.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' },
          averageOrderValue: { $avg: '$totalAmount' },
          firstOrderDate: { $min: '$createdAt' },
          lastOrderDate: { $max: '$createdAt' },
        },
      },
    ]);
    
    return {
      recentOrders: orders,
      statistics: stats[0] || {
        totalOrders: 0,
        totalSpent: 0,
        averageOrderValue: 0,
        firstOrderDate: null,
        lastOrderDate: null,
      },
    };
  }
  
  /**
   * Check fraud risk
   */
  static async checkFraudRisk(orderData) {
    const riskFactors = [];
    let riskScore = 0;
    
    // Check for high-value first order
    if (orderData.totalAmount > 500) {
      const previousOrders = await Order.countDocuments({ user: orderData.user });
      if (previousOrders === 0) {
        riskFactors.push('High value first order');
        riskScore += 30;
      }
    }
    
    // Check shipping/billing address mismatch
    if (!orderData.billingAddressSameAsShipping) {
      riskFactors.push('Different billing and shipping addresses');
      riskScore += 20;
    }
    
    // Check for rush shipping on first order
    if (orderData.shippingMethod === 'overnight') {
      const previousOrders = await Order.countDocuments({ user: orderData.user });
      if (previousOrders === 0) {
        riskFactors.push('Rush shipping on first order');
        riskScore += 15;
      }
    }
    
    // Check for multiple failed payment attempts (would check payment logs in real app)
    // For now, we'll skip this check
    
    return {
      riskScore,
      riskLevel: riskScore >= 50 ? 'high' : riskScore >= 30 ? 'medium' : 'low',
      riskFactors,
      requiresReview: riskScore >= 50,
    };
  }
  
  /**
   * Generate invoice PDF
   */
  static async generateInvoicePDF(orderId) {
    // In a real application, this would generate an actual PDF
    const order = await Order.findById(orderId)
      .populate('user', 'name email phone address')
      .populate('items.product', 'name sku');
    
    if (!order) {
      throw new ApiError(404, 'Order not found');
    }
    
    // For now, return invoice data that would be used to generate PDF
    return {
      invoiceNumber: `INV-${order.orderNumber}`,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      order: {
        number: order.orderNumber,
        date: order.createdAt,
      },
      customer: {
        name: order.user.name,
        email: order.user.email,
        phone: order.user.phone,
        billingAddress: order.billingAddress,
      },
      items: order.items,
      totals: {
        subtotal: order.subtotal,
        tax: order.taxAmount,
        shipping: order.shippingAmount,
        discount: order.discountAmount,
        total: order.totalAmount,
      },
      payment: {
        method: order.payment.method,
        status: order.payment.status,
      },
    };
  }
  
  /**
   * Get abandoned carts
   */
  static async getAbandonedCarts(hours = 24) {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hours);
    
    // In a real application, this would check a separate cart collection
    // For now, we'll return a placeholder
    return {
      carts: [],
      totalValue: 0,
      averageValue: 0,
    };
  }
  
  /**
   * Calculate order metrics for dashboard
   */
  static async getOrderMetrics(period = 'today') {
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'today':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
    }
    
    const metrics = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
        },
      },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                totalRevenue: { $sum: '$totalAmount' },
                averageOrderValue: { $avg: '$totalAmount' },
                totalItems: { $sum: { $size: '$items' } },
              },
            },
          ],
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                value: { $sum: '$totalAmount' },
              },
            },
          ],
          byPaymentMethod: [
            {
              $group: {
                _id: '$payment.method',
                count: { $sum: 1 },
                value: { $sum: '$totalAmount' },
              },
            },
          ],
          topProducts: [
            { $unwind: '$items' },
            {
              $group: {
                _id: '$items.product',
                name: { $first: '$items.name' },
                quantity: { $sum: '$items.quantity' },
                revenue: { $sum: '$items.subtotal' },
              },
            },
            { $sort: { revenue: -1 } },
            { $limit: 10 },
          ],
        },
      },
    ]);
    
    return metrics[0];
  }
}

module.exports = OrderService;