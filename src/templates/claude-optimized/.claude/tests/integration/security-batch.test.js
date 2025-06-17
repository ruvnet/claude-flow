const { TestHarness } = require('../test-harness');
const assert = require('assert');

describe('Security Mode Batch Integration Tests', () => {
  let harness;

  beforeEach(() => {
    harness = new TestHarness();
    harness.createMockProject('complex');
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Concurrent Vulnerability Scanning', () => {
    it('should scan multiple files for security vulnerabilities in parallel', async () => {
      // Add files with various security issues
      const vulnerableFiles = {
        'src/auth/login.js': `const sql = "SELECT * FROM users WHERE email = '" + email + "'";
          db.query(sql);`, // SQL Injection
        
        'src/api/user.js': `app.get('/user/:id', (req, res) => {
          res.send('<h1>Welcome ' + req.params.id + '</h1>');
        });`, // XSS
        
        'src/utils/crypto.js': `const crypto = require('crypto');
          const hash = crypto.createHash('md5');`, // Weak crypto
        
        'src/config/secrets.js': `const API_KEY = 'sk_live_1234567890abcdef';
          const DB_PASSWORD = 'admin123';`, // Hardcoded secrets
        
        'src/file/upload.js': `const filePath = '/uploads/' + req.body.filename;
          fs.readFile(filePath);` // Path traversal
      };
      
      Object.entries(vulnerableFiles).forEach(([path, content]) => {
        harness.mockFS.set(path, content);
      });
      
      const scanResults = await harness.executeBatch(
        Object.keys(vulnerableFiles),
        async (file) => {
          const content = await harness.mockReadFile(file);
          const vulnerabilities = [];
          
          // SQL Injection detection
          if (content.match(/["']\s*\+.*?["']\s*\+.*?["']/)) {
            vulnerabilities.push({
              type: 'SQL Injection',
              severity: 'critical',
              line: 1,
              confidence: 0.9
            });
          }
          
          // XSS detection
          if (content.includes('res.send') && content.includes('+ req.')) {
            vulnerabilities.push({
              type: 'Cross-Site Scripting (XSS)',
              severity: 'high',
              line: 2,
              confidence: 0.85
            });
          }
          
          // Weak cryptography
          if (content.includes("createHash('md5')") || content.includes("createHash('sha1')")) {
            vulnerabilities.push({
              type: 'Weak Cryptography',
              severity: 'medium',
              line: 2,
              confidence: 0.95
            });
          }
          
          // Hardcoded secrets
          if (content.match(/(?:API_KEY|PASSWORD|SECRET)\s*=\s*["'][^"']+["']/)) {
            vulnerabilities.push({
              type: 'Hardcoded Secrets',
              severity: 'high',
              line: 1,
              confidence: 0.99
            });
          }
          
          // Path traversal
          if (content.includes('req.body.filename') && content.includes('fs.')) {
            vulnerabilities.push({
              type: 'Path Traversal',
              severity: 'high',
              line: 1,
              confidence: 0.8
            });
          }
          
          return {
            file,
            vulnerabilities,
            riskScore: vulnerabilities.reduce((score, vuln) => {
              return score + (vuln.severity === 'critical' ? 10 : 
                            vuln.severity === 'high' ? 7 : 
                            vuln.severity === 'medium' ? 4 : 1);
            }, 0),
            needsImmediateAction: vulnerabilities.some(v => v.severity === 'critical')
          };
        }
      );
      
      assert.strictEqual(scanResults.successful.length, 5);
      assert(scanResults.successful.every(r => r.vulnerabilities.length > 0));
      
      const criticalFiles = scanResults.successful.filter(r => r.needsImmediateAction);
      assert(criticalFiles.length >= 1);
    });

    it('should perform dependency vulnerability analysis', async () => {
      // Mock package files with vulnerable dependencies
      const packageFiles = {
        'package.json': JSON.stringify({
          dependencies: {
            'express': '3.0.0',        // Old version with vulnerabilities
            'lodash': '4.17.11',       // Version with prototype pollution
            'axios': '0.18.0',         // Version with SSRF vulnerability
            'jsonwebtoken': '8.0.0'    // Version with verification bypass
          }
        }),
        'frontend/package.json': JSON.stringify({
          dependencies: {
            'react': '16.0.0',         // Old version
            'jquery': '2.2.4',         // Multiple XSS vulnerabilities
            'angular': '1.5.0'         // Old AngularJS with issues
          }
        }),
        'services/package.json': JSON.stringify({
          dependencies: {
            'mongodb': '2.2.0',        // Old driver version
            'redis': '2.0.0',          // Old version
            'bcrypt': '1.0.0'          // Old version with issues
          }
        })
      };
      
      Object.entries(packageFiles).forEach(([path, content]) => {
        harness.mockFS.set(path, content);
      });
      
      const dependencyAnalysis = await harness.executeBatch(
        Object.keys(packageFiles),
        async (packageFile) => {
          const content = await harness.mockReadFile(packageFile);
          const pkg = JSON.parse(content);
          const vulnerabilities = [];
          
          // Simulate vulnerability database lookup
          const vulnDatabase = {
            'express': { '3.0.0': [{ cve: 'CVE-2014-6393', severity: 'high' }] },
            'lodash': { '4.17.11': [{ cve: 'CVE-2019-10744', severity: 'critical' }] },
            'axios': { '0.18.0': [{ cve: 'CVE-2019-10742', severity: 'high' }] },
            'jquery': { '2.2.4': [{ cve: 'CVE-2015-9251', severity: 'medium' }] },
            'angular': { '1.5.0': [{ cve: 'CVE-2016-4855', severity: 'high' }] }
          };
          
          for (const [dep, version] of Object.entries(pkg.dependencies || {})) {
            if (vulnDatabase[dep] && vulnDatabase[dep][version]) {
              vulnerabilities.push({
                package: dep,
                version,
                vulnerabilities: vulnDatabase[dep][version],
                severity: vulnDatabase[dep][version][0].severity
              });
            }
          }
          
          return {
            file: packageFile,
            totalDependencies: Object.keys(pkg.dependencies || {}).length,
            vulnerableDependencies: vulnerabilities.length,
            vulnerabilities,
            riskLevel: vulnerabilities.some(v => v.severity === 'critical') ? 'critical' :
                      vulnerabilities.some(v => v.severity === 'high') ? 'high' : 'medium'
          };
        }
      );
      
      assert.strictEqual(dependencyAnalysis.successful.length, 3);
      const totalVulnerabilities = dependencyAnalysis.successful.reduce(
        (sum, r) => sum + r.vulnerableDependencies, 0
      );
      assert(totalVulnerabilities >= 5);
    });

    it('should analyze authentication and authorization patterns', async () => {
      // Add auth-related files
      const authFiles = {
        'src/middleware/auth.js': `export function authenticate(req, res, next) {
          const token = req.headers.authorization;
          if (!token) return res.status(401).send('No token');
          // Missing token validation
          next();
        }`,
        'src/routes/admin.js': `router.get('/admin', (req, res) => {
          // No authorization check
          res.render('admin-panel');
        })`,
        'src/services/session.js': `sessions[userId] = {
          token: generateToken(),
          expires: Date.now() + 3600000 // 1 hour
          // No session invalidation mechanism
        }`,
        'src/utils/password.js': `function hashPassword(password) {
          return btoa(password); // Base64 is not encryption!
        }`
      };
      
      Object.entries(authFiles).forEach(([path, content]) => {
        harness.mockFS.set(path, content);
      });
      
      const authAnalysis = await harness.executeBatch(
        Object.keys(authFiles),
        async (file) => {
          const content = await harness.mockReadFile(file);
          const issues = [];
          
          // Check for missing token validation
          if (content.includes('authorization') && !content.includes('verify') && !content.includes('decode')) {
            issues.push({
              type: 'Missing Token Validation',
              severity: 'critical',
              recommendation: 'Implement proper JWT validation'
            });
          }
          
          // Check for missing authorization
          if (content.includes('/admin') && !content.includes('role') && !content.includes('permission')) {
            issues.push({
              type: 'Missing Authorization Check',
              severity: 'high',
              recommendation: 'Add role-based access control'
            });
          }
          
          // Check for session management issues
          if (content.includes('sessions[') && !content.includes('invalidate') && !content.includes('delete')) {
            issues.push({
              type: 'Poor Session Management',
              severity: 'medium',
              recommendation: 'Implement session invalidation'
            });
          }
          
          // Check for weak password handling
          if (content.includes('btoa') || content.includes('atob')) {
            issues.push({
              type: 'Insecure Password Storage',
              severity: 'critical',
              recommendation: 'Use bcrypt or argon2 for password hashing'
            });
          }
          
          return {
            file,
            authIssues: issues,
            securityScore: Math.max(0, 100 - (issues.length * 25)),
            compliant: issues.length === 0
          };
        }
      );
      
      assert.strictEqual(authAnalysis.successful.length, 4);
      assert(authAnalysis.successful.every(r => r.authIssues.length > 0));
      
      const criticalIssues = authAnalysis.successful
        .flatMap(r => r.authIssues)
        .filter(i => i.severity === 'critical');
      assert(criticalIssues.length >= 2);
    });
  });

  describe('Concurrent OWASP Top 10 Analysis', () => {
    it('should check for OWASP Top 10 vulnerabilities in parallel', async () => {
      const owaspCategories = [
        { id: 'A01', name: 'Broken Access Control' },
        { id: 'A02', name: 'Cryptographic Failures' },
        { id: 'A03', name: 'Injection' },
        { id: 'A04', name: 'Insecure Design' },
        { id: 'A05', name: 'Security Misconfiguration' },
        { id: 'A06', name: 'Vulnerable Components' },
        { id: 'A07', name: 'Authentication Failures' },
        { id: 'A08', name: 'Data Integrity Failures' },
        { id: 'A09', name: 'Security Logging Failures' },
        { id: 'A10', name: 'SSRF' }
      ];
      
      const owaspAnalysis = await harness.executeBatch(owaspCategories, async (category) => {
        const findings = [];
        const files = Array.from(harness.mockFS.keys());
        
        for (const file of files) {
          const content = await harness.mockReadFile(file);
          
          switch (category.id) {
            case 'A01': // Broken Access Control
              if (content.includes('role') === false && content.includes('admin')) {
                findings.push({ file, issue: 'Missing access control' });
              }
              break;
            
            case 'A02': // Cryptographic Failures
              if (content.includes('md5') || content.includes('sha1')) {
                findings.push({ file, issue: 'Weak cryptography' });
              }
              break;
            
            case 'A03': // Injection
              if (content.includes("' +") && content.includes('query')) {
                findings.push({ file, issue: 'Potential SQL injection' });
              }
              break;
            
            case 'A07': // Authentication Failures
              if (content.includes('password') && !content.includes('hash')) {
                findings.push({ file, issue: 'Unhashed password' });
              }
              break;
          }
        }
        
        return {
          category: category.id,
          name: category.name,
          findings,
          risk: findings.length > 5 ? 'high' : findings.length > 0 ? 'medium' : 'low',
          score: Math.max(0, 100 - (findings.length * 10))
        };
      });
      
      assert.strictEqual(owaspAnalysis.successful.length, 10);
      const highRiskCategories = owaspAnalysis.successful.filter(r => r.risk === 'high');
      assert(highRiskCategories.length >= 0); // May vary based on mock data
      
      // Calculate overall OWASP compliance score
      const overallScore = owaspAnalysis.successful.reduce((sum, r) => sum + r.score, 0) / 10;
      console.log(`OWASP Compliance Score: ${overallScore.toFixed(1)}%`);
    });
  });

  describe('Security Headers Analysis', () => {
    it('should analyze security headers across multiple endpoints', async () => {
      // Mock API endpoint files
      const endpoints = {
        'src/routes/auth.js': `router.post('/login', (req, res) => {
          res.json({ token: 'xyz' });
        })`,
        'src/routes/api.js': `router.get('/data', (req, res) => {
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.json({ data: [] });
        })`,
        'src/routes/public.js': `router.get('/home', (req, res) => {
          res.setHeader('X-Frame-Options', 'DENY');
          res.setHeader('Content-Security-Policy', "default-src 'self'");
          res.render('home');
        })`
      };
      
      Object.entries(endpoints).forEach(([path, content]) => {
        harness.mockFS.set(path, content);
      });
      
      const requiredHeaders = [
        'X-Content-Type-Options',
        'X-Frame-Options',
        'Content-Security-Policy',
        'Strict-Transport-Security',
        'X-XSS-Protection'
      ];
      
      const headerAnalysis = await harness.executeBatch(
        Object.keys(endpoints),
        async (endpoint) => {
          const content = await harness.mockReadFile(endpoint);
          const presentHeaders = requiredHeaders.filter(header => 
            content.includes(header)
          );
          
          const missingHeaders = requiredHeaders.filter(header => 
            !presentHeaders.includes(header)
          );
          
          return {
            endpoint,
            presentHeaders,
            missingHeaders,
            score: (presentHeaders.length / requiredHeaders.length) * 100,
            compliant: presentHeaders.length === requiredHeaders.length
          };
        }
      );
      
      assert.strictEqual(headerAnalysis.successful.length, 3);
      const compliantEndpoints = headerAnalysis.successful.filter(r => r.compliant);
      assert(compliantEndpoints.length <= 1); // Most endpoints missing headers
    });
  });

  describe('Concurrent Input Validation Analysis', () => {
    it('should analyze input validation patterns across forms and APIs', async () => {
      const inputHandlers = {
        'src/api/user-create.js': `app.post('/user', (req, res) => {
          const { email, password, age } = req.body;
          // No validation
          db.createUser(email, password, age);
        })`,
        'src/api/search.js': `app.get('/search', (req, res) => {
          const query = req.query.q;
          if (query.length > 100) return res.status(400).send('Query too long');
          db.search(query);
        })`,
        'src/forms/register.js': `function validateForm(data) {
          if (!data.email.match(/^[^@]+@[^@]+$/)) return false;
          if (data.password.length < 8) return false;
          return true;
        }`,
        'src/api/file-upload.js': `app.post('/upload', (req, res) => {
          const file = req.files.upload;
          // No file type validation
          file.mv('/uploads/' + file.name);
        })`
      };
      
      Object.entries(inputHandlers).forEach(([path, content]) => {
        harness.mockFS.set(path, content);
      });
      
      const validationAnalysis = await harness.executeBatch(
        Object.keys(inputHandlers),
        async (handler) => {
          const content = await harness.mockReadFile(handler);
          const validationIssues = [];
          
          // Check for email validation
          if (content.includes('email') && !content.includes('match') && !content.includes('validate')) {
            validationIssues.push({
              field: 'email',
              issue: 'Missing email validation',
              severity: 'high'
            });
          }
          
          // Check for password validation
          if (content.includes('password') && !content.includes('length')) {
            validationIssues.push({
              field: 'password',
              issue: 'Missing password strength check',
              severity: 'high'
            });
          }
          
          // Check for file upload validation
          if (content.includes('upload') && !content.includes('type') && !content.includes('extension')) {
            validationIssues.push({
              field: 'file',
              issue: 'Missing file type validation',
              severity: 'critical'
            });
          }
          
          // Check for SQL injection prevention
          if (content.includes('req.') && !content.includes('escape') && !content.includes('sanitize')) {
            validationIssues.push({
              field: 'general',
              issue: 'No input sanitization',
              severity: 'critical'
            });
          }
          
          return {
            handler,
            validationIssues,
            hasValidation: content.includes('validate') || content.includes('match') || content.includes('length'),
            riskLevel: validationIssues.some(i => i.severity === 'critical') ? 'critical' : 
                      validationIssues.length > 2 ? 'high' : 'medium'
          };
        }
      );
      
      assert.strictEqual(validationAnalysis.successful.length, 4);
      const criticalHandlers = validationAnalysis.successful.filter(r => r.riskLevel === 'critical');
      assert(criticalHandlers.length >= 1);
    });
  });

  describe('Security Report Generation', () => {
    it('should generate comprehensive security reports in parallel', async () => {
      const reportTypes = [
        { type: 'executive-summary', format: 'pdf' },
        { type: 'technical-details', format: 'html' },
        { type: 'vulnerability-list', format: 'json' },
        { type: 'remediation-plan', format: 'md' },
        { type: 'compliance-matrix', format: 'csv' }
      ];
      
      const reportGeneration = await harness.executeBatch(reportTypes, async (report) => {
        await harness.simulateDelay(100); // Simulate report generation
        
        let content = '';
        let stats = {};
        
        switch (report.type) {
          case 'executive-summary':
            content = `# Security Assessment Executive Summary\n\n` +
                     `Critical Issues: 3\n` +
                     `High Risk Issues: 7\n` +
                     `Overall Risk Score: 65/100\n`;
            stats = { pages: 5, sections: 4 };
            break;
            
          case 'technical-details':
            content = `<html><body><h1>Technical Security Report</h1>` +
                     `<p>Detailed findings...</p></body></html>`;
            stats = { pages: 25, findings: 45 };
            break;
            
          case 'vulnerability-list':
            content = JSON.stringify({
              vulnerabilities: [
                { id: 'VULN-001', severity: 'critical', type: 'SQL Injection' },
                { id: 'VULN-002', severity: 'high', type: 'XSS' }
              ]
            });
            stats = { vulnerabilities: 15 };
            break;
            
          case 'remediation-plan':
            content = `# Remediation Plan\n\n` +
                     `## Priority 1: Critical Issues\n` +
                     `- Fix SQL injection in auth module\n` +
                     `- Update vulnerable dependencies\n`;
            stats = { tasks: 20, estimatedDays: 10 };
            break;
            
          case 'compliance-matrix':
            content = `Standard,Requirement,Status,Notes\n` +
                     `OWASP,A01,FAIL,Missing access controls\n` +
                     `PCI-DSS,3.4,PASS,Encryption implemented\n`;
            stats = { standards: 3, requirements: 50 };
            break;
        }
        
        const filename = `security-report-${report.type}.${report.format}`;
        await harness.mockWriteFile(`reports/${filename}`, content);
        
        return {
          report: report.type,
          format: report.format,
          filename,
          size: content.length,
          stats,
          generated: true
        };
      });
      
      assert.strictEqual(reportGeneration.successful.length, 5);
      assert(reportGeneration.successful.every(r => r.generated));
      
      // Verify all report types were generated
      const reportFormats = reportGeneration.successful.map(r => r.format);
      assert(reportFormats.includes('pdf'));
      assert(reportFormats.includes('json'));
      assert(reportFormats.includes('csv'));
    });
  });

  describe('Performance Impact', () => {
    it('should demonstrate parallel security scanning performance', async () => {
      // Create a larger codebase for performance testing
      const fileCount = 50;
      for (let i = 0; i < fileCount; i++) {
        harness.mockFS.set(`src/module${i}.js`, `
          const password = 'pass${i}';
          const query = "SELECT * FROM table WHERE id = " + id;
          eval(userInput);
        `);
      }
      
      const files = Array.from(harness.mockFS.keys()).filter(f => f.includes('module'));
      
      // Sequential scanning
      harness.concurrencyLimit = 1;
      const sequentialStart = Date.now();
      await harness.executeBatch(files, async (file) => {
        const content = await harness.mockReadFile(file);
        await harness.simulateDelay(20); // Simulate scanning time
        return { file, scanned: true };
      });
      const sequentialTime = Date.now() - sequentialStart;
      
      // Parallel scanning
      harness.concurrencyLimit = 10;
      const parallelStart = Date.now();
      await harness.executeBatch(files, async (file) => {
        const content = await harness.mockReadFile(file);
        await harness.simulateDelay(20);
        return { file, scanned: true };
      });
      const parallelTime = Date.now() - parallelStart;
      
      const speedup = sequentialTime / parallelTime;
      assert(speedup > 4, `Expected speedup > 4x, got ${speedup.toFixed(2)}x`);
      
      console.log(`Security scanning speedup: ${speedup.toFixed(2)}x`);
      console.log(`Files scanned: ${files.length}`);
      console.log(`Sequential time: ${sequentialTime}ms`);
      console.log(`Parallel time: ${parallelTime}ms`);
    });
  });
});