const { TestHarness } = require('../test-harness');
const assert = require('assert');

describe('Architect Mode Batch Integration Tests', () => {
  let harness;

  beforeEach(() => {
    harness = new TestHarness();
    harness.createMockProject('complex');
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Parallel Architecture Analysis', () => {
    it('should analyze multiple components concurrently', async () => {
      const components = [
        'src/services/auth.service.ts',
        'src/services/user.service.ts',
        'src/controllers/auth.controller.ts',
        'src/models/user.model.ts'
      ];
      
      const analysisResults = await harness.executeBatch(components, async (component) => {
        const content = await harness.mockReadFile(component);
        return {
          component,
          type: component.includes('service') ? 'service' : 
                component.includes('controller') ? 'controller' : 'model',
          imports: content.match(/import\s+{[^}]+}/g) || [],
          exports: content.match(/export\s+(class|interface|const)/g) || [],
          complexity: content.length
        };
      });
      
      assert.strictEqual(analysisResults.successful.length, 4);
      assert(analysisResults.successful.every(r => r.type));
      assert(analysisResults.successful.every(r => r.complexity > 0));
    });

    it('should generate architecture diagrams in parallel', async () => {
      const diagramTypes = ['component', 'sequence', 'deployment', 'data-flow'];
      
      const diagramTasks = diagramTypes.map(type => async () => {
        await harness.simulateDelay(50); // Simulate diagram generation
        return {
          type,
          diagram: `@startuml\ntitle ${type} Diagram\n' ${type} specific content\n@enduml`,
          metadata: {
            generated: new Date().toISOString(),
            components: Math.floor(Math.random() * 10) + 5
          }
        };
      });
      
      const results = await harness.executeBatch(diagramTasks, async (task) => await task());
      
      assert.strictEqual(results.successful.length, 4);
      results.successful.forEach(diagram => {
        assert(diagram.diagram.includes('@startuml'));
        assert(diagram.metadata.components >= 5);
      });
    });

    it('should analyze dependencies across multiple files', async () => {
      // Add more complex dependencies
      harness.mockFS.set('src/services/auth.service.ts', 
        'import { UserService } from "./user.service";\nimport { Logger } from "../utils/logger";\nexport class AuthService { }');
      harness.mockFS.set('src/services/user.service.ts',
        'import { User } from "../models/user.model";\nimport { Logger } from "../utils/logger";\nexport class UserService { }');
      
      const files = ['src/services/auth.service.ts', 'src/services/user.service.ts'];
      
      const dependencyAnalysis = await harness.executeBatch(files, async (file) => {
        const content = await harness.mockReadFile(file);
        const imports = content.match(/from\s+"([^"]+)"/g) || [];
        
        return {
          file,
          dependencies: imports.map(imp => imp.replace(/from\s+"(.+)"/, '$1')),
          dependencyCount: imports.length
        };
      });
      
      assert.strictEqual(dependencyAnalysis.successful.length, 2);
      const authDeps = dependencyAnalysis.successful.find(r => r.file.includes('auth.service'));
      assert.strictEqual(authDeps.dependencyCount, 2);
      assert(authDeps.dependencies.includes('./user.service'));
    });
  });

  describe('Concurrent Pattern Detection', () => {
    it('should detect design patterns across multiple files', async () => {
      // Add pattern examples
      harness.mockFS.set('src/patterns/singleton.ts', 
        'export class Singleton { private static instance: Singleton; }');
      harness.mockFS.set('src/patterns/factory.ts',
        'export abstract class Factory { abstract create(): Product; }');
      harness.mockFS.set('src/patterns/observer.ts',
        'export interface Observer { update(subject: Subject): void; }');
      
      const patternFiles = [
        'src/patterns/singleton.ts',
        'src/patterns/factory.ts',
        'src/patterns/observer.ts'
      ];
      
      const patternDetection = await harness.executeBatch(patternFiles, async (file) => {
        const content = await harness.mockReadFile(file);
        const patterns = [];
        
        if (content.includes('static instance')) patterns.push('Singleton');
        if (content.includes('abstract') && content.includes('create')) patterns.push('Factory');
        if (content.includes('Observer') && content.includes('update')) patterns.push('Observer');
        
        return { file, patterns, confidence: patterns.length > 0 ? 0.9 : 0 };
      });
      
      assert.strictEqual(patternDetection.successful.length, 3);
      assert(patternDetection.successful.every(r => r.patterns.length > 0));
      assert(patternDetection.successful.every(r => r.confidence > 0.8));
    });

    it('should analyze architectural layers in parallel', async () => {
      const layers = ['presentation', 'business', 'data', 'infrastructure'];
      
      const layerAnalysis = await harness.executeBatch(layers, async (layer) => {
        // Simulate analyzing each layer
        const files = Array.from(harness.mockFS.keys()).filter(f => {
          if (layer === 'presentation') return f.includes('controller');
          if (layer === 'business') return f.includes('service');
          if (layer === 'data') return f.includes('model');
          if (layer === 'infrastructure') return f.includes('config') || f.includes('utils');
          return false;
        });
        
        return {
          layer,
          fileCount: files.length,
          components: files.map(f => ({ path: f, type: layer })),
          health: files.length > 0 ? 'healthy' : 'missing'
        };
      });
      
      assert.strictEqual(layerAnalysis.successful.length, 4);
      const healthyLayers = layerAnalysis.successful.filter(l => l.health === 'healthy');
      assert(healthyLayers.length >= 3); // At least 3 layers should have files
    });
  });

  describe('Batch Documentation Generation', () => {
    it('should generate multiple architecture documents concurrently', async () => {
      const documentTypes = [
        { type: 'overview', title: 'System Overview' },
        { type: 'components', title: 'Component Architecture' },
        { type: 'deployment', title: 'Deployment Architecture' },
        { type: 'security', title: 'Security Architecture' }
      ];
      
      const docGeneration = await harness.executeBatch(documentTypes, async (doc) => {
        const content = `# ${doc.title}\n\n## Overview\nThis document describes the ${doc.type} architecture.\n\n## Details\n...`;
        const path = `docs/architecture/${doc.type}.md`;
        
        await harness.mockWriteFile(path, content);
        return { path, size: content.length, generated: true };
      });
      
      assert.strictEqual(docGeneration.successful.length, 4);
      
      // Verify all documents were created
      for (const doc of docGeneration.successful) {
        const content = await harness.mockReadFile(doc.path);
        assert(content.includes('# '));
        assert(content.includes('architecture'));
      }
    });

    it('should extract and analyze architectural decisions', async () => {
      // Add ADR (Architecture Decision Records)
      const adrs = [
        { id: '001', title: 'Use TypeScript', status: 'accepted' },
        { id: '002', title: 'Microservices Architecture', status: 'proposed' },
        { id: '003', title: 'PostgreSQL for persistence', status: 'accepted' },
        { id: '004', title: 'Redis for caching', status: 'deprecated' }
      ];
      
      adrs.forEach(adr => {
        harness.mockFS.set(`docs/adr/ADR-${adr.id}.md`, 
          `# ADR-${adr.id}: ${adr.title}\n\nStatus: ${adr.status}\n\n## Context\n...`);
      });
      
      const adrAnalysis = await harness.executeBatch(adrs, async (adr) => {
        const content = await harness.mockReadFile(`docs/adr/ADR-${adr.id}.md`);
        return {
          ...adr,
          hasContext: content.includes('## Context'),
          hasDecision: content.includes('## Decision'),
          wordCount: content.split(/\s+/).length
        };
      });
      
      assert.strictEqual(adrAnalysis.successful.length, 4);
      const acceptedADRs = adrAnalysis.successful.filter(a => a.status === 'accepted');
      assert.strictEqual(acceptedADRs.length, 2);
    });
  });

  describe('Performance Profiling', () => {
    it('should profile architecture analysis performance', async () => {
      harness.createMockProject('large'); // Create 100+ files
      
      const allFiles = Array.from(harness.mockFS.keys());
      const batches = [10, 20, 50];
      const results = {};
      
      for (const batchSize of batches) {
        const files = allFiles.slice(0, batchSize);
        const { metrics } = await harness.measureResourceUsage(async () => {
          return await harness.executeBatch(files, async (file) => {
            const content = await harness.mockReadFile(file);
            return { file, size: content.length, analyzed: true };
          });
        });
        
        results[batchSize] = {
          duration: metrics.duration,
          throughput: batchSize / (metrics.duration / 1000)
        };
      }
      
      // Throughput should remain relatively stable
      const throughputs = Object.values(results).map(r => r.throughput);
      const avgThroughput = throughputs.reduce((a, b) => a + b) / throughputs.length;
      
      throughputs.forEach(tp => {
        const deviation = Math.abs(tp - avgThroughput) / avgThroughput;
        assert(deviation < 0.3, `Throughput deviation too high: ${(deviation * 100).toFixed(1)}%`);
      });
    });

    it('should handle complex architectural queries efficiently', async () => {
      const queries = [
        { type: 'find-circular-deps', complexity: 'high' },
        { type: 'analyze-coupling', complexity: 'medium' },
        { type: 'check-layer-violations', complexity: 'high' },
        { type: 'identify-god-classes', complexity: 'medium' },
        { type: 'detect-anti-patterns', complexity: 'high' }
      ];
      
      const startTime = Date.now();
      const queryResults = await harness.executeBatch(queries, async (query) => {
        // Simulate complex analysis
        const delay = query.complexity === 'high' ? 100 : 50;
        await harness.simulateDelay(delay);
        
        return {
          query: query.type,
          issues: Math.floor(Math.random() * 5),
          suggestions: Math.floor(Math.random() * 3) + 1,
          executionTime: delay
        };
      });
      const totalTime = Date.now() - startTime;
      
      assert.strictEqual(queryResults.successful.length, 5);
      
      // With parallel execution, should complete faster than sequential
      const sequentialTime = queries.reduce((sum, q) => 
        sum + (q.complexity === 'high' ? 100 : 50), 0);
      assert(totalTime < sequentialTime * 0.7, 
        `Parallel execution should be faster: ${totalTime}ms vs ${sequentialTime}ms sequential`);
    });
  });
});