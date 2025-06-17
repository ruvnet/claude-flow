const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Advanced REST API',
      version: '1.0.0',
      description: 'A production-ready REST API with authentication, validation, and best practices',
      termsOfService: 'http://example.com/terms/',
      contact: {
        name: 'API Support',
        url: 'http://example.com/support',
        email: 'support@example.com',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
      {
        url: 'https://api.example.com',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token in the format: Bearer <token>',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            message: {
              type: 'string',
              example: 'Error message',
            },
            error: {
              type: 'object',
              properties: {
                statusCode: {
                  type: 'integer',
                  example: 400,
                },
                message: {
                  type: 'string',
                  example: 'Detailed error message',
                },
              },
            },
          },
        },
        ValidationError: {
          type: 'object',
          properties: {
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: {
                    type: 'string',
                    example: 'email',
                  },
                  message: {
                    type: 'string',
                    example: 'Invalid email format',
                  },
                },
              },
            },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            total: {
              type: 'integer',
              example: 100,
            },
            page: {
              type: 'integer',
              example: 1,
            },
            limit: {
              type: 'integer',
              example: 20,
            },
            totalPages: {
              type: 'integer',
              example: 5,
            },
            hasNextPage: {
              type: 'boolean',
              example: true,
            },
            hasPrevPage: {
              type: 'boolean',
              example: false,
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              example: '507f1f77bcf86cd799439011',
            },
            email: {
              type: 'string',
              format: 'email',
              example: 'user@example.com',
            },
            name: {
              type: 'string',
              example: 'John Doe',
            },
            role: {
              type: 'string',
              enum: ['user', 'admin'],
              example: 'user',
            },
            isEmailVerified: {
              type: 'boolean',
              example: true,
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              example: '2024-01-01T00:00:00.000Z',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              example: '2024-01-01T00:00:00.000Z',
            },
          },
        },
        Product: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              example: '507f1f77bcf86cd799439011',
            },
            name: {
              type: 'string',
              example: 'Product Name',
            },
            description: {
              type: 'string',
              example: 'Product description',
            },
            price: {
              type: 'number',
              format: 'float',
              example: 29.99,
            },
            category: {
              type: 'string',
              example: 'Electronics',
            },
            sku: {
              type: 'string',
              example: 'SKU123456',
            },
            stock: {
              type: 'integer',
              example: 100,
            },
            images: {
              type: 'array',
              items: {
                type: 'string',
                format: 'url',
              },
              example: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
            },
            isActive: {
              type: 'boolean',
              example: true,
            },
            tags: {
              type: 'array',
              items: {
                type: 'string',
              },
              example: ['new', 'featured'],
            },
            averageRating: {
              type: 'number',
              format: 'float',
              example: 4.5,
            },
            reviewCount: {
              type: 'integer',
              example: 25,
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        Review: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            user: {
              type: 'string',
              format: 'uuid',
            },
            rating: {
              type: 'integer',
              minimum: 1,
              maximum: 5,
              example: 5,
            },
            title: {
              type: 'string',
              example: 'Great product!',
            },
            comment: {
              type: 'string',
              example: 'I love this product. Highly recommended!',
            },
            helpfulCount: {
              type: 'integer',
              example: 10,
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        Order: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              example: '507f1f77bcf86cd799439011',
            },
            orderNumber: {
              type: 'string',
              example: 'ORD-2024-0001',
            },
            user: {
              type: 'string',
              format: 'uuid',
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  product: {
                    type: 'string',
                    format: 'uuid',
                  },
                  quantity: {
                    type: 'integer',
                    minimum: 1,
                    example: 2,
                  },
                  price: {
                    type: 'number',
                    format: 'float',
                    example: 29.99,
                  },
                  subtotal: {
                    type: 'number',
                    format: 'float',
                    example: 59.98,
                  },
                },
              },
            },
            subtotal: {
              type: 'number',
              format: 'float',
              example: 59.98,
            },
            tax: {
              type: 'number',
              format: 'float',
              example: 5.40,
            },
            shipping: {
              type: 'number',
              format: 'float',
              example: 10.00,
            },
            totalAmount: {
              type: 'number',
              format: 'float',
              example: 75.38,
            },
            status: {
              type: 'string',
              enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
              example: 'pending',
            },
            paymentMethod: {
              type: 'string',
              enum: ['credit_card', 'debit_card', 'paypal', 'stripe'],
              example: 'credit_card',
            },
            paymentStatus: {
              type: 'string',
              enum: ['pending', 'completed', 'failed', 'refunded'],
              example: 'completed',
            },
            shippingAddress: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  example: 'John Doe',
                },
                street: {
                  type: 'string',
                  example: '123 Main St',
                },
                city: {
                  type: 'string',
                  example: 'New York',
                },
                state: {
                  type: 'string',
                  example: 'NY',
                },
                zipCode: {
                  type: 'string',
                  example: '10001',
                },
                country: {
                  type: 'string',
                  example: 'USA',
                },
              },
            },
            tracking: {
              type: 'object',
              properties: {
                carrier: {
                  type: 'string',
                  example: 'FedEx',
                },
                trackingNumber: {
                  type: 'string',
                  example: '1234567890',
                },
                estimatedDelivery: {
                  type: 'string',
                  format: 'date',
                  example: '2024-01-15',
                },
              },
            },
            notes: {
              type: 'string',
              example: 'Please leave package at front door',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        AuthRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: {
              type: 'string',
              format: 'email',
              example: 'user@example.com',
            },
            password: {
              type: 'string',
              format: 'password',
              minLength: 6,
              example: 'password123',
            },
          },
        },
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password', 'name'],
          properties: {
            email: {
              type: 'string',
              format: 'email',
              example: 'user@example.com',
            },
            password: {
              type: 'string',
              format: 'password',
              minLength: 6,
              example: 'password123',
            },
            name: {
              type: 'string',
              minLength: 2,
              example: 'John Doe',
            },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            token: {
              type: 'string',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            },
            refreshToken: {
              type: 'string',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            },
            user: {
              $ref: '#/components/schemas/User',
            },
          },
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
              example: {
                success: false,
                message: 'Authentication required',
                error: {
                  statusCode: 401,
                  message: 'Please authenticate',
                },
              },
            },
          },
        },
        ForbiddenError: {
          description: 'Access forbidden',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
              example: {
                success: false,
                message: 'Access forbidden',
                error: {
                  statusCode: 403,
                  message: 'You do not have permission to perform this action',
                },
              },
            },
          },
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
              example: {
                success: false,
                message: 'Resource not found',
                error: {
                  statusCode: 404,
                  message: 'The requested resource was not found',
                },
              },
            },
          },
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ValidationError',
              },
              example: {
                errors: [
                  {
                    field: 'email',
                    message: 'Invalid email format',
                  },
                  {
                    field: 'password',
                    message: 'Password must be at least 6 characters',
                  },
                ],
              },
            },
          },
        },
        RateLimitError: {
          description: 'Too many requests',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
              example: {
                success: false,
                message: 'Too many requests',
                error: {
                  statusCode: 429,
                  message: 'Too many requests from this IP, please try again later',
                },
              },
            },
          },
        },
      },
      parameters: {
        IdParameter: {
          name: 'id',
          in: 'path',
          description: 'Resource ID',
          required: true,
          schema: {
            type: 'string',
            format: 'uuid',
          },
        },
        PageParameter: {
          name: 'page',
          in: 'query',
          description: 'Page number',
          schema: {
            type: 'integer',
            minimum: 1,
            default: 1,
          },
        },
        LimitParameter: {
          name: 'limit',
          in: 'query',
          description: 'Number of items per page',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 20,
          },
        },
        SortParameter: {
          name: 'sort',
          in: 'query',
          description: 'Sort field and order (prefix with - for descending)',
          schema: {
            type: 'string',
            example: '-createdAt',
          },
        },
        SearchParameter: {
          name: 'search',
          in: 'query',
          description: 'Search query',
          schema: {
            type: 'string',
          },
        },
      },
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization endpoints',
      },
      {
        name: 'Users',
        description: 'User management endpoints',
      },
      {
        name: 'Products',
        description: 'Product catalog management',
      },
      {
        name: 'Orders',
        description: 'Order management and processing',
      },
      {
        name: 'Health',
        description: 'API health and status checks',
      },
    ],
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/routes/*.js', './src/models/*.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

module.exports = {
  swaggerUi,
  swaggerSpec,
  swaggerOptions,
};