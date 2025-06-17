const fs = require('fs').promises;
const path = require('path');
const { performance } = require('perf_hooks');

/**
 * Test Harness for Batchtools Integration Tests
 * Provides utilities for testing batch operations, performance measurement,
 * and mock environments
 */

class TestHarness {
  constructor() {
    this.mockFS = new Map();
    this.performanceMetrics = [];
    this.concurrencyLimit = 5;
    this.mockDelay = 50; // ms
  }

  /**
   * Mock File System Operations
   */
  async mockReadFile(filePath) {
    await this.simulateDelay();
    if (!this.mockFS.has(filePath)) {
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    }
    return this.mockFS.get(filePath);
  }

  async mockWriteFile(filePath, content) {
    await this.simulateDelay();
    this.mockFS.set(filePath, content);
  }

  async mockFileExists(filePath) {
    await this.simulateDelay();
    return this.mockFS.has(filePath);
  }

  /**
   * Batch Operation Simulators
   */
  async batchReadFiles(filePaths) {
    const startTime = performance.now();
    const results = await this.executeBatch(
      filePaths,
      async (path) => await this.mockReadFile(path)
    );
    const duration = performance.now() - startTime;
    this.recordMetric('batchReadFiles', filePaths.length, duration);
    return results;
  }

  async batchWriteFiles(fileMap) {
    const startTime = performance.now();
    const entries = Object.entries(fileMap);
    const results = await this.executeBatch(
      entries,
      async ([path, content]) => await this.mockWriteFile(path, content)
    );
    const duration = performance.now() - startTime;
    this.recordMetric('batchWriteFiles', entries.length, duration);
    return results;
  }

  async batchSearch(patterns, searchIn) {
    const startTime = performance.now();
    const results = await this.executeBatch(
      patterns,
      async (pattern) => await this.performSearch(pattern, searchIn)
    );
    const duration = performance.now() - startTime;
    this.recordMetric('batchSearch', patterns.length, duration);
    return results;
  }

  /**
   * Core Batch Execution Engine
   */
  async executeBatch(items, operation) {
    const results = [];
    const errors = [];
    
    // Process items in chunks based on concurrency limit
    for (let i = 0; i < items.length; i += this.concurrencyLimit) {
      const chunk = items.slice(i, i + this.concurrencyLimit);
      const chunkPromises = chunk.map(async (item, index) => {
        try {
          const result = await operation(item);
          return { success: true, result, index: i + index };
        } catch (error) {
          return { success: false, error, index: i + index };
        }
      });
      
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }
    
    return {
      successful: results.filter(r => r.success).map(r => r.result),
      failed: results.filter(r => !r.success).map(r => ({ 
        index: r.index, 
        error: r.error 
      })),
      totalProcessed: items.length,
      successRate: results.filter(r => r.success).length / items.length
    };
  }

  /**
   * Performance Measurement
   */
  recordMetric(operation, itemCount, duration) {
    this.performanceMetrics.push({
      operation,
      itemCount,
      duration,
      throughput: itemCount / (duration / 1000), // items per second
      timestamp: new Date()
    });
  }

  getPerformanceReport() {
    const grouped = this.performanceMetrics.reduce((acc, metric) => {
      if (!acc[metric.operation]) {
        acc[metric.operation] = [];
      }
      acc[metric.operation].push(metric);
      return acc;
    }, {});

    const report = {};
    for (const [operation, metrics] of Object.entries(grouped)) {
      const avgDuration = metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length;
      const avgThroughput = metrics.reduce((sum, m) => sum + m.throughput, 0) / metrics.length;
      
      report[operation] = {
        totalCalls: metrics.length,
        averageDuration: avgDuration.toFixed(2) + 'ms',
        averageThroughput: avgThroughput.toFixed(2) + ' items/s',
        totalItemsProcessed: metrics.reduce((sum, m) => sum + m.itemCount, 0)
      };
    }
    
    return report;
  }

  /**
   * Error Injection
   */
  async injectError(probability = 0.1) {
    if (Math.random() < probability) {
      throw new Error('Simulated batch operation error');
    }
  }

  /**
   * Resource Monitoring
   */
  async measureResourceUsage(operation) {
    const startMemory = process.memoryUsage();
    const startCPU = process.cpuUsage();
    const startTime = performance.now();
    
    const result = await operation();
    
    const endMemory = process.memoryUsage();
    const endCPU = process.cpuUsage();
    const endTime = performance.now();
    
    return {
      result,
      metrics: {
        duration: endTime - startTime,
        memory: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          external: endMemory.external - startMemory.external
        },
        cpu: {
          user: (endCPU.user - startCPU.user) / 1000, // Convert to ms
          system: (endCPU.system - startCPU.system) / 1000
        }
      }
    };
  }

  /**
   * Mock Project Structures
   */
  createMockProject(type = 'standard') {
    const projects = {
      standard: {
        'src/index.js': 'console.log("Hello World");',
        'src/utils.js': 'export const add = (a, b) => a + b;',
        'test/index.test.js': 'describe("Main", () => { /* tests */ });',
        'package.json': '{ "name": "mock-project", "version": "1.0.0" }',
        'README.md': '# Mock Project\n\nTest project for batch operations.'
      },
      large: this.generateLargeProject(100),
      complex: this.generateComplexProject()
    };
    
    const project = projects[type] || projects.standard;
    for (const [filePath, content] of Object.entries(project)) {
      this.mockFS.set(filePath, content);
    }
    
    return Object.keys(project);
  }

  generateLargeProject(fileCount) {
    const project = {};
    for (let i = 0; i < fileCount; i++) {
      project[`src/module${i}.js`] = `export const module${i} = () => { return ${i}; };`;
      project[`test/module${i}.test.js`] = `describe("Module ${i}", () => { /* tests */ });`;
    }
    return project;
  }

  generateComplexProject() {
    return {
      'src/index.ts': 'import { App } from "./app";\nnew App().start();',
      'src/app.ts': 'export class App { start() { console.log("Started"); } }',
      'src/services/auth.service.ts': 'export class AuthService { /* implementation */ }',
      'src/services/user.service.ts': 'export class UserService { /* implementation */ }',
      'src/controllers/auth.controller.ts': 'export class AuthController { /* implementation */ }',
      'src/models/user.model.ts': 'export interface User { id: string; name: string; }',
      'src/utils/logger.ts': 'export const logger = { info: console.log };',
      'test/unit/auth.test.ts': 'describe("Auth", () => { /* tests */ });',
      'test/integration/api.test.ts': 'describe("API", () => { /* tests */ });',
      'config/default.json': '{ "port": 3000, "database": "mongodb://localhost" }',
      'package.json': '{ "name": "complex-project", "type": "module" }',
      'tsconfig.json': '{ "compilerOptions": { "target": "es2020" } }',
      'README.md': '# Complex Project\n\nA more complex test project.'
    };
  }

  /**
   * Utilities
   */
  async simulateDelay(ms = this.mockDelay) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async performSearch(pattern, searchIn) {
    await this.simulateDelay();
    const regex = new RegExp(pattern, 'gi');
    const results = [];
    
    for (const [filePath, content] of this.mockFS.entries()) {
      if (searchIn && !filePath.includes(searchIn)) continue;
      
      const matches = content.match(regex);
      if (matches) {
        results.push({
          file: filePath,
          matches: matches.length,
          lines: content.split('\n')
            .map((line, i) => ({ line: i + 1, content: line }))
            .filter(({ content }) => regex.test(content))
        });
      }
    }
    
    return results;
  }

  reset() {
    this.mockFS.clear();
    this.performanceMetrics = [];
  }
}

module.exports = { TestHarness };