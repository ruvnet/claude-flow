const Product = require('../models/product.model');
const ApiError = require('../utils/ApiError');
const redis = require('../config/redis');

class ProductService {
  /**
   * Get product with caching
   */
  static async getProductById(productId) {
    const cacheKey = `product:${productId}`;
    
    // Try to get from cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Get from database
    const product = await Product.findById(productId)
      .populate('reviews.user', 'name avatar')
      .populate('relatedProducts', 'name price images rating');
    
    if (!product) {
      throw new ApiError(404, 'Product not found');
    }
    
    // Cache for 1 hour
    await redis.setex(cacheKey, 3600, JSON.stringify(product));
    
    return product;
  }
  
  /**
   * Invalidate product cache
   */
  static async invalidateProductCache(productId) {
    const cacheKey = `product:${productId}`;
    await redis.del(cacheKey);
  }
  
  /**
   * Get products by IDs
   */
  static async getProductsByIds(productIds) {
    const products = await Product.find({
      _id: { $in: productIds },
      status: 'active',
    });
    
    return products;
  }
  
  /**
   * Check product availability for multiple items
   */
  static async checkBulkAvailability(items) {
    const results = await Promise.all(
      items.map(async (item) => {
        const product = await Product.findById(item.product);
        
        if (!product) {
          return {
            product: item.product,
            available: false,
            error: 'Product not found',
          };
        }
        
        if (!product.isAvailable) {
          return {
            product: item.product,
            available: false,
            error: 'Product not available',
          };
        }
        
        const hasStock = product.checkAvailability(item.quantity);
        
        return {
          product: item.product,
          available: hasStock,
          error: hasStock ? null : `Insufficient stock. Available: ${product.inventory.quantity}`,
          maxQuantity: product.inventory.quantity,
        };
      })
    );
    
    return results;
  }
  
  /**
   * Update product metrics
   */
  static async updateProductMetrics(productId, metrics) {
    const updates = {};
    
    if (metrics.views) {
      updates.$inc = { views: metrics.views };
    }
    
    if (metrics.salesCount) {
      updates.$inc = { ...updates.$inc, salesCount: metrics.salesCount };
    }
    
    await Product.findByIdAndUpdate(productId, updates);
    await this.invalidateProductCache(productId);
  }
  
  /**
   * Get product recommendations based on user behavior
   */
  static async getRecommendations(userId, limit = 10) {
    // In a real application, this would use machine learning or collaborative filtering
    // For now, we'll return popular products
    const recommendations = await Product.find({
      status: 'active',
      visibility: 'visible',
    })
      .sort('-salesCount -rating.average')
      .limit(limit);
    
    return recommendations;
  }
  
  /**
   * Get products by tags
   */
  static async getProductsByTags(tags, limit = 20) {
    const products = await Product.find({
      tags: { $in: tags },
      status: 'active',
      visibility: 'visible',
    })
      .sort('-rating.average -salesCount')
      .limit(limit);
    
    return products;
  }
  
  /**
   * Calculate dynamic pricing based on demand
   */
  static async calculateDynamicPrice(productId) {
    const product = await Product.findById(productId);
    if (!product) {
      throw new ApiError(404, 'Product not found');
    }
    
    // Simple dynamic pricing logic
    let priceMultiplier = 1;
    
    // High demand (low stock, high sales)
    if (product.inventory.quantity < 10 && product.salesCount > 100) {
      priceMultiplier = 1.1; // 10% increase
    }
    
    // Low demand (high stock, low sales)
    else if (product.inventory.quantity > 100 && product.salesCount < 10) {
      priceMultiplier = 0.9; // 10% decrease
    }
    
    const dynamicPrice = Math.round(product.price * priceMultiplier * 100) / 100;
    
    return {
      originalPrice: product.price,
      dynamicPrice,
      priceMultiplier,
      reason: priceMultiplier > 1 ? 'high_demand' : priceMultiplier < 1 ? 'low_demand' : 'normal',
    };
  }
  
  /**
   * Get low stock products
   */
  static async getLowStockProducts(threshold) {
    const products = await Product.find({
      'inventory.trackInventory': true,
      'inventory.quantity': { $lte: threshold || 10, $gt: 0 },
      status: 'active',
    })
      .sort('inventory.quantity')
      .select('name sku inventory.quantity inventory.lowStockThreshold category');
    
    return products;
  }
  
