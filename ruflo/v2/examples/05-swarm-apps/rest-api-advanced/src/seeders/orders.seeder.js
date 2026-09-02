const mongoose = require('mongoose');
const Order = require('../models/order.model');
const Product = require('../models/product.model');
const User = require('../models/User');
const bcrypt = require('bcrypt');

const firstNames = ['John', 'Jane', 'Mike', 'Sarah', 'David', 'Emma', 'Chris', 'Lisa', 'Tom', 'Amy'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Moore', 'Jackson'];

const streets = ['Main St', 'Oak Ave', 'Elm St', 'Park Rd', 'Cedar Ln', 'Maple Ave', 'Pine St', 'Washington Blvd'];
const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego'];
const states = ['NY', 'CA', 'IL', 'TX', 'AZ', 'PA', 'TX', 'CA'];

async function seedOrders() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/rest-api-advanced');
    
    console.log('Connected to MongoDB');
    
    // Clear existing orders
    await Order.deleteMany({});
    console.log('Cleared existing orders');
    
    // Get all products
    const products = await Product.find({ status: 'active' }).limit(50);
    if (products.length === 0) {
      console.error('No products found. Please run products seeder first.');
      process.exit(1);
    }
    
    // Create test users
    const users = [];
    for (let i = 0; i < 10; i++) {
      const firstName = firstNames[i];
      const lastName = lastNames[i];
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`;
      
      let user = await User.findOne({ email });
      if (!user) {
        const hashedPassword = await bcrypt.hash('password123', 10);
        user = await User.create({
          email,
          password: hashedPassword,
          name: `${firstName} ${lastName}`,
          role: 'user',
          isEmailVerified: true,
          phone: `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`,
          address: {
            street: `${Math.floor(Math.random() * 9999) + 1} ${streets[Math.floor(Math.random() * streets.length)]}`,
            city: cities[i % cities.length],
            state: states[i % states.length],
            zipCode: `${Math.floor(Math.random() * 90000) + 10000}`,
            country: 'USA',
          },
        });
      }
      users.push(user);
    }
    console.log(`Created/verified ${users.length} users`);
    
    // Create orders
    const orders = [];
    const orderStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
    const paymentMethods = ['credit_card', 'debit_card', 'paypal', 'stripe'];
    const shippingMethods = ['standard', 'express', 'overnight'];
    
    // Create 50 orders over the past 90 days
    for (let i = 0; i < 50; i++) {
      const user = users[Math.floor(Math.random() * users.length)];
      const numItems = Math.floor(Math.random() * 4) + 1; // 1-4 items per order
      const orderDate = new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000);
      
      // Select random products
      const orderItems = [];
      const selectedProducts = [];
      
      for (let j = 0; j < numItems; j++) {
        let product;
        do {
          product = products[Math.floor(Math.random() * products.length)];
        } while (selectedProducts.includes(product._id.toString()));
        
        selectedProducts.push(product._id.toString());
        
        const quantity = Math.floor(Math.random() * 3) + 1;
        orderItems.push({
          product: product._id,
          name: product.name,
          image: product.images[0]?.url,
          price: product.price,
          quantity,
          subtotal: product.price * quantity,
        });
      }
      
      // Calculate totals
      const subtotal = orderItems.reduce((total, item) => total + item.subtotal, 0);
      const taxRate = 8.5; // 8.5% tax
      const taxAmount = subtotal * (taxRate / 100);
      const shippingMethod = shippingMethods[Math.floor(Math.random() * shippingMethods.length)];
      const shippingAmount = shippingMethod === 'standard' ? (subtotal > 50 ? 0 : 5.99) :
                            shippingMethod === 'express' ? 14.99 : 29.99;
      const discountAmount = Math.random() > 0.7 ? subtotal * 0.1 : 0; // 30% chance of 10% discount
      const totalAmount = subtotal + taxAmount + shippingAmount - discountAmount;
      
      // Generate order status based on date
      const daysSinceOrder = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
      let status;
      if (daysSinceOrder < 2) {
        status = Math.random() > 0.1 ? 'pending' : 'cancelled';
      } else if (daysSinceOrder < 4) {
        status = Math.random() > 0.1 ? 'confirmed' : 'cancelled';
      } else if (daysSinceOrder < 7) {
        status = Math.random() > 0.1 ? 'processing' : 'cancelled';
      } else if (daysSinceOrder < 14) {
        status = Math.random() > 0.1 ? 'shipped' : 'cancelled';
      } else {
        status = Math.random() > 0.05 ? 'delivered' : 'cancelled';
      }
      
      // Create shipping address
      const shippingAddress = {
        fullName: user.name,
        phone: user.phone,
        email: user.email,
        street: user.address.street,
        apartment: Math.random() > 0.7 ? `Apt ${Math.floor(Math.random() * 999) + 1}` : '',
        city: user.address.city,
        state: user.address.state,
        zipCode: user.address.zipCode,
        country: user.address.country,
        instructions: Math.random() > 0.8 ? 'Leave at door' : '',
      };
      
      // Create order
      const order = {
        user: user._id,
        items: orderItems,
        status,
        subtotal,
        taxAmount,
        taxRate,
        shippingAmount,
        shippingMethod,
        discountAmount,
        discountCode: discountAmount > 0 ? 'SAVE10' : null,
        totalAmount,
        currency: 'USD',
        shippingAddress,
        billingAddressSameAsShipping: Math.random() > 0.2,
        payment: {
          method: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
          status: status === 'cancelled' ? 'failed' : 'completed',
          transactionId: `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          amount: totalAmount,
          currency: 'USD',
          paidAt: status !== 'cancelled' ? new Date(orderDate.getTime() + 60000) : null,
        },
        source: 'web',
        createdAt: orderDate,
        updatedAt: orderDate,
      };
      
      // Add tracking for shipped/delivered orders
      if (['shipped', 'delivered'].includes(status)) {
        const shippedDate = new Date(orderDate.getTime() + 3 * 24 * 60 * 60 * 1000);
        order.tracking = {
          carrier: ['UPS', 'FedEx', 'USPS', 'DHL'][Math.floor(Math.random() * 4)],
          number: `1Z${Math.random().toString(36).substr(2, 15).toUpperCase()}`,
          url: 'https://tracking.example.com',
          estimatedDelivery: new Date(shippedDate.getTime() + 4 * 24 * 60 * 60 * 1000),
          shippedAt: shippedDate,
        };
        
        if (status === 'delivered') {
          order.tracking.deliveredAt = new Date(shippedDate.getTime() + Math.floor(Math.random() * 4 + 2) * 24 * 60 * 60 * 1000);
        }
      }
      
      // Add cancellation info for cancelled orders
      if (status === 'cancelled') {
        order.cancelReason = ['Changed mind', 'Found better price', 'Ordered by mistake', 'Product not needed anymore'][Math.floor(Math.random() * 4)];
        order.cancelledAt = new Date(orderDate.getTime() + Math.random() * 2 * 24 * 60 * 60 * 1000);
      }
      
      orders.push(order);
    }
    
    // Insert all orders
    const createdOrders = await Order.insertMany(orders);
    console.log(`Created ${createdOrders.length} orders`);
    
    // Update product sales counts
    for (const order of createdOrders) {
      if (order.status !== 'cancelled') {
        for (const item of order.items) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { salesCount: item.quantity },
          });
        }
      }
    }
    console.log('Updated product sales counts');
    
    // Display summary
    const summary = await Order.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
          avgOrderValue: { $avg: '$totalAmount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    
    console.log('\nOrder Summary by Status:');
    console.table(summary.map(s => ({
      Status: s._id,
      Count: s.count,
      'Total Revenue': `$${s.totalRevenue.toFixed(2)}`,
      'Avg Order Value': `$${s.avgOrderValue.toFixed(2)}`,
    })));
    
    // Monthly summary
    const monthlySummary = await Order.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          orders: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    
    console.log('\nMonthly Order Summary:');
    console.table(monthlySummary.map(s => ({
      Month: s._id,
      Orders: s.orders,
      Revenue: `$${s.revenue.toFixed(2)}`,
    })));
    
    console.log('\nSeeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
}

// Run seeder if called directly
if (require.main === module) {
  seedOrders();
}

module.exports = seedOrders;