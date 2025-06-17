const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  image: String,
  price: {
    type: Number,
    required: true,
    min: [0, 'Price cannot be negative'],
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1'],
  },
  subtotal: {
    type: Number,
    required: true,
    min: [0, 'Subtotal cannot be negative'],
  },
  variant: {
    name: String,
    attributes: Map,
  },
});

const shippingAddressSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  phone: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  street: {
    type: String,
    required: true,
    trim: true,
  },
  apartment: {
    type: String,
    trim: true,
  },
  city: {
    type: String,
    required: true,
    trim: true,
  },
  state: {
    type: String,
    required: true,
    trim: true,
  },
  zipCode: {
    type: String,
    required: true,
    trim: true,
  },
  country: {
    type: String,
    required: true,
    trim: true,
  },
  instructions: {
    type: String,
    maxlength: [500, 'Instructions cannot exceed 500 characters'],
  },
});

const paymentInfoSchema = new mongoose.Schema({
  method: {
    type: String,
    required: true,
    enum: ['credit_card', 'debit_card', 'paypal', 'stripe', 'cash_on_delivery', 'bank_transfer'],
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'partially_refunded'],
    default: 'pending',
  },
  transactionId: String,
  amount: {
    type: Number,
    required: true,
    min: [0, 'Amount cannot be negative'],
  },
  currency: {
    type: String,
    default: 'USD',
  },
  paidAt: Date,
  refundedAmount: {
    type: Number,
    default: 0,
    min: [0, 'Refunded amount cannot be negative'],
  },
  refundReason: String,
  refundedAt: Date,
  paymentDetails: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
  },
});

const orderHistorySchema = new mongoose.Schema({
  status: {
    type: String,
    required: true,
  },
  comment: String,
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    required: true,
    index: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  items: {
    type: [orderItemSchema],
    validate: [v => v.length > 0, 'Order must have at least one item'],
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
    default: 'pending',
    index: true,
  },
  cancelReason: String,
  cancelledAt: Date,
  subtotal: {
    type: Number,
    required: true,
    min: [0, 'Subtotal cannot be negative'],
  },
  taxAmount: {
    type: Number,
    default: 0,
    min: [0, 'Tax amount cannot be negative'],
  },
  taxRate: {
    type: Number,
    default: 0,
    min: [0, 'Tax rate cannot be negative'],
    max: [100, 'Tax rate cannot exceed 100%'],
  },
  shippingAmount: {
    type: Number,
    default: 0,
    min: [0, 'Shipping amount cannot be negative'],
  },
  shippingMethod: {
    type: String,
    enum: ['standard', 'express', 'overnight', 'pickup'],
    default: 'standard',
  },
  discountAmount: {
    type: Number,
    default: 0,
    min: [0, 'Discount amount cannot be negative'],
  },
  discountCode: String,
  totalAmount: {
    type: Number,
    required: true,
    min: [0, 'Total amount cannot be negative'],
  },
  currency: {
    type: String,
    default: 'USD',
  },
  shippingAddress: {
    type: shippingAddressSchema,
    required: true,
  },
  billingAddress: {
    type: shippingAddressSchema,
    required: function() {
      return this.billingAddressSameAsShipping === false;
    },
  },
  billingAddressSameAsShipping: {
    type: Boolean,
    default: true,
  },
  payment: {
    type: paymentInfoSchema,
    required: true,
  },
  tracking: {
    carrier: String,
    number: String,
    url: String,
    estimatedDelivery: Date,
    shippedAt: Date,
    deliveredAt: Date,
  },
  notes: {
    customer: {
      type: String,
      maxlength: [500, 'Customer notes cannot exceed 500 characters'],
    },
    internal: {
      type: String,
      maxlength: [1000, 'Internal notes cannot exceed 1000 characters'],
    },
  },
  history: [orderHistorySchema],
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
  },
  source: {
    type: String,
    enum: ['web', 'mobile', 'api', 'admin', 'import'],
    default: 'web',
  },
  ipAddress: String,
  userAgent: String,
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    },
  },
});