  /**
   * Get out of stock products
   */
  static async getOutOfStockProducts() {
    const products = await Product.find({
      'inventory.trackInventory': true,
      'inventory.quantity': 0,
      'inventory.allowBackorder': false,
      status: 'active',
    })
      .select('name sku category updatedAt');
    
    return products;
  }
  
  /**
   * Bulk import products
   */
  static async bulkImportProducts(products, userId) {
    const results = {
      success: [],
      failed: [],
    };
    
    for (const productData of products) {
      try {
        // Add vendor if not admin
        if (userId) {
          productData.vendor = userId;
        }
        
        const product = await Product.create(productData);
        results.success.push({
          sku: product.sku,
          name: product.name,
          id: product._id,
        });
      } catch (error) {
        results.failed.push({
          sku: productData.sku,
          name: productData.name,
          error: error.message,
        });
      }
    }
    
    return results;
  }
  
  /**
   * Get product analytics
   */
  static async getProductAnalytics(productId, period = 30) {
    const product = await Product.findById(productId);
    if (!product) {
      throw new ApiError(404, 'Product not found');
    }
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);
    
    // In a real application, you would aggregate from order data
    const analytics = {
      product: {
        id: product._id,
        name: product.name,
        sku: product.sku,
      },
      metrics: {
        views: product.views,
        salesCount: product.salesCount,
        revenue: product.salesCount * product.price,
        averageRating: product.rating.average,
        reviewCount: product.rating.count,
        currentStock: product.inventory.quantity,
      },
      trends: {
        // These would be calculated from historical data
        viewsTrend: 'increasing',
        salesTrend: 'stable',
        stockTrend: 'decreasing',
      },
      recommendations: [],
    };
    
    // Add recommendations based on metrics
    if (product.inventory.quantity <= product.inventory.lowStockThreshold) {
      analytics.recommendations.push('Restock soon - inventory is low');
    }
    
    if (product.rating.average < 3) {
      analytics.recommendations.push('Consider improving product quality based on reviews');
    }
    
    if (product.views > 1000 && product.salesCount < 10) {
      analytics.recommendations.push('High views but low conversion - consider adjusting price or description');
    }
    
    return analytics;
  }
  
  /**
   * Search products with elasticsearch-like functionality
   */
  static async searchProducts(searchParams) {
    const {
      query,
      filters = {},
      sort = { relevance: -1 },
      pagination = { page: 1, limit: 20 },
      facets = ['category', 'brand', 'price'],
    } = searchParams;
    
    // Build search query
    const searchQuery = { status: 'active', visibility: { $in: ['visible', 'search'] } };
    
    if (query) {
      searchQuery.$text = { $search: query };
    }
    
    // Apply filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchQuery[key] = value;
      }
    });
    
    // Execute search
    const skip = (pagination.page - 1) * pagination.limit;
    let queryBuilder = Product.find(searchQuery);
    
    if (query) {
      queryBuilder = queryBuilder.select({ score: { $meta: 'textScore' } });
      queryBuilder = queryBuilder.sort({ score: { $meta: 'textScore' } });
    } else {
      queryBuilder = queryBuilder.sort(sort);
    }
    
    const [products, total] = await Promise.all([
      queryBuilder.skip(skip).limit(pagination.limit),
      Product.countDocuments(searchQuery),
    ]);
    
    // Build facets
    const facetResults = {};
    if (facets.includes('category')) {
      facetResults.categories = await Product.aggregate([
        { $match: searchQuery },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);
    }
    
    if (facets.includes('brand')) {
      facetResults.brands = await Product.aggregate([
        { $match: { ...searchQuery, brand: { $exists: true, $ne: null } } },
        { $group: { _id: '$brand', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);
    }
    
    if (facets.includes('price')) {
      const priceRanges = await Product.aggregate([
        { $match: searchQuery },
        {
          $bucket: {
            groupBy: '$price',
            boundaries: [0, 10, 25, 50, 100, 250, 500, 1000, Infinity],
            default: 'Other',
            output: { count: { $sum: 1 } },
          },
        },
      ]);
      facetResults.priceRanges = priceRanges;
    }
    
    return {
      products,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
      facets: facetResults,
    };
  }
}

module.exports = ProductService;