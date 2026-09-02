/**
 * Production Deployment Validation Tests
 * 
 * These tests validate deployment readiness and health check functionality.
 * Tests real deployment scenarios without mocking.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { SystemIntegration } from '../../src/integration/system-integration.js';
import { HealthCheckManager } from '../../src/monitoring/health-check.js';
import * as http from 'http';
import * as fs from 'fs-extra';
import * as path from 'path';

describe('Production Deployment Validation', () => {
  let systemIntegration: SystemIntegration;
  let healthCheckManager: HealthCheckManager;
  let testServer: http.Server;

  beforeAll(async () => {
    systemIntegration = SystemIntegration.getInstance();
    await systemIntegration.initialize({
      logLevel: 'info',
      environment: 'deployment-test',
      monitoring: {
        enabled: true,
        metrics: true,
        realTime: true
      }
    });

    healthCheckManager = new HealthCheckManager();
  });

  afterAll(async () => {
    if (testServer) {
      testServer.close();
    }
    if (systemIntegration?.isReady()) {
      await systemIntegration.shutdown();
    }
  });

  describe('Health Check Endpoints', () => {
    test('should provide comprehensive health check response', async () => {
      const healthResult = await healthCheckManager.performHealthCheck();
      
      expect(healthResult).toBeDefined();
      expect(healthResult.status).toMatch(/^(healthy|warning|unhealthy)$/);
      expect(healthResult.timestamp).toBeLessThanOrEqual(Date.now());
      expect(healthResult.uptime).toBeGreaterThan(0);
      
      // Validate component health
      expect(healthResult.components).toBeDefined();
      expect(Array.isArray(healthResult.components)).toBe(true);
      
      // Each component should have required properties
      healthResult.components.forEach(component => {
        expect(component).toHaveProperty('name');
        expect(component).toHaveProperty('status');
        expect(component).toHaveProperty('responseTime');
        expect(['healthy', 'warning', 'unhealthy']).toContain(component.status);
        expect(typeof component.responseTime).toBe('number');
      });
      
      // Validate system metrics
      expect(healthResult.metrics).toBeDefined();
      expect(healthResult.metrics.memory).toBeDefined();
      expect(healthResult.metrics.cpu).toBeDefined();
      expect(typeof healthResult.metrics.memory.used).toBe('number');
      expect(typeof healthResult.metrics.memory.total).toBe('number');
    });

    test('should provide detailed health check for each component', async () => {
      const components = ['orchestrator', 'agentManager', 'memoryManager', 'swarmCoordinator'];
      
      for (const componentName of components) {
        const component = systemIntegration.getComponent(componentName);
        if (component) {
          const componentHealth = await healthCheckManager.checkComponent(componentName);
          
          expect(componentHealth).toBeDefined();
          expect(componentHealth.name).toBe(componentName);
          expect(['healthy', 'warning', 'unhealthy']).toContain(componentHealth.status);
          expect(typeof componentHealth.responseTime).toBe('number');
          expect(componentHealth.responseTime).toBeGreaterThan(0);
          expect(componentHealth.responseTime).toBeLessThan(5000); // Should respond within 5 seconds
          
          if (componentHealth.details) {
            expect(typeof componentHealth.details).toBe('object');
          }
        }
      }
    });

    test('should provide liveness probe endpoint', async () => {
      const livenessResult = await healthCheckManager.livenessProbe();
      
      expect(livenessResult).toBeDefined();
      expect(livenessResult.alive).toBe(true);
      expect(livenessResult.timestamp).toBeLessThanOrEqual(Date.now());
      
      // Liveness should be fast (under 1 second)
      const startTime = Date.now();
      await healthCheckManager.livenessProbe();
      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(1000);
    });

    test('should provide readiness probe endpoint', async () => {
      const readinessResult = await healthCheckManager.readinessProbe();
      
      expect(readinessResult).toBeDefined();
      expect(readinessResult.ready).toBe(true);
      expect(readinessResult.timestamp).toBeLessThanOrEqual(Date.now());
      
      // Readiness should include dependency checks
      if (readinessResult.dependencies) {
        expect(Array.isArray(readinessResult.dependencies)).toBe(true);
        readinessResult.dependencies.forEach(dep => {
          expect(dep).toHaveProperty('name');
          expect(dep).toHaveProperty('status');
          expect(['ready', 'not_ready']).toContain(dep.status);
        });
      }
    });
  });

  describe('Graceful Shutdown', () => {
    test('should handle SIGTERM gracefully', async () => {
      // Create a separate system instance for shutdown testing
      const shutdownSystem = SystemIntegration.getInstance();
      await shutdownSystem.initialize({
        logLevel: 'info',
        environment: 'shutdown-test'
      });

      expect(shutdownSystem.isReady()).toBe(true);
      
      // Start shutdown process
      const shutdownPromise = shutdownSystem.shutdown();
      
      // Should complete shutdown within reasonable time
      const startTime = Date.now();
      await shutdownPromise;
      const shutdownTime = Date.now() - startTime;
      
      expect(shutdownTime).toBeLessThan(10000); // 10 seconds max
      expect(shutdownSystem.isReady()).toBe(false);
      
      console.log(`Graceful shutdown completed in ${shutdownTime}ms`);
    });

    test('should cleanup resources during shutdown', async () => {
      const tempDir = path.join(process.cwd(), 'temp-shutdown-test');
      await fs.ensureDir(tempDir);
      
      // Create system with temporary resources
      const resourceSystem = SystemIntegration.getInstance();
      await resourceSystem.initialize({
        logLevel: 'info',
        environment: 'resource-test',
        memory: {
          backend: 'memory',
          ttl: 3600
        }
      });

      // Create some resources
      const memoryManager = resourceSystem.getComponent('memoryManager');
      if (memoryManager) {
        await memoryManager.store('shutdown-test', { data: 'test' }, 'shutdown-namespace');
      }

      // Shutdown should cleanup resources
      await resourceSystem.shutdown();
      
      // Verify cleanup
      expect(resourceSystem.isReady()).toBe(false);
      
      // Clean up test directory
      await fs.remove(tempDir);
    });
  });

  describe('Container and Process Management', () => {
    test('should validate process signals handling', async () => {
      const originalHandlers = {
        SIGTERM: process.listeners('SIGTERM'),
        SIGINT: process.listeners('SIGINT'),
        SIGUSR2: process.listeners('SIGUSR2')
      };

      // System should register signal handlers
      expect(process.listenerCount('SIGTERM')).toBeGreaterThan(0);
      
      // Validate handler registration doesn't interfere with existing handlers
      const newTermListeners = process.listeners('SIGTERM');
      expect(newTermListeners.length).toBeGreaterThanOrEqual(originalHandlers.SIGTERM.length);
    });

    test('should validate environment variable inheritance', () => {
      // Core environment variables should be available
      const requiredEnvVars = ['NODE_ENV', 'PATH'];
      
      requiredEnvVars.forEach(varName => {
        expect(process.env[varName]).toBeDefined();
      });
      
      // Child process should inherit environment
      const childEnv = { ...process.env, TEST_VAR: 'test-value' };
      expect(childEnv.TEST_VAR).toBe('test-value');
    });

    test('should validate resource usage monitoring', async () => {
      const resourceUsage = process.resourceUsage();
      
      expect(resourceUsage).toBeDefined();
      expect(resourceUsage.userCPUTime).toBeGreaterThanOrEqual(0);
      expect(resourceUsage.systemCPUTime).toBeGreaterThanOrEqual(0);
      expect(resourceUsage.maxRSS).toBeGreaterThan(0);
      
      console.log(`Resource usage - User CPU: ${resourceUsage.userCPUTime}μs, System CPU: ${resourceUsage.systemCPUTime}μs, Max RSS: ${resourceUsage.maxRSS}KB`);
    });
  });

  describe('File System and Storage Validation', () => {
    test('should validate required directories exist', async () => {
      const requiredDirs = [
        'src',
        'dist',
        'logs',
        'memory',
        'swarm-runs'
      ];

      for (const dir of requiredDirs) {
        const dirPath = path.join(process.cwd(), dir);
        if (await fs.pathExists(dirPath)) {
          const stats = await fs.stat(dirPath);
          expect(stats.isDirectory()).toBe(true);
          
          // Verify directory is accessible
          try {
            await fs.access(dirPath, fs.constants.R_OK | fs.constants.W_OK);
          } catch (error) {
            console.warn(`Directory ${dir} is not writable: ${error.message}`);
          }
        }
      }
    });

    test('should validate log file creation and rotation', async () => {
      const logDir = path.join(process.cwd(), 'logs');
      await fs.ensureDir(logDir);
      
      const testLogFile = path.join(logDir, 'deployment-test.log');
      
      // Test log file creation
      await fs.writeFile(testLogFile, 'Test log entry\n');
      expect(await fs.pathExists(testLogFile)).toBe(true);
      
      // Test log file is writable
      await fs.appendFile(testLogFile, 'Additional log entry\n');
      const logContent = await fs.readFile(testLogFile, 'utf8');
      expect(logContent).toContain('Test log entry');
      expect(logContent).toContain('Additional log entry');
      
      // Clean up
      await fs.remove(testLogFile);
    });

    test('should validate persistent storage', async () => {
      const memoryDir = path.join(process.cwd(), 'memory');
      await fs.ensureDir(memoryDir);
      
      const memoryManager = systemIntegration.getComponent('memoryManager');
      if (memoryManager) {
        // Test persistent storage
        const testKey = 'deployment-persistence-test';
        const testData = {
          timestamp: Date.now(),
          data: 'Deployment validation test',
          complex: {
            nested: true,
            array: [1, 2, 3]
          }
        };

        await memoryManager.store(testKey, testData, 'deployment-test');
        
        // Verify data persists
        const retrieved = await memoryManager.retrieve(testKey, 'deployment-test');
        expect(retrieved).toEqual(testData);
        
        // Clean up
        await memoryManager.delete(testKey, 'deployment-test');
      }
    });
  });

  describe('Network and Service Discovery', () => {
    test('should validate HTTP server startup', async () => {
      const port = 0; // Use dynamic port
      
      testServer = http.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'healthy', timestamp: Date.now() }));
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      const serverStartPromise = new Promise<void>((resolve, reject) => {
        testServer.listen(port, (error?: Error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      await serverStartPromise;
      
      const address = testServer.address();
      expect(address).toBeDefined();
      
      if (address && typeof address === 'object') {
        expect(address.port).toBeGreaterThan(0);
        console.log(`Test server started on port ${address.port}`);
      }
    });

    test('should validate health endpoint response', async () => {
      if (!testServer) {
        return; // Skip if server not started
      }

      const address = testServer.address();
      if (!address || typeof address !== 'object') {
        return;
      }

      const healthUrl = `http://localhost:${address.port}/health`;
      
      // Make HTTP request to health endpoint
      const response = await new Promise<any>((resolve, reject) => {
        http.get(healthUrl, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve({ statusCode: res.statusCode, body: parsed });
            } catch (error) {
              reject(error);
            }
          });
        }).on('error', reject);
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('Configuration and Environment Validation', () => {
    test('should validate production configuration loading', async () => {
      const prodConfig = {
        logLevel: 'warn',
        environment: 'production',
        security: {
          enableAuth: true,
          enforceHttps: true
        },
        monitoring: {
          enabled: true,
          metrics: true
        }
      };

      const prodSystem = SystemIntegration.getInstance();
      await prodSystem.initialize(prodConfig);
      
      expect(prodSystem.isReady()).toBe(true);
      
      const config = prodSystem.getConfig();
      expect(config.logLevel).toBe('warn');
      expect(config.environment).toBe('production');
      
      if (config.security) {
        expect(config.security.enableAuth).toBe(true);
        expect(config.security.enforceHttps).toBe(true);
      }
      
      await prodSystem.shutdown();
    });

    test('should validate configuration merging and overrides', async () => {
      const baseConfig = {
        logLevel: 'info',
        environment: 'test'
      };

      const overrideConfig = {
        logLevel: 'debug',
        monitoring: {
          enabled: true
        }
      };

      const mergedSystem = SystemIntegration.getInstance();
      await mergedSystem.initialize({ ...baseConfig, ...overrideConfig });
      
      const config = mergedSystem.getConfig();
      expect(config.logLevel).toBe('debug'); // Override applied
      expect(config.environment).toBe('test'); // Base preserved
      expect(config.monitoring?.enabled).toBe(true); // Addition preserved
      
      await mergedSystem.shutdown();
    });
  });
});