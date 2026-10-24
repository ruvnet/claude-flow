const request = require('supertest');
const app = require('./server');

describe('REST API Tests', () => {
  test('GET /health should return healthy status', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
  });

  test('GET /api/v1/items should return items list', async () => {
    const response = await request(app).get('/api/v1/items');
    expect(response.status).toBe(200);
    expect(response.body.items).toBeDefined();
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  test('GET /api/v1/items/:id should return specific item', async () => {
    const response = await request(app).get('/api/v1/items/1');
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(1);
  });

  test('POST /api/v1/items should create new item', async () => {
    const newItem = { name: 'Test Item', description: 'Test Description' };
    const response = await request(app)
      .post('/api/v1/items')
      .send(newItem);
    expect(response.status).toBe(201);
    expect(response.body.name).toBe(newItem.name);
    expect(response.body.createdAt).toBeDefined();
  });
});
