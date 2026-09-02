const request = require('supertest');
const app = require('../../server');
const User = require('../../src/models/User');
const Product = require('../../src/models/product.model');
const Order = require('../../src/models/order.model');
const authService = require('../../src/services/auth.service');

describe('Order Endpoints', () => {
  let server;
  let adminToken;
  let userToken;
  let adminUser;
  let normalUser;
  let testProducts;

  beforeAll(() => {
    server = app;
  });

  beforeEach(async () => {
    // Clear data
    await User.deleteMany({});
    await Product.deleteMany({});
    await Order.deleteMany({});

    // Create admin user
    adminUser = await User.create({
      email: 'admin@example.com',
      password: 'AdminPass123!',
      name: 'Admin User',
      role: 'admin',
      isEmailVerified: true,
    });
    adminToken = authService.generateAccessToken(adminUser);

    // Create normal user
    normalUser = await User.create({
      email: 'user@example.com',
      password: 'UserPass123!',
      name: 'Normal User',
      role: 'user',
      isEmailVerified: true,
    });
    userToken = authService.generateAccessToken(normalUser);

    // Create test products
    testProducts = await Product.create([
      {
        name: 'Product 1',
        description: 'Test product 1',
        price: 99.99,
        category: 'Electronics',
        sku: 'PROD001',
        stock: 50,
        isActive: true,
      },
      {
        name: 'Product 2',
        description: 'Test product 2',
        price: 49.99,
        category: 'Electronics',
        sku: 'PROD002',
        stock: 30,
        isActive: true,
      },
      {
        name: 'Product 3',
        description: 'Test product 3',
        price: 19.99,
        category: 'Accessories',
        sku: 'PROD003',
        stock: 0, // Out of stock
        isActive: true,
      },
    ]);
  });

  describe('POST /api/orders', () => {
    const validOrderData = {
      items: [
        {
          product: null, // Will be set in test
          quantity: 2,
        },
        {
          product: null, // Will be set in test
          quantity: 1,
        },
      ],
      shippingAddress: {
        name: 'John Doe',
        street: '123 Main St',
        city: 'New York',
        state: 'NY',
        zipCode: '10001',
        country: 'USA',
      },
      paymentMethod: 'credit_card',
      notes: 'Please deliver between 9 AM - 5 PM',
    };

    beforeEach(() => {
      validOrderData.items[0].product = testProducts[0]._id.toString();
      validOrderData.items[1].product = testProducts[1]._id.toString();
    });

    it('should create order as authenticated user', async () => {
      const response = await request(server)
        .post('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send(validOrderData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        orderNumber: expect.stringMatching(/^ORD-\d{4}-\d+$/),
        user: normalUser._id.toString(),
        status: 'pending',
        paymentStatus: 'pending',
        totalAmount: expect.any(Number),
      });

      // Verify order calculation
      const expectedSubtotal = (99.99 * 2) + (49.99 * 1);
      expect(response.body.data.subtotal).toBeCloseTo(expectedSubtotal, 2);

      // Verify stock was reduced
      const product1 = await Product.findById(testProducts[0]._id);
      expect(product1.stock).toBe(48); // 50 - 2

      const product2 = await Product.findById(testProducts[1]._id);
      expect(product2.stock).toBe(29); // 30 - 1
    });

    it('should not create order without authentication', async () => {
      await request(server)
        .post('/api/orders')
        .send(validOrderData)
        .expect(401);
    });

    it('should validate required fields', async () => {
      const response = await request(server)
        .post('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          items: validOrderData.items,
          // Missing shippingAddress and paymentMethod
        })
        .expect(400);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({ field: 'shippingAddress' })
      );
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({ field: 'paymentMethod' })
      );
    });

    it('should validate order items', async () => {
      const response = await request(server)
        .post('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ...validOrderData,
          items: [
            {
              product: testProducts[0]._id.toString(),
              quantity: 0, // Invalid quantity
            },
          ],
        })
        .expect(400);

      expect(response.body.errors).toBeDefined();
    });

    it('should not create order with out-of-stock product', async () => {
      const response = await request(server)
        .post('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ...validOrderData,
          items: [
            {
              product: testProducts[2]._id.toString(), // Out of stock product
              quantity: 1,
            },
          ],
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('out of stock');
    });

    it('should not create order with insufficient stock', async () => {
      const response = await request(server)
        .post('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ...validOrderData,
          items: [
            {
              product: testProducts[0]._id.toString(),
              quantity: 100, // More than available stock
            },
          ],
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Insufficient stock');
    });

    it('should apply tax and shipping calculations', async () => {
      const response = await request(server)
        .post('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send(validOrderData)
        .expect(201);

      const order = response.body.data;
      expect(order.tax).toBeGreaterThan(0);
      expect(order.shipping).toBeGreaterThan(0);
      expect(order.totalAmount).toBe(order.subtotal + order.tax + order.shipping);
    });
  });

  describe('GET /api/orders', () => {
    let userOrders;

    beforeEach(async () => {
      // Create some orders for the user
      userOrders = await Order.create([
        {
          user: normalUser._id,
          orderNumber: 'ORD-2024-0001',
          items: [
            {
              product: testProducts[0]._id,
              quantity: 1,
              price: testProducts[0].price,
              subtotal: testProducts[0].price,
            },
          ],
          subtotal: 99.99,
          tax: 10.00,
          shipping: 5.00,
          totalAmount: 114.99,
          status: 'pending',
          paymentStatus: 'completed',
          paymentMethod: 'credit_card',
          shippingAddress: {
            name: 'John Doe',
            street: '123 Main St',
            city: 'New York',
            state: 'NY',
            zipCode: '10001',
            country: 'USA',
          },
        },
        {
          user: normalUser._id,
          orderNumber: 'ORD-2024-0002',
          items: [
            {
              product: testProducts[1]._id,
              quantity: 2,
              price: testProducts[1].price,
              subtotal: testProducts[1].price * 2,
            },
          ],
          subtotal: 99.98,
          tax: 10.00,
          shipping: 5.00,
          totalAmount: 114.98,
          status: 'delivered',
          paymentStatus: 'completed',
          paymentMethod: 'paypal',
          shippingAddress: {
            name: 'John Doe',
            street: '123 Main St',
            city: 'New York',
            state: 'NY',
            zipCode: '10001',
            country: 'USA',
          },
        },
      ]);

      // Create an order for another user
      await Order.create({
        user: adminUser._id,
        orderNumber: 'ORD-2024-0003',
        items: [
          {
            product: testProducts[0]._id,
            quantity: 1,
            price: testProducts[0].price,
            subtotal: testProducts[0].price,
          },
        ],
        subtotal: 99.99,
        tax: 10.00,
        shipping: 5.00,
        totalAmount: 114.99,
        status: 'pending',
        paymentStatus: 'pending',
        paymentMethod: 'credit_card',
        shippingAddress: {
          name: 'Admin User',
          street: '456 Admin St',
          city: 'Admin City',
          state: 'AC',
          zipCode: '20002',
          country: 'USA',
        },
      });
    });

    it('should get user orders with pagination', async () => {
      const response = await request(server)
        .get('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.every(order => order.user === normalUser._id.toString())).toBe(true);
      expect(response.body.meta).toMatchObject({
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it('should filter orders by status', async () => {
      const response = await request(server)
        .get('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .query({ status: 'delivered' })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('delivered');
    });

    it('should sort orders', async () => {
      const response = await request(server)
        .get('/api/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .query({ sort: '-createdAt' })
        .expect(200);

      expect(response.body.data[0].orderNumber).toBe('ORD-2024-0002');
      expect(response.body.data[1].orderNumber).toBe('ORD-2024-0001');
    });

    it('should not get orders without authentication', async () => {
      await request(server)
        .get('/api/orders')
        .expect(401);
    });
  });

  describe('GET /api/orders/:id', () => {
    let userOrder;
    let adminOrder;

    beforeEach(async () => {
      userOrder = await Order.create({
        user: normalUser._id,
        orderNumber: 'ORD-2024-0001',
        items: [
          {
            product: testProducts[0]._id,
            quantity: 1,
            price: testProducts[0].price,
            subtotal: testProducts[0].price,
          },
        ],
        subtotal: 99.99,
        tax: 10.00,
        shipping: 5.00,
        totalAmount: 114.99,
        status: 'pending',
        paymentStatus: 'completed',
        paymentMethod: 'credit_card',
        shippingAddress: {
          name: 'John Doe',
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'USA',
        },
      });

      adminOrder = await Order.create({
        user: adminUser._id,
        orderNumber: 'ORD-2024-0002',
        items: [
          {
            product: testProducts[0]._id,
            quantity: 1,
            price: testProducts[0].price,
            subtotal: testProducts[0].price,
          },
        ],
        subtotal: 99.99,
        tax: 10.00,
        shipping: 5.00,
        totalAmount: 114.99,
        status: 'pending',
        paymentStatus: 'pending',
        paymentMethod: 'credit_card',
        shippingAddress: {
          name: 'Admin User',
          street: '456 Admin St',
          city: 'Admin City',
          state: 'AC',
          zipCode: '20002',
          country: 'USA',
        },
      });
    });

    it('should get own order details', async () => {
      const response = await request(server)
        .get(`/api/orders/${userOrder._id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        orderNumber: 'ORD-2024-0001',
        totalAmount: 114.99,
        status: 'pending',
      });
    });

    it('should not get other user order', async () => {
      const response = await request(server)
        .get(`/api/orders/${adminOrder._id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Access denied');
    });

    it('should get any order as admin', async () => {
      const response = await request(server)
        .get(`/api/orders/${userOrder._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.orderNumber).toBe('ORD-2024-0001');
    });

    it('should return 404 for non-existent order', async () => {
      const fakeId = '507f1f77bcf86cd799439999';
      const response = await request(server)
        .get(`/api/orders/${fakeId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not found');
    });
  });

  describe('DELETE /api/orders/:id (Cancel Order)', () => {
    let userOrder;

    beforeEach(async () => {
      userOrder = await Order.create({
        user: normalUser._id,
        orderNumber: 'ORD-2024-0001',
        items: [
          {
            product: testProducts[0]._id,
            quantity: 2,
            price: testProducts[0].price,
            subtotal: testProducts[0].price * 2,
          },
        ],
        subtotal: 199.98,
        tax: 20.00,
        shipping: 10.00,
        totalAmount: 229.98,
        status: 'pending',
        paymentStatus: 'completed',
        paymentMethod: 'credit_card',
        shippingAddress: {
          name: 'John Doe',
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'USA',
        },
      });

      // Reduce stock to simulate order placement
      await Product.findByIdAndUpdate(testProducts[0]._id, { $inc: { stock: -2 } });
    });

    it('should cancel pending order', async () => {
      const response = await request(server)
        .delete(`/api/orders/${userOrder._id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('cancelled');

      // Verify order status
      const cancelledOrder = await Order.findById(userOrder._id);
      expect(cancelledOrder.status).toBe('cancelled');

      // Verify stock was restored
      const product = await Product.findById(testProducts[0]._id);
      expect(product.stock).toBe(50); // Original stock restored
    });

    it('should not cancel shipped order', async () => {
      // Update order to shipped status
      userOrder.status = 'shipped';
      await userOrder.save();

      const response = await request(server)
        .delete(`/api/orders/${userOrder._id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('cannot be cancelled');
    });

    it('should not cancel other user order', async () => {
      const response = await request(server)
        .delete(`/api/orders/${userOrder._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Admin Order Management', () => {
    let testOrder;

    beforeEach(async () => {
      testOrder = await Order.create({
        user: normalUser._id,
        orderNumber: 'ORD-2024-0001',
        items: [
          {
            product: testProducts[0]._id,
            quantity: 1,
            price: testProducts[0].price,
            subtotal: testProducts[0].price,
          },
        ],
        subtotal: 99.99,
        tax: 10.00,
        shipping: 5.00,
        totalAmount: 114.99,
        status: 'pending',
        paymentStatus: 'completed',
        paymentMethod: 'credit_card',
        shippingAddress: {
          name: 'John Doe',
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'USA',
        },
      });
    });

    describe('GET /api/orders/admin/all', () => {
      it('should get all orders as admin', async () => {
        // Create additional order
        await Order.create({
          user: adminUser._id,
          orderNumber: 'ORD-2024-0002',
          items: [
            {
              product: testProducts[1]._id,
              quantity: 1,
              price: testProducts[1].price,
              subtotal: testProducts[1].price,
            },
          ],
          subtotal: 49.99,
          tax: 5.00,
          shipping: 5.00,
          totalAmount: 59.99,
          status: 'delivered',
          paymentStatus: 'completed',
          paymentMethod: 'paypal',
          shippingAddress: {
            name: 'Admin User',
            street: '456 Admin St',
            city: 'Admin City',
            state: 'AC',
            zipCode: '20002',
            country: 'USA',
          },
        });

        const response = await request(server)
          .get('/api/orders/admin/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .query({ page: 1, limit: 10 })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveLength(2);
        expect(response.body.meta.total).toBe(2);
      });

      it('should filter orders by date range', async () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const response = await request(server)
          .get('/api/orders/admin/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .query({
            startDate: yesterday.toISOString().split('T')[0],
            endDate: tomorrow.toISOString().split('T')[0],
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.length).toBeGreaterThan(0);
      });

      it('should not access admin orders as normal user', async () => {
        await request(server)
          .get('/api/orders/admin/all')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);
      });
    });

    describe('PUT /api/orders/:id/status', () => {
      it('should update order status as admin', async () => {
        const response = await request(server)
          .put(`/api/orders/${testOrder._id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'processing' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.status).toBe('processing');

        // Verify status history
        const updatedOrder = await Order.findById(testOrder._id);
        expect(updatedOrder.statusHistory).toHaveLength(2);
        expect(updatedOrder.statusHistory[1]).toMatchObject({
          status: 'processing',
          updatedBy: adminUser._id,
        });
      });

      it('should validate status transition', async () => {
        // Update to delivered
        testOrder.status = 'delivered';
        await testOrder.save();

        // Try to update back to pending
        const response = await request(server)
          .put(`/api/orders/${testOrder._id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'pending' })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Invalid status transition');
      });

      it('should not update status as normal user', async () => {
        await request(server)
          .put(`/api/orders/${testOrder._id}/status`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ status: 'processing' })
          .expect(403);
      });
    });

    describe('POST /api/orders/:id/tracking', () => {
      it('should add tracking information as admin', async () => {
        const trackingData = {
          carrier: 'FedEx',
          trackingNumber: 'FDX123456789',
          estimatedDelivery: '2024-01-20',
        };

        const response = await request(server)
          .post(`/api/orders/${testOrder._id}/tracking`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send(trackingData)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.tracking).toMatchObject(trackingData);
      });

      it('should validate tracking data', async () => {
        const response = await request(server)
          .post(`/api/orders/${testOrder._id}/tracking`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            carrier: 'FedEx',
            // Missing trackingNumber
          })
          .expect(400);

        expect(response.body.errors).toBeDefined();
      });
    });

    describe('POST /api/orders/:id/refund', () => {
      it('should process refund as admin', async () => {
        const refundData = {
          amount: 50.00,
          reason: 'Product defect',
        };

        const response = await request(server)
          .post(`/api/orders/${testOrder._id}/refund`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send(refundData)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.refunds).toHaveLength(1);
        expect(response.body.data.refunds[0]).toMatchObject({
          amount: refundData.amount,
          reason: refundData.reason,
          processedBy: adminUser._id.toString(),
        });
      });

      it('should not refund more than order total', async () => {
        const response = await request(server)
          .post(`/api/orders/${testOrder._id}/refund`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            amount: 1000.00, // More than order total
            reason: 'Test',
          })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('exceeds');
      });
    });
  });

  describe('Order Statistics and Reports', () => {
    beforeEach(async () => {
      // Create multiple orders for statistics
      const orderData = [
        {
          user: normalUser._id,
          status: 'delivered',
          paymentStatus: 'completed',
          totalAmount: 150.00,
          createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        },
        {
          user: normalUser._id,
          status: 'delivered',
          paymentStatus: 'completed',
          totalAmount: 200.00,
          createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
        },
        {
          user: adminUser._id,
          status: 'pending',
          paymentStatus: 'pending',
          totalAmount: 100.00,
          createdAt: new Date(), // Today
        },
      ];

      for (const data of orderData) {
        await Order.create({
          ...data,
          orderNumber: `ORD-2024-${Math.floor(Math.random() * 10000)}`,
          items: [
            {
              product: testProducts[0]._id,
              quantity: 1,
              price: testProducts[0].price,
              subtotal: testProducts[0].price,
            },
          ],
          subtotal: data.totalAmount * 0.8,
          tax: data.totalAmount * 0.1,
          shipping: data.totalAmount * 0.1,
          paymentMethod: 'credit_card',
          shippingAddress: {
            name: 'Test User',
            street: '123 Test St',
            city: 'Test City',
            state: 'TC',
            zipCode: '12345',
            country: 'USA',
          },
        });
      }
    });

    describe('GET /api/orders/statistics/summary', () => {
      it('should get order statistics', async () => {
        const response = await request(server)
          .get('/api/orders/statistics/summary')
          .set('Authorization', `Bearer ${userToken}`)
          .query({ period: 'week' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toMatchObject({
          totalOrders: expect.any(Number),
          totalRevenue: expect.any(Number),
          averageOrderValue: expect.any(Number),
          ordersByStatus: expect.any(Object),
        });
      });

      it('should filter statistics by period', async () => {
        const weekResponse = await request(server)
          .get('/api/orders/statistics/summary')
          .set('Authorization', `Bearer ${userToken}`)
          .query({ period: 'week' })
          .expect(200);

        const monthResponse = await request(server)
          .get('/api/orders/statistics/summary')
          .set('Authorization', `Bearer ${userToken}`)
          .query({ period: 'month' })
          .expect(200);

        // Month should have more or equal orders than week
        expect(monthResponse.body.data.totalOrders)
          .toBeGreaterThanOrEqual(weekResponse.body.data.totalOrders);
      });
    });

    describe('GET /api/orders/reports/sales', () => {
      it('should get sales report as admin', async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const endDate = new Date();

        const response = await request(server)
          .get('/api/orders/reports/sales')
          .set('Authorization', `Bearer ${adminToken}`)
          .query({
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toMatchObject({
          summary: expect.objectContaining({
            totalOrders: expect.any(Number),
            totalRevenue: expect.any(Number),
            totalTax: expect.any(Number),
            totalShipping: expect.any(Number),
          }),
          byCategory: expect.any(Object),
          byPaymentMethod: expect.any(Object),
          topProducts: expect.any(Array),
        });
      });

      it('should not get sales report as normal user', async () => {
        await request(server)
          .get('/api/orders/reports/sales')
          .set('Authorization', `Bearer ${userToken}`)
          .query({
            startDate: '2024-01-01',
            endDate: '2024-12-31',
          })
          .expect(403);
      });
    });

    describe('GET /api/orders/:id/invoice', () => {
      let testOrder;

      beforeEach(async () => {
        testOrder = await Order.create({
          user: normalUser._id,
          orderNumber: 'ORD-2024-INV001',
          items: [
            {
              product: testProducts[0]._id,
              quantity: 2,
              price: testProducts[0].price,
              subtotal: testProducts[0].price * 2,
            },
          ],
          subtotal: 199.98,
          tax: 20.00,
          shipping: 10.00,
          totalAmount: 229.98,
          status: 'delivered',
          paymentStatus: 'completed',
          paymentMethod: 'credit_card',
          shippingAddress: {
            name: 'John Doe',
            street: '123 Main St',
            city: 'New York',
            state: 'NY',
            zipCode: '10001',
            country: 'USA',
          },
        });
      });

      it('should get order invoice', async () => {
        const response = await request(server)
          .get(`/api/orders/${testOrder._id}/invoice`)
          .set('Authorization', `Bearer ${userToken}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toMatchObject({
          invoice: expect.objectContaining({
            orderNumber: 'ORD-2024-INV001',
            invoiceNumber: expect.stringMatching(/^INV-\d{4}-\d+$/),
            totalAmount: 229.98,
          }),
        });
      });

      it('should not get invoice for other user order', async () => {
        const adminOrder = await Order.create({
          user: adminUser._id,
          orderNumber: 'ORD-2024-ADM001',
          items: [
            {
              product: testProducts[0]._id,
              quantity: 1,
              price: testProducts[0].price,
              subtotal: testProducts[0].price,
            },
          ],
          subtotal: 99.99,
          tax: 10.00,
          shipping: 5.00,
          totalAmount: 114.99,
          status: 'pending',
          paymentStatus: 'completed',
          paymentMethod: 'credit_card',
          shippingAddress: {
            name: 'Admin User',
            street: '456 Admin St',
            city: 'Admin City',
            state: 'AC',
            zipCode: '20002',
            country: 'USA',
          },
        });

        await request(server)
          .get(`/api/orders/${adminOrder._id}/invoice`)
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);
      });
    });
  });
});