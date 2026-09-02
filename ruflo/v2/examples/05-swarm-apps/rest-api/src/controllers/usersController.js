const userModel = require('../models/userModel');

const usersController = {
  // Get all users
  getAllUsers: async (req, res, next) => {
    try {
      const { page = 1, limit = 10, sort = 'id' } = req.query;
      const users = await userModel.findAll({ page, limit, sort });
      
      res.json({
        success: true,
        data: users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: users.length
        }
      });
    } catch (error) {
      next(error);
    }
  },

  // Get user by ID
  getUserById: async (req, res, next) => {
    try {
      const user = await userModel.findById(req.params.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      res.json({
        success: true,
        data: user
      });
    } catch (error) {
      next(error);
    }
  },

  // Create new user
  createUser: async (req, res, next) => {
    try {
      const userData = {
        name: req.body.name,
        email: req.body.email,
        age: req.body.age
      };
      
      const newUser = await userModel.create(userData);
      
      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: newUser
      });
    } catch (error) {
      next(error);
    }
  },

  // Update user
  updateUser: async (req, res, next) => {
    try {
      const userId = req.params.id;
      const updateData = {
        name: req.body.name,
        email: req.body.email,
        age: req.body.age
      };
      
      const updatedUser = await userModel.update(userId, updateData);
      
      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      res.json({
        success: true,
        message: 'User updated successfully',
        data: updatedUser
      });
    } catch (error) {
      next(error);
    }
  },

  // Delete user
  deleteUser: async (req, res, next) => {
    try {
      const deleted = await userModel.delete(req.params.id);
      
      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      res.json({
        success: true,
        message: 'User deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = usersController;