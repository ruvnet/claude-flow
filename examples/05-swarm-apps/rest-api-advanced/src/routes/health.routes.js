const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { getRedisClient } = require('../config/redis');
const os = require('os');

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Basic health check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/health/detailed:
 *   get:
 *     summary: Detailed health check with system information
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Detailed health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                 uptime:
 *                   type: number
 *                 environment:
 *                   type: string
 *                 services:
 *                   type: object
 *                 system:
 *                   type: object
 */
router.get('/detailed', async (req, res) => {
  const redis = getRedisClient();
  
  // Check MongoDB connection
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  
  // Check Redis connection
  let redisStatus = 'disconnected';
  try {
    if (redis) {
      await redis.ping();
      redisStatus = 'connected';
    }
  } catch (error) {
    redisStatus = 'error';
  }

  // System information
  const systemInfo = {
    platform: os.platform(),
    nodeVersion: process.version,
    memory: {
      total: `${Math.round(os.totalmem() / 1024 / 1024)} MB`,
      free: `${Math.round(os.freemem() / 1024 / 1024)} MB`,
      usage: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
    },
    cpu: {
      cores: os.cpus().length,
      model: os.cpus()[0].model,
      loadAverage: os.loadavg(),
    },
  };

  const healthStatus = {
    status: mongoStatus === 'connected' ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      database: {
        status: mongoStatus,
        type: 'MongoDB',
      },
      cache: {
        status: redisStatus,
        type: 'Redis',
      },
    },
    system: systemInfo,
  };

  const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(healthStatus);
});

/**
 * @swagger
 * /api/health/ready:
 *   get:
 *     summary: Readiness check for container orchestration
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is ready
 *       503:
 *         description: Service is not ready
 */
router.get('/ready', async (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  
  if (mongoReady) {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({ ready: false });
  }
});

/**
 * @swagger
 * /api/health/live:
 *   get:
 *     summary: Liveness check for container orchestration
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is alive
 */
router.get('/live', (req, res) => {
  res.status(200).json({ alive: true });
});

module.exports = router;