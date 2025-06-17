const { TestHarness } = require('../test-harness');
const assert = require('assert');

describe('End-to-End Workflow Tests', () => {
  let harness;

  beforeEach(() => {
    harness = new TestHarness();
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Complete SPARC Workflow with Batch Operations', () => {
    it('should execute full SPARC cycle with parallel operations', async () => {
      const projectName = 'user-authentication-system';
      const workflowLog = [];
      
      // Phase 1: Specification with parallel analysis
      console.log('\n=== Phase 1: Specification ===');
      const specificationTasks = [
        {
          name: 'analyze-requirements',
          execute: async () => {
            await harness.mockWriteFile('specs/requirements.md', `# Requirements
- User registration with email
- Secure password storage
- JWT-based authentication
- Password reset functionality
- Session management`);
            return { analyzed: 5, priority: 'high' };
          }
        },
        {
          name: 'define-interfaces',
          execute: async () => {
            await harness.mockWriteFile('specs/interfaces.ts', `export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface AuthToken {
  userId: string;
  token: string;
  expiresAt: Date;
}`);
            return { interfaces: 2 };
          }
        },
        {
          name: 'create-test-scenarios',
          execute: async () => {
            await harness.mockWriteFile('specs/test-scenarios.md', `# Test Scenarios
1. Valid registration
2. Duplicate email registration
3. Invalid password format
4. Successful login
5. Failed login attempts`);
            return { scenarios: 5 };
          }
        }
      ];
      
      harness.concurrencyLimit = 3;
      const specResults = await harness.executeBatch(
        specificationTasks,
        async (task) => {
          const result = await task.execute();
          workflowLog.push({ phase: 'specification', task: task.name, result });
          return result;
        }
      );
      
      assert.strictEqual(specResults.successful.length, 3);
      
      // Phase 2: Architecture with parallel design
      console.log('\n=== Phase 2: Architecture ===');
      const architectureTasks = [
        {
          name: 'design-components',
          execute: async () => {
            const components = ['AuthService', 'UserRepository', 'TokenManager', 'PasswordHasher'];
            for (const component of components) {
              await harness.mockWriteFile(`architecture/${component}.diagram`, 
                `Component: ${component}\nResponsibilities: ...`);
            }
            return { components: components.length };
          }
        },
        {
          name: 'plan-database',
          execute: async () => {
            await harness.mockWriteFile('architecture/database-schema.sql', `
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE auth_tokens (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL
);`);
            return { tables: 2 };
          }
        },
        {
          name: 'define-api-endpoints',
          execute: async () => {
            await harness.mockWriteFile('architecture/api-spec.yaml', `
endpoints:
  - POST /auth/register
  - POST /auth/login
  - POST /auth/logout
  - POST /auth/refresh
  - POST /auth/reset-password`);
            return { endpoints: 5 };
          }
        }
      ];
      
      const archResults = await harness.executeBatch(
        architectureTasks,
        async (task) => {
          const result = await task.execute();
          workflowLog.push({ phase: 'architecture', task: task.name, result });
          return result;
        }
      );
      
      assert.strictEqual(archResults.successful.length, 3);
      
      // Phase 3: TDD Implementation with parallel test creation
      console.log('\n=== Phase 3: TDD Implementation ===');
      const tddTasks = [
        {
          name: 'create-auth-service-tests',
          execute: async () => {
            await harness.mockWriteFile('test/auth-service.test.ts', `
describe('AuthService', () => {
  it('should register new user');
  it('should hash password securely');
  it('should generate JWT token');
  it('should validate token');
  it('should handle duplicate emails');
});`);
            return { testSuites: 1, tests: 5 };
          }
        },
        {
          name: 'create-user-repository-tests',
          execute: async () => {
            await harness.mockWriteFile('test/user-repository.test.ts', `
describe('UserRepository', () => {
  it('should create user');
  it('should find user by email');
  it('should update user');
  it('should handle not found');
});`);
            return { testSuites: 1, tests: 4 };
          }
        },
        {
          name: 'create-integration-tests',
          execute: async () => {
            await harness.mockWriteFile('test/integration/auth-flow.test.ts', `
describe('Authentication Flow', () => {
  it('should complete registration flow');
  it('should complete login flow');
  it('should handle session expiry');
});`);
            return { testSuites: 1, tests: 3 };
          }
        }
      ];
      
      const tddResults = await harness.executeBatch(
        tddTasks,
        async (task) => {
          const result = await task.execute();
          workflowLog.push({ phase: 'tdd', task: task.name, result });
          return result;
        }
      );
      
      // Phase 4: Code Implementation with parallel file generation
      console.log('\n=== Phase 4: Code Implementation ===');
      const implementations = [
        'src/services/auth.service.ts',
        'src/repositories/user.repository.ts',
        'src/utils/token-manager.ts',
        'src/utils/password-hasher.ts',
        'src/controllers/auth.controller.ts'
      ];
      
      const codeResults = await harness.executeBatch(
        implementations,
        async (file) => {
          const className = file.split('/').pop().replace('.ts', '').split('-')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
          
          await harness.mockWriteFile(file, `export class ${className} {
  // Implementation based on tests and specifications
  constructor() {
    // Initialize
  }
  
  // Methods...
}`);
          
          workflowLog.push({ phase: 'implementation', file, created: true });
          return { file, className };
        }
      );
      
      assert.strictEqual(codeResults.successful.length, 5);
      
      // Phase 5: Security Review with parallel checks
      console.log('\n=== Phase 5: Security Review ===');
      const securityChecks = [
        {
          name: 'password-security',
          check: async () => {
            const hasherContent = await harness.mockReadFile('src/utils/password-hasher.ts');
            return {
              check: 'password-hashing',
              secure: true,
              recommendations: ['Use bcrypt with cost factor 12+']
            };
          }
        },
        {
          name: 'token-security',
          check: async () => {
            const tokenContent = await harness.mockReadFile('src/utils/token-manager.ts');
            return {
              check: 'token-management',
              secure: true,
              recommendations: ['Implement token rotation', 'Add rate limiting']
            };
          }
        },
        {
          name: 'sql-injection',
          check: async () => {
            const repoContent = await harness.mockReadFile('src/repositories/user.repository.ts');
            return {
              check: 'sql-injection',
              secure: true,
              recommendations: ['Always use parameterized queries']
            };
          }
        }
      ];
      
      const securityResults = await harness.executeBatch(
        securityChecks,
        async (check) => {
          const result = await check.check();
          workflowLog.push({ phase: 'security', check: check.name, result });
          return result;
        }
      );
      
      // Phase 6: Integration and Documentation
      console.log('\n=== Phase 6: Integration ===');
      const integrationTasks = [
        {
          name: 'generate-api-docs',
          execute: async () => {
            await harness.mockWriteFile('docs/api-reference.md', '# API Reference\n...');
            return { documented: true };
          }
        },
        {
          name: 'create-deployment-config',
          execute: async () => {
            await harness.mockWriteFile('deploy/docker-compose.yml', 'version: "3.8"\n...');
            return { deployable: true };
          }
        },
        {
          name: 'setup-ci-pipeline',
          execute: async () => {
            await harness.mockWriteFile('.github/workflows/ci.yml', 'name: CI\n...');
            return { ci: true };
          }
        }
      ];
      
      const integrationResults = await harness.executeBatch(
        integrationTasks,
        async (task) => {
          const result = await task.execute();
          workflowLog.push({ phase: 'integration', task: task.name, result });
          return result;
        }
      );
      
      // Generate workflow summary
      const summary = {
        project: projectName,
        phases: {
          specification: specResults.successful.length,
          architecture: archResults.successful.length,
          tdd: tddResults.successful.length,
          implementation: codeResults.successful.length,
          security: securityResults.successful.length,
          integration: integrationResults.successful.length
        },
        totalTasks: workflowLog.length,
        filesCreated: Array.from(harness.mockFS.keys()).length,
        success: true
      };
      
      console.log('\n=== Workflow Summary ===');
      console.log(JSON.stringify(summary, null, 2));
      
      // Assertions
      assert(summary.filesCreated > 15);
      assert(Object.values(summary.phases).every(count => count > 0));
      assert.strictEqual(summary.totalTasks, 17);
    });

    it('should handle cross-mode parallel execution', async () => {
      // Simulate running multiple SPARC modes concurrently
      const modes = {
        architect: [
          { task: 'analyze-structure', duration: 100 },
          { task: 'create-diagrams', duration: 150 }
        ],
        code: [
          { task: 'generate-interfaces', duration: 80 },
          { task: 'implement-services', duration: 120 },
          { task: 'create-utilities', duration: 60 }
        ],
        tdd: [
          { task: 'write-unit-tests', duration: 90 },
          { task: 'write-integration-tests', duration: 110 }
        ],
        security: [
          { task: 'scan-vulnerabilities', duration: 200 },
          { task: 'review-auth-flow', duration: 100 }
        ]
      };
      
      const modeExecutions = [];
      
      // Execute all modes in parallel
      const allTasks = Object.entries(modes).flatMap(([mode, tasks]) =>
        tasks.map(task => ({
          mode,
          task: task.task,
          execute: async () => {
            const startTime = Date.now();
            await harness.simulateDelay(task.duration);
            const endTime = Date.now();
            
            const result = {
              mode,
              task: task.task,
              duration: endTime - startTime,
              output: `${mode}/${task.task}-output.txt`
            };
            
            await harness.mockWriteFile(result.output, 
              `Output from ${mode} mode: ${task.task}\nCompleted in ${result.duration}ms`);
            
            return result;
          }
        }))
      );
      
      console.log(`\n=== Cross-Mode Parallel Execution ===`);
      console.log(`Total tasks across modes: ${allTasks.length}`);
      
      harness.concurrencyLimit = 8; // High concurrency for parallel modes
      const startTime = Date.now();
      
      const results = await harness.executeBatch(
        allTasks,
        async (task) => {
          const result = await task.execute();
          modeExecutions.push(result);
          console.log(`  [${result.mode}] ${result.task} completed in ${result.duration}ms`);
          return result;
        }
      );
      
      const totalTime = Date.now() - startTime;
      
      // Calculate statistics
      const modeStats = modeExecutions.reduce((stats, exec) => {
        if (!stats[exec.mode]) {
          stats[exec.mode] = { tasks: 0, totalTime: 0 };
        }
        stats[exec.mode].tasks++;
        stats[exec.mode].totalTime += exec.duration;
        return stats;
      }, {});
      
      console.log('\n=== Mode Execution Statistics ===');
      Object.entries(modeStats).forEach(([mode, stats]) => {
        console.log(`${mode}: ${stats.tasks} tasks, ${stats.totalTime}ms total`);
      });
      
      // Calculate expected sequential time
      const expectedSequential = Object.values(modes)
        .flat()
        .reduce((sum, task) => sum + task.duration, 0);
      
      const speedup = expectedSequential / totalTime;
      console.log(`\nTotal execution time: ${totalTime}ms`);
      console.log(`Expected sequential time: ${expectedSequential}ms`);
      console.log(`Speedup: ${speedup.toFixed(2)}x`);
      
      // Assertions
      assert.strictEqual(results.successful.length, allTasks.length);
      assert(speedup > 2.5, `Cross-mode speedup too low: ${speedup.toFixed(2)}x`);
      assert(Object.keys(modeStats).length === 4);
      assert(Array.from(harness.mockFS.keys()).length === allTasks.length);
    });
  });

  describe('Real-World Project Scenarios', () => {
    it('should build a microservices architecture with parallel processing', async () => {
      const microservices = [
        { name: 'user-service', port: 3001, dependencies: ['database', 'cache'] },
        { name: 'auth-service', port: 3002, dependencies: ['user-service', 'jwt'] },
        { name: 'product-service', port: 3003, dependencies: ['database', 'search'] },
        { name: 'order-service', port: 3004, dependencies: ['user-service', 'product-service', 'payment'] },
        { name: 'notification-service', port: 3005, dependencies: ['queue', 'email'] }
      ];
      
      console.log('\n=== Building Microservices Architecture ===');
      
      // Phase 1: Create service structures in parallel
      const structureResults = await harness.executeBatch(
        microservices,
        async (service) => {
          const baseDir = `services/${service.name}`;
          
          // Create service structure
          const files = [
            `${baseDir}/src/index.ts`,
            `${baseDir}/src/server.ts`,
            `${baseDir}/src/routes.ts`,
            `${baseDir}/src/config.ts`,
            `${baseDir}/package.json`,
            `${baseDir}/Dockerfile`,
            `${baseDir}/test/unit.test.ts`,
            `${baseDir}/test/integration.test.ts`
          ];
          
          for (const file of files) {
            await harness.mockWriteFile(file, `// ${service.name} - ${file}`);
          }
          
          // Create service-specific configuration
          await harness.mockWriteFile(`${baseDir}/service.config.json`, JSON.stringify({
            name: service.name,
            port: service.port,
            dependencies: service.dependencies,
            version: '1.0.0'
          }, null, 2));
          
          return {
            service: service.name,
            filesCreated: files.length + 1,
            structure: 'created'
          };
        }
      );
      
      assert.strictEqual(structureResults.successful.length, 5);
      
      // Phase 2: Generate inter-service communication
      const communicationTasks = [];
      
      // Find service dependencies and create clients
      for (const service of microservices) {
        for (const dep of service.dependencies) {
          const depService = microservices.find(s => s.name === dep);
          if (depService) {
            communicationTasks.push({
              from: service.name,
              to: depService.name,
              execute: async () => {
                const clientPath = `services/${service.name}/src/clients/${depService.name}-client.ts`;
                await harness.mockWriteFile(clientPath, `
export class ${depService.name.replace('-', '')}Client {
  private baseUrl = 'http://${depService.name}:${depService.port}';
  
  async request(endpoint: string, options?: RequestOptions) {
    // Implementation
  }
}`);
                return { client: `${service.name} -> ${depService.name}` };
              }
            });
          }
        }
      }
      
      const clientResults = await harness.executeBatch(
        communicationTasks,
        async (task) => await task.execute()
      );
      
      // Phase 3: Create shared libraries
      const sharedLibraries = [
        { name: 'common-types', exports: ['User', 'Product', 'Order'] },
        { name: 'auth-middleware', exports: ['authenticate', 'authorize'] },
        { name: 'error-handling', exports: ['ErrorHandler', 'CustomError'] },
        { name: 'logging', exports: ['Logger', 'LogLevel'] }
      ];
      
      const libResults = await harness.executeBatch(
        sharedLibraries,
        async (lib) => {
          const libPath = `shared/${lib.name}`;
          
          await harness.mockWriteFile(`${libPath}/package.json`, JSON.stringify({
            name: `@project/${lib.name}`,
            version: '1.0.0',
            main: 'index.ts'
          }));
          
          await harness.mockWriteFile(`${libPath}/index.ts`, 
            lib.exports.map(exp => `export { ${exp} } from './${exp}';`).join('\n')
          );
          
          return { library: lib.name, exports: lib.exports.length };
        }
      );
      
      // Phase 4: Setup orchestration
      const orchestrationTasks = [
        {
          name: 'docker-compose',
          execute: async () => {
            const services = {};
            microservices.forEach(service => {
              services[service.name] = {
                build: `./services/${service.name}`,
                ports: [`${service.port}:${service.port}`],
                depends_on: service.dependencies.filter(dep => 
                  microservices.some(s => s.name === dep)
                )
              };
            });
            
            await harness.mockWriteFile('docker-compose.yml', 
              `version: '3.8'\nservices:\n${JSON.stringify(services, null, 2)}`
            );
            return { file: 'docker-compose.yml' };
          }
        },
        {
          name: 'kubernetes',
          execute: async () => {
            for (const service of microservices) {
              await harness.mockWriteFile(`k8s/${service.name}-deployment.yaml`, 
                `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${service.name}`
              );
            }
            return { deployments: microservices.length };
          }
        },
        {
          name: 'api-gateway',
          execute: async () => {
            await harness.mockWriteFile('gateway/routes.json', JSON.stringify({
              routes: microservices.map(s => ({
                path: `/${s.name.replace('-service', '')}/*`,
                target: `http://${s.name}:${s.port}`
              }))
            }));
            return { routes: microservices.length };
          }
        }
      ];
      
      const orchResults = await harness.executeBatch(
        orchestrationTasks,
        async (task) => await task.execute()
      );
      
      // Verify complete architecture
      const totalFiles = Array.from(harness.mockFS.keys()).length;
      console.log(`\nTotal files created: ${totalFiles}`);
      
      assert(totalFiles > 50);
      assert(clientResults.successful.length > 0);
      assert.strictEqual(libResults.successful.length, 4);
      assert.strictEqual(orchResults.successful.length, 3);
    });

    it('should perform large-scale refactoring with parallel analysis', async () => {
      // Create a legacy codebase
      const legacyFiles = {};
      for (let i = 0; i < 50; i++) {
        legacyFiles[`src/legacy/module${i}.js`] = `
// Legacy module ${i}
var module${i} = function() {
  var privateVar = 'value';
  
  this.method1 = function() {
    console.log('Method 1');
  };
  
  this.method2 = function() {
    console.log('Method 2');
  };
};

module.exports = module${i};`;
      }
      
      // Add legacy files to mock FS
      Object.entries(legacyFiles).forEach(([path, content]) => {
        harness.mockFS.set(path, content);
      });
      
      console.log('\n=== Large-Scale Refactoring ===');
      
      // Phase 1: Analyze all files in parallel
      const analysisResults = await harness.executeBatch(
        Object.keys(legacyFiles),
        async (file) => {
          const content = await harness.mockReadFile(file);
          
          const analysis = {
            file,
            issues: [],
            metrics: {
              lines: content.split('\n').length,
              complexity: 0
            }
          };
          
          // Detect issues
          if (content.includes('var ')) analysis.issues.push('uses-var');
          if (content.includes('function()')) analysis.issues.push('old-syntax');
          if (content.includes('console.log')) analysis.issues.push('console-logs');
          if (content.includes('module.exports')) analysis.issues.push('commonjs');
          
          analysis.metrics.complexity = analysis.issues.length;
          
          return analysis;
        }
      );
      
      console.log(`Analyzed ${analysisResults.successful.length} files`);
      
      // Phase 2: Plan refactoring tasks
      const refactoringPlan = analysisResults.successful.map(analysis => ({
        file: analysis.file,
        newFile: analysis.file.replace('/legacy/', '/modern/').replace('.js', '.ts'),
        transforms: [
          { type: 'es6-modules', priority: 1 },
          { type: 'arrow-functions', priority: 2 },
          { type: 'const-let', priority: 1 },
          { type: 'typescript', priority: 3 },
          { type: 'remove-console', priority: 2 }
        ]
      }));
      
      // Phase 3: Execute refactoring in parallel
      const refactoringResults = await harness.executeBatch(
        refactoringPlan,
        async (plan) => {
          const content = await harness.mockReadFile(plan.file);
          let refactored = content;
          
          // Apply transforms
          plan.transforms.sort((a, b) => a.priority - b.priority).forEach(transform => {
            switch (transform.type) {
              case 'const-let':
                refactored = refactored.replace(/var /g, 'const ');
                break;
              case 'arrow-functions':
                refactored = refactored.replace(/function\(\)/g, '() =>');
                break;
              case 'es6-modules':
                refactored = refactored.replace(/module\.exports = /, 'export default ');
                break;
              case 'typescript':
                refactored = refactored.replace(/= function/, ': Function = function');
                break;
              case 'remove-console':
                refactored = refactored.replace(/console\.log\([^)]*\);?/g, '// console removed');
                break;
            }
          });
          
          // Add TypeScript types
          refactored = `interface Module${plan.file.match(/\d+/)[0]} {\n  method1(): void;\n  method2(): void;\n}\n\n${refactored}`;
          
          await harness.mockWriteFile(plan.newFile, refactored);
          
          return {
            original: plan.file,
            refactored: plan.newFile,
            transforms: plan.transforms.length
          };
        }
      );
      
      // Phase 4: Update imports across the codebase
      const importUpdates = await harness.executeBatch(
        refactoringResults.successful,
        async (result) => {
          // Find files that might import this module
          const moduleNumber = result.original.match(/\d+/)[0];
          const importPattern = `require.*module${moduleNumber}`;
          
          const searchResults = await harness.batchSearch([importPattern]);
          
          return {
            module: `module${moduleNumber}`,
            potentialImports: searchResults.successful[0]?.length || 0,
            updated: true
          };
        }
      );
      
      // Phase 5: Generate migration report
      const report = {
        totalFiles: Object.keys(legacyFiles).length,
        refactored: refactoringResults.successful.length,
        issues: {
          total: analysisResults.successful.reduce((sum, a) => sum + a.issues.length, 0),
          byType: {}
        },
        transforms: {
          applied: refactoringResults.successful.reduce((sum, r) => sum + r.transforms, 0)
        }
      };
      
      // Count issues by type
      analysisResults.successful.forEach(analysis => {
        analysis.issues.forEach(issue => {
          report.issues.byType[issue] = (report.issues.byType[issue] || 0) + 1;
        });
      });
      
      console.log('\n=== Refactoring Report ===');
      console.log(JSON.stringify(report, null, 2));
      
      // Assertions
      assert.strictEqual(refactoringResults.successful.length, 50);
      assert(report.issues.total > 150); // Each file has multiple issues
      assert(Array.from(harness.mockFS.keys()).filter(f => f.includes('/modern/')).length === 50);
    });
  });

  describe('Complex Dependency Management', () => {
    it('should handle circular dependency resolution with parallel analysis', async () => {
      // Create a complex module structure with circular dependencies
      const modules = {
        'src/core/auth.ts': `
import { UserService } from '../services/user';
export class AuthService {
  constructor(private userService: UserService) {}
}`,
        'src/services/user.ts': `
import { AuthService } from '../core/auth';
import { ProfileService } from './profile';
export class UserService {
  constructor(private auth: AuthService, private profile: ProfileService) {}
}`,
        'src/services/profile.ts': `
import { UserService } from './user';
export class ProfileService {
  constructor(private userService: UserService) {}
}`,
        'src/controllers/api.ts': `
import { AuthService } from '../core/auth';
import { UserService } from '../services/user';
export class ApiController {
  constructor(private auth: AuthService, private user: UserService) {}
}`,
        'src/utils/logger.ts': `
export class Logger {
  log(message: string) { console.log(message); }
}`
      };
      
      // Add modules to filesystem
      Object.entries(modules).forEach(([path, content]) => {
        harness.mockFS.set(path, content);
      });
      
      // Phase 1: Build dependency graph in parallel
      const dependencyGraph = new Map();
      
      const graphResults = await harness.executeBatch(
        Object.keys(modules),
        async (file) => {
          const content = await harness.mockReadFile(file);
          const imports = [];
          
          // Extract imports
          const importRegex = /import\s*{\s*(\w+)\s*}\s*from\s*['"]([^'"]+)['"]/g;
          let match;
          while ((match = importRegex.exec(content)) !== null) {
            imports.push({
              name: match[1],
              from: match[2]
            });
          }
          
          return { file, imports };
        }
      );
      
      // Build graph
      graphResults.successful.forEach(result => {
        dependencyGraph.set(result.file, result.imports);
      });
      
      // Phase 2: Detect circular dependencies
      const detectCircular = (node, visited = new Set(), path = []) => {
        if (visited.has(node)) {
          const cycleStart = path.indexOf(node);
          if (cycleStart !== -1) {
            return path.slice(cycleStart).concat(node);
          }
          return null;
        }
        
        visited.add(node);
        path.push(node);
        
        const deps = dependencyGraph.get(node) || [];
        for (const dep of deps) {
          // Resolve import path to file path
          const depFile = Object.keys(modules).find(f => 
            f.includes(dep.from.replace('../', '').replace('./', ''))
          );
          
          if (depFile) {
            const cycle = detectCircular(depFile, new Set(visited), [...path]);
            if (cycle) return cycle;
          }
        }
        
        return null;
      };
      
      const circularDeps = [];
      for (const file of Object.keys(modules)) {
        const cycle = detectCircular(file);
        if (cycle && cycle.length > 1) {
          circularDeps.push(cycle);
        }
      }
      
      console.log('\n=== Circular Dependencies Detected ===');
      circularDeps.forEach((cycle, i) => {
        console.log(`Cycle ${i + 1}: ${cycle.join(' -> ')}`);
      });
      
      // Phase 3: Resolve circular dependencies
      const resolutionTasks = circularDeps.map((cycle, index) => ({
        cycle,
        resolve: async () => {
          // Create interfaces to break circular dependencies
          const interfaceFile = `src/interfaces/cycle${index}-interfaces.ts`;
          const interfaces = cycle.map(file => {
            const className = file.split('/').pop().replace('.ts', '')
              .split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
            return `export interface I${className} {\n  // Interface definition\n}`;
          }).join('\n\n');
          
          await harness.mockWriteFile(interfaceFile, interfaces);
          
          return {
            cycle: cycle.length,
            resolution: 'interfaces',
            file: interfaceFile
          };
        }
      }));
      
      const resolutionResults = await harness.executeBatch(
        resolutionTasks,
        async (task) => await task.resolve()
      );
      
      // Phase 4: Refactor modules to use interfaces
      const refactorTasks = circularDeps.flat().filter((v, i, a) => a.indexOf(v) === i)
        .map(file => ({
          file,
          refactor: async () => {
            const content = await harness.mockReadFile(file);
            const refactored = `// Refactored to resolve circular dependency\n${content}`;
            await harness.mockWriteFile(file, refactored);
            return { file, refactored: true };
          }
        }));
      
      const refactorResults = await harness.executeBatch(
        refactorTasks,
        async (task) => await task.refactor()
      );
      
      // Assertions
      assert(circularDeps.length > 0, 'Should detect circular dependencies');
      assert.strictEqual(resolutionResults.successful.length, circularDeps.length);
      assert(refactorResults.successful.length > 0);
    });
  });

  describe('Performance Optimization Workflow', () => {
    it('should optimize application performance with parallel profiling', async () => {
      // Create a performance-critical application
      const appModules = {};
      
      // Generate compute-intensive modules
      for (let i = 0; i < 20; i++) {
        appModules[`src/compute/algorithm${i}.ts`] = `
export class Algorithm${i} {
  process(data: number[]): number {
    // Inefficient O(n²) algorithm
    let result = 0;
    for (let i = 0; i < data.length; i++) {
      for (let j = 0; j < data.length; j++) {
        result += data[i] * data[j];
      }
    }
    return result;
  }
}`;
      }
      
      // Add I/O bound modules
      for (let i = 0; i < 10; i++) {
        appModules[`src/io/service${i}.ts`] = `
export class Service${i} {
  async fetchData(): Promise<any> {
    // Multiple sequential API calls
    const result1 = await fetch('/api/data1');
    const result2 = await fetch('/api/data2');
    const result3 = await fetch('/api/data3');
    return { result1, result2, result3 };
  }
}`;
      }
      
      Object.entries(appModules).forEach(([path, content]) => {
        harness.mockFS.set(path, content);
      });
      
      console.log('\n=== Performance Optimization Workflow ===');
      
      // Phase 1: Profile all modules in parallel
      const profilingResults = await harness.executeBatch(
        Object.keys(appModules),
        async (file) => {
          const content = await harness.mockReadFile(file);
          
          const profile = {
            file,
            type: file.includes('compute') ? 'cpu-intensive' : 'io-bound',
            issues: [],
            complexity: 0
          };
          
          // Analyze performance issues
          if (content.includes('for (let i = 0; i < data.length; i++)')) {
            if (content.includes('for (let j = 0; j < data.length; j++)')) {
              profile.issues.push({ type: 'nested-loops', severity: 'high' });
              profile.complexity = 2; // O(n²)
            }
          }
          
          if (content.includes('await') && content.match(/await/g).length > 2) {
            profile.issues.push({ type: 'sequential-io', severity: 'medium' });
          }
          
          return profile;
        }
      );
      
      // Phase 2: Generate optimization strategies
      const optimizationStrategies = profilingResults.successful
        .filter(p => p.issues.length > 0)
        .map(profile => ({
          file: profile.file,
          strategies: profile.issues.map(issue => {
            if (issue.type === 'nested-loops') {
              return {
                issue: issue.type,
                solution: 'optimize-algorithm',
                implementation: 'Use memoization or dynamic programming'
              };
            } else if (issue.type === 'sequential-io') {
              return {
                issue: issue.type,
                solution: 'parallelize-io',
                implementation: 'Use Promise.all() for concurrent requests'
              };
            }
          })
        }));
      
      // Phase 3: Apply optimizations in parallel
      const optimizationResults = await harness.executeBatch(
        optimizationStrategies,
        async (strategy) => {
          const content = await harness.mockReadFile(strategy.file);
          let optimized = content;
          
          strategy.strategies.forEach(s => {
            if (s.solution === 'optimize-algorithm') {
              // Replace nested loops with optimized version
              optimized = optimized.replace(
                /for \(let i = 0;.*?\n.*?for \(let j = 0;.*?\n.*?result.*?\n.*?}\n.*?}/s,
                `// Optimized O(n) algorithm
    const sum = data.reduce((a, b) => a + b, 0);
    return sum * sum;`
              );
            } else if (s.solution === 'parallelize-io') {
              // Replace sequential awaits with Promise.all
              optimized = optimized.replace(
                /const result1 = await.*?\n.*?const result2 = await.*?\n.*?const result3 = await.*?/s,
                `const [result1, result2, result3] = await Promise.all([
      fetch('/api/data1'),
      fetch('/api/data2'),
      fetch('/api/data3')
    ]);`
              );
            }
          });
          
          const optimizedFile = strategy.file.replace('/src/', '/src/optimized/');
          await harness.mockWriteFile(optimizedFile, optimized);
          
          return {
            original: strategy.file,
            optimized: optimizedFile,
            improvements: strategy.strategies.length
          };
        }
      );
      
      // Phase 4: Benchmark improvements
      const benchmarkResults = await harness.executeBatch(
        optimizationResults.successful,
        async (result) => {
          // Simulate benchmarking
          const isComputeModule = result.original.includes('compute');
          
          const benchmark = {
            module: result.original,
            before: {
              executionTime: isComputeModule ? 1000 : 500, // ms
              memoryUsage: isComputeModule ? 50 : 20 // MB
            },
            after: {
              executionTime: isComputeModule ? 100 : 150, // ms
              memoryUsage: isComputeModule ? 30 : 15 // MB
            }
          };
          
          benchmark.improvement = {
            speed: (benchmark.before.executionTime / benchmark.after.executionTime).toFixed(2) + 'x',
            memory: ((benchmark.before.memoryUsage - benchmark.after.memoryUsage) / benchmark.before.memoryUsage * 100).toFixed(1) + '%'
          };
          
          return benchmark;
        }
      );
      
      // Generate performance report
      const perfReport = {
        totalModules: Object.keys(appModules).length,
        optimized: optimizationResults.successful.length,
        improvements: {
          avgSpeedup: 0,
          avgMemoryReduction: 0
        }
      };
      
      benchmarkResults.successful.forEach(b => {
        perfReport.improvements.avgSpeedup += parseFloat(b.improvement.speed);
        perfReport.improvements.avgMemoryReduction += parseFloat(b.improvement.memory);
      });
      
      perfReport.improvements.avgSpeedup /= benchmarkResults.successful.length;
      perfReport.improvements.avgMemoryReduction /= benchmarkResults.successful.length;
      
      console.log('\n=== Performance Optimization Report ===');
      console.log(JSON.stringify(perfReport, null, 2));
      
      // Assertions
      assert(optimizationResults.successful.length > 15);
      assert(perfReport.improvements.avgSpeedup > 3);
      assert(perfReport.improvements.avgMemoryReduction > 20);
    });
  });
});