const Joi = require('joi');

// Custom password validation
const password = Joi.string()
  .min(6)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  .messages({
    'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
    'string.min': 'Password must be at least 6 characters long',
    'string.max': 'Password must not exceed 128 characters',
  });

const authValidators = {
  // Register validation
  register: {
    body: Joi.object({
      email: Joi.string()
        .email()
        .lowercase()
        .trim()
        .required()
        .messages({
          'string.email': 'Please provide a valid email address',
          'any.required': 'Email is required',
        }),
      password: password.required(),
      confirmPassword: Joi.string()
        .valid(Joi.ref('password'))
        .required()
        .messages({
          'any.only': 'Passwords do not match',
          'any.required': 'Password confirmation is required',
        }),
      name: Joi.string()
        .trim()
        .min(2)
        .max(50)
        .required()
        .messages({
          'string.min': 'Name must be at least 2 characters long',
          'string.max': 'Name cannot exceed 50 characters',
          'any.required': 'Name is required',
        }),
      phone: Joi.string()
        .pattern(/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/)
        .optional()
        .messages({
          'string.pattern.base': 'Please provide a valid phone number',
        }),
      role: Joi.string()
        .valid('user', 'admin')
        .optional()
        .default('user'),
      address: Joi.object({
        street: Joi.string().trim().optional(),
        city: Joi.string().trim().optional(),
        state: Joi.string().trim().optional(),
        zipCode: Joi.string().trim().optional(),
        country: Joi.string().trim().optional(),
      }).optional(),
    }),
  },

  // Login validation
  login: {
    body: Joi.object({
      email: Joi.string()
        .email()
        .lowercase()
        .trim()
        .required()
        .messages({
          'string.email': 'Please provide a valid email address',
          'any.required': 'Email is required',
        }),
      password: Joi.string()
        .required()
        .messages({
          'any.required': 'Password is required',
        }),
      rememberMe: Joi.boolean().optional().default(false),
    }),
  },

  // Refresh token validation
  refreshToken: {
    body: Joi.object({
      refreshToken: Joi.string()
        .required()
        .messages({
          'any.required': 'Refresh token is required',
        }),
    }),
  },

  // Forgot password validation
  forgotPassword: {
    body: Joi.object({
      email: Joi.string()
        .email()
        .lowercase()
        .trim()
        .required()
        .messages({
          'string.email': 'Please provide a valid email address',
          'any.required': 'Email is required',
        }),
    }),
  },

  // Reset password validation
  resetPassword: {
    body: Joi.object({
      token: Joi.string()
        .required()
        .messages({
          'any.required': 'Reset token is required',
        }),
      password: password.required(),
      confirmPassword: Joi.string()
        .valid(Joi.ref('password'))
        .required()
        .messages({
          'any.only': 'Passwords do not match',
          'any.required': 'Password confirmation is required',
        }),
    }),
  },

  // Change password validation
  changePassword: {
    body: Joi.object({
      currentPassword: Joi.string()
        .required()
        .messages({
          'any.required': 'Current password is required',
        }),
      newPassword: password
        .required()
        .invalid(Joi.ref('currentPassword'))
        .messages({
          'any.invalid': 'New password must be different from current password',
        }),
      confirmPassword: Joi.string()
        .valid(Joi.ref('newPassword'))
        .required()
        .messages({
          'any.only': 'Passwords do not match',
          'any.required': 'Password confirmation is required',
        }),
    }),
  },

  // Verify email validation
  verifyEmail: {
    params: Joi.object({
      token: Joi.string()
        .required()
        .messages({
          'any.required': 'Verification token is required',
        }),
    }),
  },

  // Update profile validation
  updateProfile: {
    body: Joi.object({
      name: Joi.string()
        .trim()
        .min(2)
        .max(50)
        .optional()
        .messages({
          'string.min': 'Name must be at least 2 characters long',
          'string.max': 'Name cannot exceed 50 characters',
        }),
      phone: Joi.string()
        .pattern(/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/)
        .optional()
        .allow('')
        .messages({
          'string.pattern.base': 'Please provide a valid phone number',
        }),
      address: Joi.object({
        street: Joi.string().trim().optional().allow(''),
        city: Joi.string().trim().optional().allow(''),
        state: Joi.string().trim().optional().allow(''),
        zipCode: Joi.string().trim().optional().allow(''),
        country: Joi.string().trim().optional().allow(''),
      }).optional(),
      avatar: Joi.string()
        .uri()
        .optional()
        .allow(null, '')
        .messages({
          'string.uri': 'Avatar must be a valid URL',
        }),
    }).min(1).messages({
      'object.min': 'At least one field must be provided for update',
    }),
  },

  // Change email validation
  changeEmail: {
    body: Joi.object({
      newEmail: Joi.string()
        .email()
        .lowercase()
        .trim()
        .required()
        .messages({
          'string.email': 'Please provide a valid email address',
          'any.required': 'New email is required',
        }),
      password: Joi.string()
        .required()
        .messages({
          'any.required': 'Password is required for email change',
        }),
    }),
  },

  // User ID validation
  userId: {
    params: Joi.object({
      id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
          'string.pattern.base': 'Invalid user ID format',
          'any.required': 'User ID is required',
        }),
    }),
  },

  // Query parameters for user listing
  userQuery: {
    query: Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      sort: Joi.string().valid('createdAt', '-createdAt', 'name', '-name', 'email', '-email').default('-createdAt'),
      role: Joi.string().valid('user', 'admin').optional(),
      isActive: Joi.boolean().optional(),
      isEmailVerified: Joi.boolean().optional(),
      search: Joi.string().trim().optional(),
    }),
  },
};

// Validation middleware factory
const validate = (schema) => {
  return (req, res, next) => {
    const validationOptions = {
      abortEarly: false, // Include all errors
      allowUnknown: false, // Don't allow unknown keys
      stripUnknown: true, // Remove unknown keys
    };

    const errors = {};

    // Validate each part of the request
    ['params', 'query', 'body'].forEach((key) => {
      if (schema[key]) {
        const { error, value } = schema[key].validate(req[key], validationOptions);
        if (error) {
          errors[key] = error.details.reduce((acc, detail) => {
            const field = detail.path.join('.');
            acc[field] = detail.message;
            return acc;
          }, {});
        } else {
          req[key] = value; // Update request with validated and sanitized values
        }
      }
    });

    // If there are validation errors, return them
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        errors,
      });
    }

    next();
  };
};

module.exports = {
  authValidators,
  validate,
};