// Indexes
orderSchema.index({ createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ user: 1, status: 1 });
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ 'tracking.number': 1 });

// Virtual for items count
orderSchema.virtual('itemsCount').get(function() {
  return this.items.reduce((total, item) => total + item.quantity, 0);
});

// Virtual for refund eligibility
orderSchema.virtual('isRefundEligible').get(function() {
  // Order must be delivered and within 30 days
  if (this.status !== 'delivered') return false;
  if (!this.tracking?.deliveredAt) return false;
  
  const daysSinceDelivery = (Date.now() - new Date(this.tracking.deliveredAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceDelivery <= 30;
});

// Virtual for cancellation eligibility
orderSchema.virtual('isCancellable').get(function() {
  return ['pending', 'confirmed', 'processing'].includes(this.status);
});

// Pre-save middleware to generate order number
orderSchema.pre('save', async function(next) {
  if (this.isNew) {
    // Generate unique order number
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    
    this.orderNumber = `ORD-${year}${month}${day}-${random}`;
    
    // Add initial history entry
    this.history.push({
      status: 'pending',
      comment: 'Order created',
    });
  }
  
  // Calculate totals
  this.subtotal = this.items.reduce((total, item) => {
    item.subtotal = item.price * item.quantity;
    return total + item.subtotal;
  }, 0);
  
  // Calculate tax
  this.taxAmount = this.subtotal * (this.taxRate / 100);
  
  // Calculate total
  this.totalAmount = this.subtotal + this.taxAmount + this.shippingAmount - this.discountAmount;
  
  next();
});

// Method to update order status
orderSchema.methods.updateStatus = async function(newStatus, comment, userId) {
  const validTransitions = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['delivered', 'cancelled'],
    delivered: ['refunded'],
    cancelled: [],
    refunded: [],
  };
  
  if (!validTransitions[this.status].includes(newStatus)) {
    throw new Error(`Cannot transition from ${this.status} to ${newStatus}`);
  }
  
  this.status = newStatus;
  
  // Add history entry
  this.history.push({
    status: newStatus,
    comment,
    updatedBy: userId,
  });
  
  // Set specific timestamps
  if (newStatus === 'cancelled') {
    this.cancelledAt = new Date();
    this.cancelReason = comment;
  } else if (newStatus === 'shipped' && this.tracking) {
    this.tracking.shippedAt = new Date();
  } else if (newStatus === 'delivered' && this.tracking) {
    this.tracking.deliveredAt = new Date();
  }
  
  return this.save();
};

// Method to cancel order
orderSchema.methods.cancel = async function(reason, userId) {
  if (!this.isCancellable) {
    throw new Error('Order cannot be cancelled in current status');
  }
  
  await this.updateStatus('cancelled', reason, userId);
  
  // TODO: Trigger inventory restoration
  // TODO: Trigger payment refund if applicable
  
  return this;
};

// Method to add tracking information
orderSchema.methods.addTracking = function(carrier, number, url, estimatedDelivery) {
  this.tracking = {
    carrier,
    number,
    url,
    estimatedDelivery,
    shippedAt: new Date(),
  };
  
  return this.save();
};

// Method to process refund
orderSchema.methods.processRefund = async function(amount, reason, userId) {
  if (!this.isRefundEligible) {
    throw new Error('Order is not eligible for refund');
  }
  
  if (amount > this.totalAmount - this.payment.refundedAmount) {
    throw new Error('Refund amount exceeds remaining order value');
  }
  
  this.payment.refundedAmount += amount;
  this.payment.refundReason = reason;
  this.payment.refundedAt = new Date();
  
  if (this.payment.refundedAmount >= this.totalAmount) {
    this.payment.status = 'refunded';
    await this.updateStatus('refunded', `Full refund processed: ${reason}`, userId);
  } else {
    this.payment.status = 'partially_refunded';
    this.history.push({
      status: this.status,
      comment: `Partial refund of ${amount} processed: ${reason}`,
      updatedBy: userId,
    });
  }
  
  return this.save();
};

// Static method to get order statistics
orderSchema.statics.getStatistics = async function(userId, period = 'all') {
  const match = userId ? { user: userId } : {};
  
  // Add date filter based on period
  const now = new Date();
  switch (period) {
    case 'today':
      match.createdAt = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
      break;
    case 'week':
      match.createdAt = { $gte: new Date(now.setDate(now.getDate() - 7)) };
      break;
    case 'month':
      match.createdAt = { $gte: new Date(now.setMonth(now.getMonth() - 1)) };
      break;
    case 'year':
      match.createdAt = { $gte: new Date(now.setFullYear(now.getFullYear() - 1)) };
      break;
  }
  
  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$totalAmount' },
        averageOrderValue: { $avg: '$totalAmount' },
        totalItems: { $sum: { $size: '$items' } },
        statusCounts: {
          $push: '$status',
        },
      },
    },
    {
      $project: {
        _id: 0,
        totalOrders: 1,
        totalRevenue: { $round: ['$totalRevenue', 2] },
        averageOrderValue: { $round: ['$averageOrderValue', 2] },
        totalItems: 1,
        statusBreakdown: {
          $arrayToObject: {
            $map: {
              input: { $setUnion: ['$statusCounts', []] },
              as: 'status',
              in: {
                k: '$$status',
                v: {
                  $size: {
                    $filter: {
                      input: '$statusCounts',
                      cond: { $eq: ['$$this', '$$status'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  ]);
  
  return stats[0] || {
    totalOrders: 0,
    totalRevenue: 0,
    averageOrderValue: 0,
    totalItems: 0,
    statusBreakdown: {},
  };
};

// Static method to get sales report
orderSchema.statics.getSalesReport = async function(startDate, endDate, groupBy = 'day') {
  const dateFormat = {
    day: '%Y-%m-%d',
    week: '%Y-%V',
    month: '%Y-%m',
    year: '%Y',
  };
  
  const report = await this.aggregate([
    {
      $match: {
        createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
        status: { $nin: ['cancelled', 'refunded'] },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: dateFormat[groupBy], date: '$createdAt' } },
        orders: { $sum: 1 },
        revenue: { $sum: '$totalAmount' },
        items: { $sum: { $size: '$items' } },
        avgOrderValue: { $avg: '$totalAmount' },
      },
    },
    {
      $sort: { _id: 1 },
    },
    {
      $project: {
        date: '$_id',
        orders: 1,
        revenue: { $round: ['$revenue', 2] },
        items: 1,
        avgOrderValue: { $round: ['$avgOrderValue', 2] },
        _id: 0,
      },
    },
  ]);
  
  return report;
};

// Static method to find orders by various criteria
orderSchema.statics.findOrders = async function(filters) {
  const {
    userId,
    status,
    paymentStatus,
    startDate,
    endDate,
    minAmount,
    maxAmount,
    orderNumber,
    trackingNumber,
    page = 1,
    limit = 20,
    sort = '-createdAt',
  } = filters;
  
  const query = {};
  
  if (userId) query.user = userId;
  if (status) query.status = status;
  if (paymentStatus) query['payment.status'] = paymentStatus;
  if (orderNumber) query.orderNumber = new RegExp(orderNumber, 'i');
  if (trackingNumber) query['tracking.number'] = trackingNumber;
  
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }
  
  if (minAmount || maxAmount) {
    query.totalAmount = {};
    if (minAmount) query.totalAmount.$gte = minAmount;
    if (maxAmount) query.totalAmount.$lte = maxAmount;
  }
  
  const skip = (page - 1) * limit;
  
  const [orders, total] = await Promise.all([
    this.find(query)
      .populate('user', 'name email')
      .populate('items.product', 'name images')
      .sort(sort)
      .skip(skip)
      .limit(limit),
    this.countDocuments(query),
  ]);
  
  return {
    orders,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;