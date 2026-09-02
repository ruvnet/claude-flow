const Product = require('../models/product.model');
const Order = require('../models/order.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// Get all products with search, filter, and pagination
const getProducts = asyncHandler(async (req, res) => {
  const result = await Product.search(req.query);
  
  res.json({
    success: true,
    ...result,
  });
});

// Get single product by ID
const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate('reviews.user', 'name avatar')
    .populate('relatedProducts', 'name price images rating');
  
  if (!product) {
    throw new ApiError(404, 'Product not found');
  }
  
  // Increment view count
  product.views++;
  await product.save();
  
  res.json({
    success: true,
    data: product,
  });
});

// Create new product (admin only)
const createProduct = asyncHandler(async (req, res) => {
  // Set vendor if marketplace mode
  if (req.user.role !== 'admin') {
    req.body.vendor = req.user.id;
  }
  
  const product = await Product.create(req.body);
  
  res.status(201).json({
    success: true,
    data: product,
  });
});

// Update product (admin/vendor only)
const updateProduct = asyncHandler(async (req, res) => {
  const query = { _id: req.params.id };
  
  // Vendors can only update their own products
  if (req.user.role !== 'admin') {
    query.vendor = req.user.id;
  }
  
  const product = await Product.findOneAndUpdate(
    query,
    req.body,
    {
      new: true,
      runValidators: true,
    }
  );
  
  if (!product) {
    throw new ApiError(404, 'Product not found or unauthorized');
  }
  
  res.json({
    success: true,
    data: product,
  });
});

// Delete product (admin/vendor only)
const deleteProduct = asyncHandler(async (req, res) => {
  const query = { _id: req.params.id };
  
  // Vendors can only delete their own products
  if (req.user.role !== 'admin') {
    query.vendor = req.user.id;
  }
  
  const product = await Product.findOneAndDelete(query);
  
  if (!product) {
    throw new ApiError(404, 'Product not found or unauthorized');
  }
  
  res.json({
    success: true,
    message: 'Product deleted successfully',
  });
});

// Get products by category
const getProductsByCategory = asyncHandler(async (req, res) => {
  const { category } = req.params;
  const { subcategory } = req.query;
  
  const filter = { category, status: 'active', visibility: 'visible' };
  if (subcategory) filter.subcategory = subcategory;
  
  const products = await Product.find(filter)
    .sort('-featured -rating.average')
    .limit(50);
  
  res.json({
    success: true,
    data: products,
  });
});

// Get featured products
const getFeaturedProducts = asyncHandler(async (req, res) => {
  const products = await Product.getFeatured(req.query.limit);
  
  res.json({
    success: true,
    data: products,
  });
});

// Get popular products
const getPopularProducts = asyncHandler(async (req, res) => {
  const products = await Product.getPopular(req.query.limit);
  
  res.json({
    success: true,
    data: products,
  });
});

// Get related products
const getRelatedProducts = asyncHandler(async (req, res) => {
  const products = await Product.getRelated(req.params.id, req.query.limit);
  
  res.json({
    success: true,
    data: products,
  });
});

// Add product review
const addReview = asyncHandler(async (req, res) => {
  const { rating, comment, images } = req.body;
  const productId = req.params.id;
  const userId = req.user.id;
  
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, 'Product not found');
  }
  
  // Check if user purchased this product
  const order = await Order.findOne({
    user: userId,
    'items.product': productId,
    status: 'delivered',
  });
  
  const isVerifiedPurchase = !!order;
  
  await product.addReview(userId, rating, comment, isVerifiedPurchase, images);
  
  res.status(201).json({
    success: true,
    message: 'Review added successfully',
    data: product.reviews[product.reviews.length - 1],
  });
});

// Update product review
const updateReview = asyncHandler(async (req, res) => {
  const { rating, comment, images } = req.body;
  const productId = req.params.id;
  const userId = req.user.id;
  
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, 'Product not found');
  }
  
  await product.updateReview(userId, rating, comment, images);
  
  res.json({
    success: true,
    message: 'Review updated successfully',
  });
});

// Delete product review
const deleteReview = asyncHandler(async (req, res) => {
  const productId = req.params.id;
  const userId = req.user.id;
  
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, 'Product not found');
  }
  
  await product.deleteReview(userId);
  
  res.json({
    success: true,
    message: 'Review deleted successfully',
  });
});

// Mark review as helpful
const markReviewHelpful = asyncHandler(async (req, res) => {
  const { productId, reviewId } = req.params;
  const { helpful } = req.body;
  
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, 'Product not found');
  }
  
  const review = product.reviews.id(reviewId);
  if (!review) {
    throw new ApiError(404, 'Review not found');
  }
  
  if (helpful) {
    review.helpful.yes++;
  } else {
    review.helpful.no++;
  }
  
  await product.save();
  
  res.json({
    success: true,
    message: 'Review feedback recorded',
  });
});

// Update product inventory
const updateInventory = asyncHandler(async (req, res) => {
  const { quantity, operation } = req.body;
  
  const product = await Product.findById(req.params.id);
  if (!product) {
    throw new ApiError(404, 'Product not found');
  }
  
  await product.updateInventory(quantity, operation);
  
  res.json({
    success: true,
    message: 'Inventory updated successfully',
    data: {
      quantity: product.inventory.quantity,
      isAvailable: product.isAvailable,
      isLowStock: product.isLowStock,
      isOutOfStock: product.isOutOfStock,
    },
  });
});

