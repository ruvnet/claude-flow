const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot exceed 5'],
  },
  comment: {
    type: String,
    required: [true, 'Review comment is required'],
    trim: true,
    maxlength: [500, 'Review comment cannot exceed 500 characters'],
  },
  isVerifiedPurchase: {
    type: Boolean,
    default: false,
  },
  helpful: {
    yes: { type: Number, default: 0 },
    no: { type: Number, default: 0 },
  },
  images: [{
    type: String,
  }],
}, {
  timestamps: true,
});

const specificationSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    trim: true,
  },
  value: {
    type: String,
    required: true,
    trim: true,
  },
});

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    minlength: [3, 'Product name must be at least 3 characters'],
    maxlength: [200, 'Product name cannot exceed 200 characters'],
    index: 'text',
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    index: true,
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    trim: true,
    minlength: [10, 'Description must be at least 10 characters'],
    maxlength: [2000, 'Description cannot exceed 2000 characters'],
    index: 'text',
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative'],
    set: v => Math.round(v * 100) / 100, // Round to 2 decimal places
  },
  comparePrice: {
    type: Number,
    min: [0, 'Compare price cannot be negative'],
    validate: {
      validator: function(v) {
        return !v || v > this.price;
      },
      message: 'Compare price must be greater than regular price',
    },
  },
  costPrice: {
    type: Number,
    min: [0, 'Cost price cannot be negative'],
    select: false, // Hidden by default
  },
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],
  },
  category: {
    type: String,
    required: [true, 'Product category is required'],
    trim: true,
    index: true,
  },
  subcategory: {
    type: String,
    trim: true,
    index: true,
  },
  brand: {
    type: String,
    trim: true,
    index: true,
  },
  sku: {
    type: String,
    unique: true,
    sparse: true, // Allow null but ensure uniqueness when present
    uppercase: true,
    trim: true,
  },
  barcode: {
    type: String,
    unique: true,
    sparse: true,
  },
  inventory: {
    quantity: {
      type: Number,
      default: 0,
      min: [0, 'Quantity cannot be negative'],
    },
    trackInventory: {
      type: Boolean,
      default: true,
    },
    allowBackorder: {
      type: Boolean,
      default: false,
    },
    lowStockThreshold: {
      type: Number,
      default: 10,
      min: [0, 'Low stock threshold cannot be negative'],
    },
    warehouse: {
      type: String,
      default: 'main',
    },
  },
  images: [{
    url: {
      type: String,
      required: true,
    },
    alt: String,
    position: {
      type: Number,
      default: 0,
    },
    isMain: {
      type: Boolean,
      default: false,
    },
  }],
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    index: true,
  }],
  specifications: [specificationSchema],
  dimensions: {
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    weight: { type: Number, min: 0 },
    unit: {
      type: String,
      enum: ['cm', 'inch', 'kg', 'lb'],
      default: 'cm',
    },
  },
  reviews: [reviewSchema],
  rating: {
    average: {
      type: Number,
      default: 0,
      min: [0, 'Rating cannot be negative'],
      max: [5, 'Rating cannot exceed 5'],
      set: v => Math.round(v * 10) / 10, // Round to 1 decimal place
    },
    count: {
      type: Number,
      default: 0,
    },
    distribution: {
      1: { type: Number, default: 0 },
      2: { type: Number, default: 0 },
      3: { type: Number, default: 0 },
      4: { type: Number, default: 0 },
      5: { type: Number, default: 0 },
    },
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'draft', 'archived'],
    default: 'active',
    index: true,
  },
  visibility: {
    type: String,
    enum: ['visible', 'hidden', 'catalog', 'search'],
    default: 'visible',
  },
  seo: {
    title: {
      type: String,
      maxlength: [60, 'SEO title cannot exceed 60 characters'],
    },
    description: {
      type: String,
      maxlength: [160, 'SEO description cannot exceed 160 characters'],
    },
    keywords: [String],
  },
  attributes: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
  },
  variants: [{
    name: String,
    sku: String,
    price: Number,
    inventory: Number,
    attributes: Map,
  }],
  relatedProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
  }],
  views: {
    type: Number,
    default: 0,
  },
  salesCount: {
    type: Number,
    default: 0,
  },
  featured: {
    type: Boolean,
    default: false,
    index: true,
  },
  publishedAt: {
    type: Date,
    default: Date.now,
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
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

// Indexes for search and filtering
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ price: 1, 'rating.average': -1 });
productSchema.index({ category: 1, subcategory: 1 });
productSchema.index({ status: 1, visibility: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ 'inventory.quantity': 1 });
productSchema.index({ featured: 1, 'rating.average': -1 });

// Virtual for discount percentage
productSchema.virtual('discountPercentage').get(function() {
  if (!this.comparePrice || this.comparePrice <= this.price) return 0;
  return Math.round(((this.comparePrice - this.price) / this.comparePrice) * 100);
});

// Virtual for availability
productSchema.virtual('isAvailable').get(function() {
  if (!this.inventory.trackInventory) return true;
  return this.inventory.quantity > 0 || this.inventory.allowBackorder;
});

// Virtual for low stock
productSchema.virtual('isLowStock').get(function() {
  if (!this.inventory.trackInventory) return false;
  return this.inventory.quantity <= this.inventory.lowStockThreshold && this.inventory.quantity > 0;
});

// Virtual for out of stock
productSchema.virtual('isOutOfStock').get(function() {
  if (!this.inventory.trackInventory) return false;
  return this.inventory.quantity <= 0 && !this.inventory.allowBackorder;
});

