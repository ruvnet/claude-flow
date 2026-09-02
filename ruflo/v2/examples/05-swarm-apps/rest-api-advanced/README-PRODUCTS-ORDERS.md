# Product and Order Management System

This REST API now includes a complete product and order management system with advanced features for e-commerce applications.

## Features

### Product Management
- **Full CRUD operations** for products with validation
- **Advanced search** with text search, filters, and facets
- **Category management** with subcategories
- **Inventory tracking** with stock levels and alerts
- **Product reviews** with ratings and verified purchase badges
- **Image management** with multiple images per product
- **Related products** recommendations
- **Dynamic pricing** based on demand
- **Bulk operations** for inventory updates
- **Product analytics** and reporting

### Order Management
- **Complete order lifecycle** from creation to delivery
- **Order status tracking** with history
- **Payment processing** integration ready
- **Shipping management** with tracking numbers
- **Refund processing** with partial refunds
- **Order statistics** and sales reports
- **Invoice generation** support
- **Fraud detection** system
- **Customer order history**

## Models

### Product Model (`src/models/product.model.js`)
```javascript
{
  name: String,
  slug: String,
  description: String,
  price: Number,
  comparePrice: Number,
  category: String,
  subcategory: String,
  brand: String,
  sku: String,
  inventory: {
    quantity: Number,
    trackInventory: Boolean,
    allowBackorder: Boolean,
    lowStockThreshold: Number
  },
  images: [{
    url: String,
    alt: String,
    position: Number,
    isMain: Boolean
  }],
  reviews: [{
    user: ObjectId,
    rating: Number,
    comment: String,
    isVerifiedPurchase: Boolean,
    helpful: { yes: Number, no: Number }
  }],
  rating: {
    average: Number,
    count: Number,
    distribution: Object
  },
  tags: [String],
  specifications: [{ key: String, value: String }],
  status: String,
  featured: Boolean,
  relatedProducts: [ObjectId]
}
```

### Order Model (`src/models/order.model.js`)
```javascript
{
  orderNumber: String,
  user: ObjectId,
  items: [{
    product: ObjectId,
    name: String,
    price: Number,
    quantity: Number,
    subtotal: Number
  }],
  status: String,
  totalAmount: Number,
  shippingAddress: Object,
  billingAddress: Object,
  payment: {
    method: String,
    status: String,
    transactionId: String
  },
  tracking: {
    carrier: String,
    number: String,
    url: String,
    deliveredAt: Date
  },
  history: [{ status: String, timestamp: Date }]
}
```

## API Endpoints

### Product Endpoints
- `GET /api/products` - Search and list products with filters
- `GET /api/products/:id` - Get product details
- `POST /api/products` - Create new product (admin)
- `PUT /api/products/:id` - Update product (admin)
- `DELETE /api/products/:id` - Delete product (admin)
- `GET /api/products/category/:category` - Get products by category
- `GET /api/products/featured` - Get featured products
- `GET /api/products/popular` - Get popular products
- `POST /api/products/:id/reviews` - Add product review
- `PUT /api/products/:id/inventory` - Update inventory (admin)
- `GET /api/products/inventory/report` - Get inventory report (admin)

### Order Endpoints
- `GET /api/orders` - Get user orders
- `GET /api/orders/:id` - Get order details
- `POST /api/orders` - Create new order
- `PUT /api/orders/:id/status` - Update order status (admin)
- `DELETE /api/orders/:id` - Cancel order
- `POST /api/orders/:id/tracking` - Add tracking info (admin)
- `POST /api/orders/:id/refund` - Process refund (admin)
- `GET /api/orders/statistics/summary` - Get order statistics
- `GET /api/orders/reports/sales` - Get sales report (admin)
- `GET /api/orders/:id/invoice` - Get order invoice

## Database Seeders

Populate your database with sample data:

```bash
# Seed all data
npm run seed

# Seed only products
npm run seed:products

# Seed only orders (requires products)
npm run seed:orders
```

## Usage Examples

### Search Products
```bash
GET /api/products?q=wireless&category=Electronics&minPrice=50&maxPrice=200&sort=-rating
```

### Create Order
```bash
POST /api/orders
{
  "items": [
    {
      "product": "65abc123...",
      "quantity": 2
    }
  ],
  "shippingAddress": {
    "fullName": "John Doe",
    "phone": "+1234567890",
    "email": "john@example.com",
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001",
    "country": "USA"
  },
  "paymentMethod": "credit_card"
}
```

### Add Product Review
```bash
POST /api/products/:id/reviews
{
  "rating": 5,
  "comment": "Excellent product! Highly recommended.",
  "images": ["https://example.com/review1.jpg"]
}
```

### Update Inventory
```bash
PUT /api/products/:id/inventory
{
  "quantity": 50,
  "operation": "set"  // or "increment", "decrement"
}
```

## Services

### ProductService (`src/services/product.service.js`)
- Product caching with Redis
- Bulk availability checking
- Dynamic pricing calculations
- Product recommendations
- Advanced search with facets
- Analytics and reporting

### OrderService (`src/services/order.service.js`)
- Order total calculations
- Discount validation
- Inventory reservation
- Payment processing integration
- Shipping calculations
- Fraud risk assessment
- Order metrics and dashboards

## Validators

All endpoints include comprehensive validation:
- Product creation/update validation
- Order validation with address verification
- Review validation with rating limits
- Inventory validation
- Search parameter validation

## Business Logic Features

1. **Inventory Management**
   - Automatic low stock alerts
   - Backorder support
   - Stock reservation during checkout
   - Bulk inventory updates

2. **Review System**
   - Verified purchase badges
   - Helpful/unhelpful voting
   - Review statistics
   - Image uploads for reviews

3. **Order Processing**
   - Status workflow enforcement
   - Automatic inventory updates
   - Payment integration ready
   - Shipping carrier integration

4. **Analytics**
   - Product performance metrics
   - Sales reports by period
   - Category analytics
   - Customer behavior tracking

## Security Features

- Input validation on all endpoints
- SQL/NoSQL injection prevention
- XSS protection
- Rate limiting
- Authentication required for sensitive operations
- Role-based access control (admin/user)

## Performance Optimizations

- Redis caching for products
- Database indexes for search
- Pagination on all list endpoints
- Efficient aggregation queries
- Bulk operations support

## Testing

The system includes comprehensive test coverage:
- Unit tests for models and services
- Integration tests for API endpoints
- Validation tests
- Business logic tests

Run tests with:
```bash
npm test
```

## Environment Variables

Add these to your `.env` file:
```env
# Redis (for caching)
REDIS_URL=redis://localhost:6379

# Payment Gateway (when implementing)
STRIPE_SECRET_KEY=your_stripe_key
PAYPAL_CLIENT_ID=your_paypal_id

# Shipping (when implementing)
SHIPPING_API_KEY=your_shipping_key
```

## Next Steps

1. Implement actual payment gateway integration (Stripe, PayPal)
2. Add real shipping carrier APIs (UPS, FedEx, USPS)
3. Implement email notifications for orders
4. Add webhook support for payment/shipping updates
5. Implement cart persistence with Redis
6. Add product recommendations engine
7. Implement discount/coupon system
8. Add multi-currency support
9. Implement product variants (size, color)
10. Add wishlist functionality