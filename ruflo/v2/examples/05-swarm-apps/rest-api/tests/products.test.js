const request = require('supertest');
const app = require('../src/server');

describe('Products API Tests', () => {
  describe('GET /api/v1/products', () => {
    it('should get all products', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should filter by category', async () => {
      const response = await request(app)
        .get('/api/v1/products?category=Electronics')
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.data.forEach(product => {
        expect(product.category).toBe('Electronics');
      });
    });

    it('should filter by price range', async () => {
      const response = await request(app)
        .get('/api/v1/products?minPrice=50&maxPrice=100')
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.data.forEach(product => {
        expect(product.price).toBeGreaterThanOrEqual(50);
        expect(product.price).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('GET /api/v1/products/:id', () => {
    it('should get product by id', async () => {
      const response = await request(app)
        .get('/api/v1/products/1')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', 1);
      expect(response.body.data).toHaveProperty('name');
      expect(response.body.data).toHaveProperty('price');
      expect(response.body.data).toHaveProperty('category');
    });

    it('should return 404 for non-existent product', async () => {
      const response = await request(app)
        .get('/api/v1/products/9999')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Product not found');
    });
  });

  describe('POST /api/v1/products', () => {
    it('should create a new product', async () => {
      const newProduct = {
        name: 'Test Product',
        price: 49.99,
        category: 'Test Category',
        stock: 10,
        description: 'Test description'
      };

      const response = await request(app)
        .post('/api/v1/products')
        .send(newProduct)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Product created successfully');
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.name).toBe(newProduct.name);
      expect(response.body.data.price).toBe(newProduct.price);
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .send({ name: 'Test' }) // Missing price and category
        .expect(400);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should validate price is positive', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .send({ 
          name: 'Test',
          price: -10,
          category: 'Test'
        })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
      expect(response.body.errors[0].msg).toContain('Price must be a positive number');
    });
  });

  describe('PUT /api/v1/products/:id', () => {
    it('should update product', async () => {
      const updateData = {
        name: 'Updated Product',
        price: 149.99,
        category: 'Updated Category',
        stock: 25
      };

      const response = await request(app)
        .put('/api/v1/products/1')
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Product updated successfully');
      expect(response.body.data.name).toBe(updateData.name);
      expect(response.body.data.price).toBe(updateData.price);
    });

    it('should return 404 for non-existent product', async () => {
      const response = await request(app)
        .put('/api/v1/products/9999')
        .send({ 
          name: 'Test',
          price: 10,
          category: 'Test'
        })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Product not found');
    });
  });

  describe('DELETE /api/v1/products/:id', () => {
    it('should delete product', async () => {
      // First create a product to delete
      const createResponse = await request(app)
        .post('/api/v1/products')
        .send({ 
          name: 'To Delete',
          price: 99.99,
          category: 'Test'
        });

      const productId = createResponse.body.data.id;

      // Then delete it
      const response = await request(app)
        .delete(`/api/v1/products/${productId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Product deleted successfully');

      // Verify it's deleted
      await request(app)
        .get(`/api/v1/products/${productId}`)
        .expect(404);
    });

    it('should return 404 for non-existent product', async () => {
      const response = await request(app)
        .delete('/api/v1/products/9999')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Product not found');
    });
  });
});