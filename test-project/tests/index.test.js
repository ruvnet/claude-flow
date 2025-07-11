const request = require('supertest');
const app = require('../src/index');

describe('Swarm Test Project API', () => {
  test('GET / should return welcome message', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.body.message).toContain('Swarm Test Project');
  });

  test('GET /health should return health status', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.system).toBeDefined();
  });

  test('GET /metrics should return metrics', async () => {
    const response = await request(app).get('/metrics');
    expect(response.status).toBe(200);
    expect(response.body.requestsPerSecond).toBeDefined();
    expect(response.body.averageResponseTime).toBeDefined();
  });
});
