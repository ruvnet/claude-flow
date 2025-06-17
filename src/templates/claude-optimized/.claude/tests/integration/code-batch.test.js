const { TestHarness } = require('../test-harness');
const assert = require('assert');

describe('Code Mode Batch Integration Tests', () => {
  let harness;

  beforeEach(() => {
    harness = new TestHarness();
    harness.createMockProject('complex');
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Parallel Code Generation', () => {
    it('should generate multiple code files concurrently', async () => {
      const codeTemplates = [
        { name: 'UserRepository', type: 'repository', entity: 'User' },
        { name: 'ProductRepository', type: 'repository', entity: 'Product' },
        { name: 'OrderRepository', type: 'repository', entity: 'Order' },
        { name: 'AuthMiddleware', type: 'middleware', purpose: 'authentication' },
        { name: 'ValidationMiddleware', type: 'middleware', purpose: 'validation' }
      ];

      const codeGeneration = await harness.executeBatch(codeTemplates, async (template) => {
        let code = '';
        
        if (template.type === 'repository') {
          code = `import { Repository } from './base-repository';
import { ${template.entity} } from '../models/${template.entity.toLowerCase()}.model';

export class ${template.name} extends Repository<${template.entity}> {
  constructor() {
    super('${template.entity.toLowerCase()}s');
  }
  
  async findByEmail(email: string): Promise<${template.entity} | null> {
    return this.findOne({ email });
  }
  
  async findActive(): Promise<${template.entity}[]> {
    return this.find({ isActive: true });
  }
}`;
        } else if (template.type === 'middleware') {
          code = `import { Request, Response, NextFunction } from 'express';

export const ${template.name} = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // ${template.purpose} logic here
    console.log('${template.name} processing request');
    next();
  } catch (error) {
    res.status(401).json({ error: '${template.purpose} failed' });
  }
};`;
        }
        
        const path = `src/${template.type}s/${template.name}.ts`;
        await harness.mockWriteFile(path, code);
        
        return {
          path,
          linesOfCode: code.split('\n').length,
          generated: true,
          template: template.name
        };
      });

      assert.strictEqual(codeGeneration.successful.length, 5);
      assert(codeGeneration.successful.every(r => r.linesOfCode > 10));
      
      // Verify code was generated correctly
      const userRepo = await harness.mockReadFile('src/repositorys/UserRepository.ts');
      assert(userRepo.includes('extends Repository<User>'));
      assert(userRepo.includes('findByEmail'));
    });

    it('should refactor multiple files in parallel', async () => {
      // Setup files to refactor
      const filesToRefactor = [
        { path: 'src/old-service1.ts', newPath: 'src/services/service1.ts' },
        { path: 'src/old-service2.ts', newPath: 'src/services/service2.ts' },
        { path: 'src/old-controller.ts', newPath: 'src/controllers/main.controller.ts' }
      ];
      
      // Add old files
      filesToRefactor.forEach(f => {
        harness.mockFS.set(f.path, `// Old code in ${f.path}\nexport class OldClass {}`);
      });
      
      const refactoring = await harness.executeBatch(filesToRefactor, async (file) => {
        const oldContent = await harness.mockReadFile(file.path);
        
        // Simulate refactoring
        const newContent = oldContent
          .replace(/Old/g, 'New')
          .replace(/\/\/ Old code/, '// Refactored code')
          + '\n\n// Additional improvements';
        
        await harness.mockWriteFile(file.newPath, newContent);
        harness.mockFS.delete(file.path); // Remove old file
        
        return {
          oldPath: file.path,
          newPath: file.newPath,
          changes: 3,
          improved: true
        };
      });
      
      assert.strictEqual(refactoring.successful.length, 3);
      
      // Verify refactoring
      const refactoredContent = await harness.mockReadFile('src/services/service1.ts');
      assert(refactoredContent.includes('Refactored code'));
      assert(refactoredContent.includes('NewClass'));
      assert(!harness.mockFS.has('src/old-service1.ts')); // Old file removed
    });

    it('should apply code transformations across multiple files', async () => {
      const transformations = [
        { pattern: 'console.log', replacement: 'logger.info', type: 'logging' },
        { pattern: 'var ', replacement: 'const ', type: 'es6' },
        { pattern: 'function\\s+(\\w+)\\s*\\(', replacement: 'const $1 = (', type: 'arrow-functions' }
      ];
      
      // Add files with old patterns
      const testFiles = [
        'src/utils/helper1.js',
        'src/utils/helper2.js',
        'src/utils/helper3.js'
      ];
      
      testFiles.forEach(file => {
        harness.mockFS.set(file, `var x = 5;
console.log('Hello');
function doSomething() {
  console.log('Doing something');
  var result = x * 2;
  return result;
}`);
      });
      
      const transformResults = await harness.executeBatch(testFiles, async (file) => {
        let content = await harness.mockReadFile(file);
        const changes = [];
        
        for (const transform of transformations) {
          const regex = new RegExp(transform.pattern, 'g');
          const matches = content.match(regex);
          if (matches) {
            content = content.replace(regex, transform.replacement);
            changes.push({
              type: transform.type,
              count: matches.length
            });
          }
        }
        
        await harness.mockWriteFile(file, content);
        
        return {
          file,
          transformations: changes,
          totalChanges: changes.reduce((sum, c) => sum + c.count, 0)
        };
      });
      
      assert.strictEqual(transformResults.successful.length, 3);
      
      // Verify transformations
      const transformed = await harness.mockReadFile(testFiles[0]);
      assert(transformed.includes('const x = 5'));
      assert(transformed.includes('logger.info'));
      assert(transformed.includes('const doSomething = ('));
    });
  });

  describe('Concurrent Code Analysis', () => {
    it('should analyze code quality metrics in parallel', async () => {
      const filesToAnalyze = Array.from(harness.mockFS.keys())
        .filter(f => f.endsWith('.ts') || f.endsWith('.js'));
      
      const analysisResults = await harness.executeBatch(filesToAnalyze, async (file) => {
        const content = await harness.mockReadFile(file);
        const lines = content.split('\n');
        
        return {
          file,
          metrics: {
            loc: lines.length,
            complexity: Math.floor(Math.random() * 10) + 1, // Simulated
            maintainability: Math.random() * 30 + 70, // 70-100
            issues: {
              high: Math.floor(Math.random() * 2),
              medium: Math.floor(Math.random() * 5),
              low: Math.floor(Math.random() * 10)
            }
          }
        };
      });
      
      assert(analysisResults.successful.length > 5);
      
      // Aggregate metrics
      const totalLOC = analysisResults.successful.reduce((sum, r) => sum + r.metrics.loc, 0);
      const avgComplexity = analysisResults.successful.reduce((sum, r) => 
        sum + r.metrics.complexity, 0) / analysisResults.successful.length;
      
      assert(totalLOC > 100);
      assert(avgComplexity > 1 && avgComplexity < 10);
    });

    it('should detect code smells across multiple files', async () => {
      // Add files with various code smells
      harness.mockFS.set('src/smelly1.ts', `export class GodClass {
        private prop1: string;
        private prop2: number;
        private prop3: boolean;
        private prop4: any[];
        private prop5: object;
        
        method1() {}
        method2() {}
        method3() {}
        method4() {}
        method5() {}
        method6() {}
        method7() {}
        method8() {}
      }`);
      
      harness.mockFS.set('src/smelly2.ts', `export function veryLongMethodNameThatDoesTooManyThings() {
        // 100+ lines of code
        ${Array(100).fill('// code line').join('\n')}
      }`);
      
      harness.mockFS.set('src/smelly3.ts', `export class DataClass {
        public field1: string;
        public field2: number;
        public field3: boolean;
        // No methods, just data
      }`);
      
      const codeSmellDetection = await harness.executeBatch(
        ['src/smelly1.ts', 'src/smelly2.ts', 'src/smelly3.ts'],
        async (file) => {
          const content = await harness.mockReadFile(file);
          const smells = [];
          
          // Detect various code smells
          const methodCount = (content.match(/method\d+/g) || []).length;
          const propertyCount = (content.match(/private \w+:/g) || []).length;
          const lineCount = content.split('\n').length;
          
          if (methodCount > 5) smells.push({ type: 'god-class', severity: 'high' });
          if (lineCount > 50) smells.push({ type: 'long-method', severity: 'medium' });
          if (propertyCount > 0 && methodCount === 0) smells.push({ type: 'data-class', severity: 'low' });
          
          return {
            file,
            smells,
            refactoringPriority: smells.some(s => s.severity === 'high') ? 'high' : 'normal'
          };
        }
      );
      
      assert.strictEqual(codeSmellDetection.successful.length, 3);
      const highPriorityFiles = codeSmellDetection.successful.filter(r => 
        r.refactoringPriority === 'high');
      assert(highPriorityFiles.length >= 1);
    });
  });

  describe('Batch Code Optimization', () => {
    it('should optimize multiple files for performance', async () => {
      // Add files with optimization opportunities
      const filesToOptimize = {
        'src/loops.js': `for (var i = 0; i < arr.length; i++) {
          process(arr[i]);
        }`,
        'src/strings.js': `let result = '';
        for (let i = 0; i < 1000; i++) {
          result = result + 'x';
        }`,
        'src/arrays.js': `const filtered = [];
        for (let item of items) {
          if (item.active) {
            filtered.push(item);
          }
        }`
      };
      
      Object.entries(filesToOptimize).forEach(([path, content]) => {
        harness.mockFS.set(path, content);
      });
      
      const optimizations = await harness.executeBatch(
        Object.keys(filesToOptimize),
        async (file) => {
          let content = await harness.mockReadFile(file);
          const improvements = [];
          
          // Apply optimizations
          if (content.includes('for (var i = 0; i < arr.length; i++)')) {
            content = content.replace(
              'for (var i = 0; i < arr.length; i++) {\n          process(arr[i]);\n        }',
              'arr.forEach(process);'
            );
            improvements.push('replaced for loop with forEach');
          }
          
          if (content.includes('result = result +')) {
            content = content.replace(
              /let result = '';\s*for.*?{\s*result = result \+ 'x';\s*}/s,
              "const result = 'x'.repeat(1000);"
            );
            improvements.push('optimized string concatenation');
          }
          
          if (content.includes('filtered.push')) {
            content = content.replace(
              /const filtered = \[\];\s*for.*?{\s*if.*?{\s*filtered\.push.*?}\s*}/s,
              'const filtered = items.filter(item => item.active);'
            );
            improvements.push('replaced manual filter with Array.filter');
          }
          
          await harness.mockWriteFile(file, content);
          
          return {
            file,
            improvements,
            optimized: improvements.length > 0
          };
        }
      );
      
      assert.strictEqual(optimizations.successful.length, 3);
      assert(optimizations.successful.every(r => r.optimized));
      
      // Verify optimizations
      const optimizedLoops = await harness.mockReadFile('src/loops.js');
      assert(optimizedLoops.includes('forEach'));
    });

    it('should apply security fixes across multiple files', async () => {
      // Add files with security issues
      const vulnerableFiles = {
        'src/sql.js': `db.query("SELECT * FROM users WHERE id = " + userId);`,
        'src/xss.js': `element.innerHTML = userInput;`,
        'src/eval.js': `eval(userCode);`,
        'src/regex.js': `new RegExp(userPattern);`
      };
      
      Object.entries(vulnerableFiles).forEach(([path, content]) => {
        harness.mockFS.set(path, content);
      });
      
      const securityFixes = await harness.executeBatch(
        Object.keys(vulnerableFiles),
        async (file) => {
          let content = await harness.mockReadFile(file);
          const vulnerabilities = [];
          const fixes = [];
          
          // Detect and fix vulnerabilities
          if (content.includes('+ userId')) {
            vulnerabilities.push({ type: 'SQL Injection', severity: 'critical' });
            content = content.replace(
              '"SELECT * FROM users WHERE id = " + userId',
              '"SELECT * FROM users WHERE id = ?", [userId]'
            );
            fixes.push('parameterized SQL query');
          }
          
          if (content.includes('innerHTML = userInput')) {
            vulnerabilities.push({ type: 'XSS', severity: 'high' });
            content = content.replace(
              'element.innerHTML = userInput',
              'element.textContent = userInput'
            );
            fixes.push('replaced innerHTML with textContent');
          }
          
          if (content.includes('eval(')) {
            vulnerabilities.push({ type: 'Code Injection', severity: 'critical' });
            content = content.replace(
              'eval(userCode)',
              '// eval removed for security - use Function constructor or safer alternative'
            );
            fixes.push('removed eval usage');
          }
          
          if (content.includes('new RegExp(userPattern)')) {
            vulnerabilities.push({ type: 'ReDoS', severity: 'medium' });
            content = content.replace(
              'new RegExp(userPattern)',
              'new RegExp(escapeRegExp(userPattern))'
            );
            fixes.push('escaped regex pattern');
          }
          
          await harness.mockWriteFile(file, content);
          
          return {
            file,
            vulnerabilities,
            fixes,
            secure: fixes.length === vulnerabilities.length
          };
        }
      );
      
      assert.strictEqual(securityFixes.successful.length, 4);
      assert(securityFixes.successful.every(r => r.secure));
      
      const criticalVulns = securityFixes.successful
        .flatMap(r => r.vulnerabilities)
        .filter(v => v.severity === 'critical');
      assert(criticalVulns.length >= 2);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should demonstrate speedup with parallel code generation', async () => {
      const componentCount = 20;
      const components = Array.from({ length: componentCount }, (_, i) => ({
        name: `Component${i}`,
        type: 'react',
        props: ['id', 'name', 'onClick']
      }));
      
      // Measure sequential generation (simulated)
      harness.concurrencyLimit = 1;
      const sequentialStart = Date.now();
      await harness.executeBatch(components, async (comp) => {
        await harness.simulateDelay(30); // Simulate generation time
        const code = `export const ${comp.name} = (props) => { return <div>{props.name}</div>; };`;
        return { component: comp.name, generated: true, size: code.length };
      });
      const sequentialTime = Date.now() - sequentialStart;
      
      // Measure parallel generation
      harness.concurrencyLimit = 5;
      const parallelStart = Date.now();
      await harness.executeBatch(components, async (comp) => {
        await harness.simulateDelay(30);
        const code = `export const ${comp.name} = (props) => { return <div>{props.name}</div>; };`;
        return { component: comp.name, generated: true, size: code.length };
      });
      const parallelTime = Date.now() - parallelStart;
      
      const speedup = sequentialTime / parallelTime;
      assert(speedup > 2.5, `Expected speedup > 2.5x, got ${speedup.toFixed(2)}x`);
      
      const report = harness.getPerformanceReport();
      console.log('Code generation performance:', report);
    });
  });
});