// Pre-save middleware to generate slug
productSchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    // Add timestamp to ensure uniqueness
    this.slug = `${this.slug}-${Date.now()}`;
  }
  
  // Ensure main image
  if (this.images.length > 0 && !this.images.some(img => img.isMain)) {
    this.images[0].isMain = true;
  }
  
  next();
});

// Method to add review
productSchema.methods.addReview = async function(userId, rating, comment, isVerifiedPurchase = false, images = []) {
  // Check if user already reviewed
  const existingReview = this.reviews.find(review => review.user.toString() === userId.toString());
  if (existingReview) {
    throw new Error('You have already reviewed this product');
  }
  
  // Add review
  this.reviews.push({
    user: userId,
    rating,
    comment,
    isVerifiedPurchase,
    images,
  });
  
  // Update rating statistics
  await this.updateRatingStats();
  
  return this.save();
};

// Method to update review
productSchema.methods.updateReview = async function(userId, rating, comment, images) {
  const review = this.reviews.find(r => r.user.toString() === userId.toString());
  if (!review) {
    throw new Error('Review not found');
  }
  
  review.rating = rating;
  review.comment = comment;
  if (images) review.images = images;
  review.updatedAt = Date.now();
  
  await this.updateRatingStats();
  
  return this.save();
};

// Method to delete review
productSchema.methods.deleteReview = async function(userId) {
  const reviewIndex = this.reviews.findIndex(r => r.user.toString() === userId.toString());
  if (reviewIndex === -1) {
    throw new Error('Review not found');
  }
  
  this.reviews.splice(reviewIndex, 1);
  await this.updateRatingStats();
  
  return this.save();
};

// Method to update rating statistics
productSchema.methods.updateRatingStats = function() {
  if (this.reviews.length === 0) {
    this.rating = {
      average: 0,
      count: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };
    return;
  }
  
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalRating = 0;
  
  this.reviews.forEach(review => {
    distribution[review.rating]++;
    totalRating += review.rating;
  });
  
  this.rating = {
    average: totalRating / this.reviews.length,
    count: this.reviews.length,
    distribution,
  };
};

// Method to update inventory
productSchema.methods.updateInventory = function(quantity, operation = 'set') {
  if (!this.inventory.trackInventory) return this;
  
  switch (operation) {
    case 'set':
      this.inventory.quantity = quantity;
      break;
    case 'increment':
      this.inventory.quantity += quantity;
      break;
    case 'decrement':
      this.inventory.quantity = Math.max(0, this.inventory.quantity - quantity);
      break;
  }
  
  return this.save();
};

// Method to check availability for quantity
productSchema.methods.checkAvailability = function(quantity) {
  if (!this.inventory.trackInventory) return true;
  
  if (this.inventory.allowBackorder) return true;
  
  return this.inventory.quantity >= quantity;
};

// Static method for advanced search
productSchema.statics.search = async function(query) {
  const {
    q,
    category,
    subcategory,
    brand,
    minPrice,
    maxPrice,
    tags,
    inStock,
    featured,
    minRating,
    sort = '-createdAt',
    page = 1,
    limit = 20,
  } = query;
  
  const filter = { status: 'active', visibility: { $in: ['visible', 'search'] } };
  
  // Text search
  if (q) {
    filter.$text = { $search: q };
  }
  
  // Category filters
  if (category) filter.category = category;
  if (subcategory) filter.subcategory = subcategory;
  if (brand) filter.brand = brand;
  
  // Price range
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = minPrice;
    if (maxPrice) filter.price.$lte = maxPrice;
  }
  
  // Tags
  if (tags && tags.length > 0) {
    filter.tags = { $in: Array.isArray(tags) ? tags : [tags] };
  }
  
  // Stock
  if (inStock === true || inStock === 'true') {
    filter.$or = [
      { 'inventory.trackInventory': false },
      { 'inventory.quantity': { $gt: 0 } },
      { 'inventory.allowBackorder': true },
    ];
  }
  
  // Featured
  if (featured === true || featured === 'true') {
    filter.featured = true;
  }
  
  // Rating
  if (minRating) {
    filter['rating.average'] = { $gte: minRating };
  }
  
  // Build query
  let queryBuilder = this.find(filter);
  
  // Add text score if searching
  if (q) {
    queryBuilder = queryBuilder.select({ score: { $meta: 'textScore' } });
    queryBuilder = queryBuilder.sort({ score: { $meta: 'textScore' } });
  } else {
    // Apply regular sorting
    queryBuilder = queryBuilder.sort(sort);
  }
  
  // Pagination
  const skip = (page - 1) * limit;
  queryBuilder = queryBuilder.skip(skip).limit(limit);
  
  // Execute query
  const [products, total] = await Promise.all([
    queryBuilder.exec(),
    this.countDocuments(filter),
  ]);
  
  return {
    products,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

// Static method to get popular products
productSchema.statics.getPopular = function(limit = 10) {
  return this.find({ status: 'active', visibility: 'visible' })
    .sort('-salesCount -rating.average')
    .limit(limit);
};

// Static method to get featured products
productSchema.statics.getFeatured = function(limit = 10) {
  return this.find({ status: 'active', visibility: 'visible', featured: true })
    .sort('-rating.average -createdAt')
    .limit(limit);
};

// Static method to get related products
productSchema.statics.getRelated = async function(productId, limit = 6) {
  const product = await this.findById(productId);
  if (!product) return [];
  
  // Find products in same category with similar tags
  return this.find({
    _id: { $ne: productId },
    status: 'active',
    visibility: 'visible',
    $or: [
      { category: product.category },
      { tags: { $in: product.tags } },
    ],
  })
    .sort('-rating.average -salesCount')
    .limit(limit);
};

const Product = mongoose.model('Product', productSchema);

module.exports = Product;