// Bulk update inventory
const bulkUpdateInventory = asyncHandler(async (req, res) => {
  const { updates } = req.body;
  
  const results = await Promise.all(
    updates.map(async ({ productId, quantity, operation }) => {
      try {
        const product = await Product.findById(productId);
        if (!product) {
          return { productId, success: false, error: 'Product not found' };
        }
        
        await product.updateInventory(quantity, operation);
        return { productId, success: true, newQuantity: product.inventory.quantity };
      } catch (error) {
        return { productId, success: false, error: error.message };
      }
    })
  );
  
  res.json({
    success: true,
    results,
  });
});

// Get inventory report
const getInventoryReport = asyncHandler(async (req, res) => {
  const report = await Product.aggregate([
    {
      $match: { 'inventory.trackInventory': true },
    },
    {
      $group: {
        _id: '$category',
        totalProducts: { $sum: 1 },
        totalStock: { $sum: '$inventory.quantity' },
        outOfStock: {
          $sum: {
            $cond: [
              { $lte: ['$inventory.quantity', 0] },
              1,
              0,
            ],
          },
        },
        lowStock: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gt: ['$inventory.quantity', 0] },
                  { $lte: ['$inventory.quantity', '$inventory.lowStockThreshold'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        totalValue: {
          $sum: { $multiply: ['$price', '$inventory.quantity'] },
        },
      },
    },
    {
      $project: {
        category: '$_id',
        totalProducts: 1,
        totalStock: 1,
        outOfStock: 1,
        lowStock: 1,
        totalValue: { $round: ['$totalValue', 2] },
        _id: 0,
      },
    },
    {
      $sort: { category: 1 },
    },
  ]);
  
  res.json({
    success: true,
    data: report,
  });
});

// Get categories with product count
const getCategories = asyncHandler(async (req, res) => {
  const categories = await Product.aggregate([
    {
      $match: { status: 'active' },
    },
    {
      $group: {
        _id: {
          category: '$category',
          subcategory: '$subcategory',
        },
        count: { $sum: 1 },
        avgPrice: { $avg: '$price' },
        avgRating: { $avg: '$rating.average' },
      },
    },
    {
      $group: {
        _id: '$_id.category',
        productCount: { $sum: '$count' },
        subcategories: {
          $push: {
            name: '$_id.subcategory',
            count: '$count',
            avgPrice: { $round: ['$avgPrice', 2] },
            avgRating: { $round: ['$avgRating', 1] },
          },
        },
        avgPrice: { $avg: '$avgPrice' },
        avgRating: { $avg: '$avgRating' },
      },
    },
    {
      $project: {
        category: '$_id',
        productCount: 1,
        subcategories: {
          $filter: {
            input: '$subcategories',
            as: 'sub',
            cond: { $ne: ['$$sub.name', null] },
          },
        },
        avgPrice: { $round: ['$avgPrice', 2] },
        avgRating: { $round: ['$avgRating', 1] },
        _id: 0,
      },
    },
    {
      $sort: { productCount: -1 },
    },
  ]);
  
  res.json({
    success: true,
    data: categories,
  });
});

// Upload product images
const uploadImages = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    throw new ApiError(404, 'Product not found');
  }
  
  // In a real application, you would handle file uploads here
  // For now, we'll assume the images are provided as URLs in the body
  const { images } = req.body;
  
  if (!images || !Array.isArray(images)) {
    throw new ApiError(400, 'Images array is required');
  }
  
  // Add new images
  images.forEach((image, index) => {
    product.images.push({
      url: image.url,
      alt: image.alt || product.name,
      position: product.images.length + index,
      isMain: product.images.length === 0 && index === 0,
    });
  });
  
  await product.save();
  
  res.json({
    success: true,
    message: 'Images uploaded successfully',
    data: product.images,
  });
});

// Delete product image
const deleteImage = asyncHandler(async (req, res) => {
  const { id: productId, imageId } = req.params;
  
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, 'Product not found');
  }
  
  const imageIndex = product.images.findIndex(img => img._id.toString() === imageId);
  if (imageIndex === -1) {
    throw new ApiError(404, 'Image not found');
  }
  
  const wasMain = product.images[imageIndex].isMain;
  product.images.splice(imageIndex, 1);
  
  // If deleted image was main, set first image as main
  if (wasMain && product.images.length > 0) {
    product.images[0].isMain = true;
  }
  
  await product.save();
  
  res.json({
    success: true,
    message: 'Image deleted successfully',
  });
});

// Export products to CSV/JSON
const exportProducts = asyncHandler(async (req, res) => {
  const { format = 'json', category, status } = req.query;
  
  const filter = {};
  if (category) filter.category = category;
  if (status) filter.status = status;
  
  const products = await Product.find(filter).select('-reviews');
  
  if (format === 'csv') {
    // In a real application, you would convert to CSV format
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
    // TODO: Implement CSV conversion
    res.send('CSV export not implemented yet');
  } else {
    res.json({
      success: true,
      count: products.length,
      data: products,
    });
  }
});

module.exports = {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductsByCategory,
  getFeaturedProducts,
  getPopularProducts,
  getRelatedProducts,
  addReview,
  updateReview,
  deleteReview,
  markReviewHelpful,
  updateInventory,
  bulkUpdateInventory,
  getInventoryReport,
  getCategories,
  uploadImages,
  deleteImage,
  exportProducts,
};