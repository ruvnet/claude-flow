const productModel = require('../models/productModel');

const productsController = {
  // Get all products
  getAllProducts: async (req, res, next) => {
    try {
      const { page = 1, limit = 10, category, minPrice, maxPrice } = req.query;
      const filters = {};
      
      if (category) filters.category = category;
      if (minPrice) filters.minPrice = parseFloat(minPrice);
      if (maxPrice) filters.maxPrice = parseFloat(maxPrice);
      
      const products = await productModel.findAll({ page, limit, filters });
      
      res.json({
        success: true,
        data: products,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: products.length
        }
      });
    } catch (error) {
      next(error);
    }
  },

  // Get product by ID
  getProductById: async (req, res, next) => {
    try {
      const product = await productModel.findById(req.params.id);
      
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }
      
      res.json({
        success: true,
        data: product
      });
    } catch (error) {
      next(error);
    }
  },

  // Create new product
  createProduct: async (req, res, next) => {
    try {
      const productData = {
        name: req.body.name,
        price: req.body.price,
        category: req.body.category,
        stock: req.body.stock || 0,
        description: req.body.description
      };
      
      const newProduct = await productModel.create(productData);
      
      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: newProduct
      });
    } catch (error) {
      next(error);
    }
  },

  // Update product
  updateProduct: async (req, res, next) => {
    try {
      const productId = req.params.id;
      const updateData = {
        name: req.body.name,
        price: req.body.price,
        category: req.body.category,
        stock: req.body.stock,
        description: req.body.description
      };
      
      const updatedProduct = await productModel.update(productId, updateData);
      
      if (!updatedProduct) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Product updated successfully',
        data: updatedProduct
      });
    } catch (error) {
      next(error);
    }
  },

  // Delete product
  deleteProduct: async (req, res, next) => {
    try {
      const deleted = await productModel.delete(req.params.id);
      
      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Product deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = productsController;