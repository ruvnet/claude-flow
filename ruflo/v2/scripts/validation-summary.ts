#!/usr/bin/env tsx

/**
 * Production Validation Summary Script
 * 
 * Runs comprehensive validation checks and generates summary report
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { execSync } from 'child_process';

interface ValidationResult {
  category: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: string[];
}

class ProductionValidator {
  private results: ValidationResult[] = [];

  async runAllValidations(): Promise<void> {
    console.log('🔍 Starting comprehensive production validation...\n');

    await this.validateBuildSystem();
    await this.validateTestInfrastructure();
    await this.validateMockImplementations();
    await this.validateSecurityConfiguration();
    await this.validateEnvironmentSetup();
    await this.validateDeploymentReadiness();

    this.generateSummaryReport();
  }

  private async validateBuildSystem(): Promise<void> {
    console.log('📦 Validating build system...');

    try {
      // Check TypeScript compilation
      execSync('npx tsc --noEmit', { stdio: 'pipe' });
      this.addResult('Build System', 'pass', 'TypeScript compilation successful');
    } catch (error) {
      this.addResult('Build System', 'fail', 'TypeScript compilation failed', [
        'TypeScript compiler errors detected',
        'Build artifacts cannot be generated',
        'Deployment blocked'
      ]);
    }

    // Check package.json integrity
    try {
      const packageJson = await fs.readJson('package.json');
      if (packageJson.scripts?.build && packageJson.scripts?.test) {
        this.addResult('Build Scripts', 'pass', 'Build and test scripts configured');
      } else {
        this.addResult('Build Scripts', 'warning', 'Some build scripts missing');
      }
    } catch (error) {
      this.addResult('Build Scripts', 'fail', 'package.json validation failed');
    }

    // Check dependencies
    try {
      const lockExists = await fs.pathExists('package-lock.json') || await fs.pathExists('pnpm-lock.yaml');
      if (lockExists) {
        this.addResult('Dependencies', 'pass', 'Lock file present for reproducible builds');
      } else {
        this.addResult('Dependencies', 'warning', 'No lock file found');
      }
    } catch (error) {
      this.addResult('Dependencies', 'fail', 'Dependency validation failed');
    }
  }

  private async validateTestInfrastructure(): Promise<void> {
    console.log('🧪 Validating test infrastructure...');

    // Check Jest configuration
    try {
      const jestConfig = await fs.pathExists('jest.config.js');
      if (jestConfig) {
        this.addResult('Test Configuration', 'pass', 'Jest configuration found');
      } else {
        this.addResult('Test Configuration', 'fail', 'Jest configuration missing');
      }
    } catch (error) {
      this.addResult('Test Configuration', 'fail', 'Test configuration validation failed');
    }

    // Check production test files
    try {
      const productionTestsDir = 'tests/production';
      const testFiles = await fs.readdir(productionTestsDir).catch(() => []);
      
      if (testFiles.length >= 5) {
        this.addResult('Production Tests', 'pass', `Found ${testFiles.length} production test files`);
      } else if (testFiles.length > 0) {
        this.addResult('Production Tests', 'warning', `Only ${testFiles.length} production test files found`);
      } else {
        this.addResult('Production Tests', 'fail', 'No production test files found');
      }
    } catch (error) {
      this.addResult('Production Tests', 'fail', 'Production test validation failed');
    }

    // Try to run tests
    try {
      execSync('npm test -- --passWithNoTests --silent', { stdio: 'pipe' });
      this.addResult('Test Execution', 'pass', 'Test runner functional');
    } catch (error) {
      this.addResult('Test Execution', 'warning', 'Test runner has issues', [
        'Some tests may be failing',
        'Test configuration may need adjustment'
      ]);
    }
  }

  private async validateMockImplementations(): Promise<void> {
    console.log('🎭 Validating mock implementations...');

    const mockPatterns = [
      /mock[A-Z]\w+/g,
      /fake[A-Z]\w+/g,
      /stub[A-Z]\w+/g,
      /TODO.*implementation/gi,
      /FIXME.*mock/gi
    ];

    const srcFiles = await this.getSourceFiles('src');
    let mockCount = 0;
    const mockFiles: string[] = [];

    for (const file of srcFiles) {
      if (file.includes('test') || file.includes('spec') || file.includes('mock-components.ts')) {
        continue; // Skip test files and known mock files
      }

      try {
        const content = await fs.readFile(file, 'utf8');
        const hasMocks = mockPatterns.some(pattern => pattern.test(content));
        
        if (hasMocks) {
          mockCount++;
          mockFiles.push(file);
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    if (mockCount === 0) {
      this.addResult('Mock Implementations', 'pass', 'No mock implementations found in production code');
    } else if (mockCount <= 3) {
      this.addResult('Mock Implementations', 'warning', `${mockCount} files with mock implementations found`, mockFiles);
    } else {
      this.addResult('Mock Implementations', 'fail', `${mockCount} files with mock implementations found`, mockFiles);
    }
  }

  private async validateSecurityConfiguration(): Promise<void> {
    console.log('🔒 Validating security configuration...');

    // Check for security-related environment variables
    const securityEnvVars = ['JWT_SECRET', 'API_KEY', 'ENCRYPTION_KEY'];
    const presentVars = securityEnvVars.filter(varName => process.env[varName]);

    if (presentVars.length > 0) {
      this.addResult('Security Environment', 'pass', `${presentVars.length} security environment variables configured`);
    } else {
      this.addResult('Security Environment', 'warning', 'No security environment variables found', [
        'This may be expected in development',
        'Ensure production deployment has proper secrets'
      ]);
    }

    // Check for HTTPS enforcement
    const nodeEnv = process.env.NODE_ENV || 'development';
    if (nodeEnv === 'production') {
      const httpsEnforced = process.env.FORCE_HTTPS === 'true';
      if (httpsEnforced) {
        this.addResult('HTTPS Enforcement', 'pass', 'HTTPS enforcement enabled for production');
      } else {
        this.addResult('HTTPS Enforcement', 'fail', 'HTTPS enforcement not configured for production');
      }
    } else {
      this.addResult('HTTPS Enforcement', 'pass', 'HTTPS enforcement not required in development');
    }

    // Check for security headers configuration
    try {
      const securityConfigExists = await this.checkForSecurityConfig();
      if (securityConfigExists) {
        this.addResult('Security Headers', 'pass', 'Security configuration found');
      } else {
        this.addResult('Security Headers', 'warning', 'Security configuration not found');
      }
    } catch (error) {
      this.addResult('Security Headers', 'fail', 'Security configuration validation failed');
    }
  }

  private async validateEnvironmentSetup(): Promise<void> {
    console.log('🌍 Validating environment setup...');

    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    
    if (majorVersion >= 20) {
      this.addResult('Node.js Version', 'pass', `Node.js ${nodeVersion} (compatible)`);
    } else if (majorVersion >= 18) {
      this.addResult('Node.js Version', 'warning', `Node.js ${nodeVersion} (minimum supported)`);
    } else {
      this.addResult('Node.js Version', 'fail', `Node.js ${nodeVersion} (unsupported)`);
    }

    // Check environment variables
    const requiredEnvVars = ['NODE_ENV'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length === 0) {
      this.addResult('Environment Variables', 'pass', 'Required environment variables present');
    } else {
      this.addResult('Environment Variables', 'warning', `Missing: ${missingVars.join(', ')}`);
    }

    // Check file system permissions
    try {
      const tempFile = path.join(process.cwd(), 'temp-permission-test.txt');
      await fs.writeFile(tempFile, 'test');
      await fs.remove(tempFile);
      this.addResult('File Permissions', 'pass', 'File system permissions adequate');
    } catch (error) {
      this.addResult('File Permissions', 'fail', 'File system permission issues detected');
    }
  }

  private async validateDeploymentReadiness(): Promise<void> {
    console.log('🚀 Validating deployment readiness...');

    // Check for required directories
    const requiredDirs = ['src', 'tests', 'docs'];
    const missingDirs = [];

    for (const dir of requiredDirs) {
      const exists = await fs.pathExists(dir);
      if (!exists) {
        missingDirs.push(dir);
      }
    }

    if (missingDirs.length === 0) {
      this.addResult('Directory Structure', 'pass', 'Required directories present');
    } else {
      this.addResult('Directory Structure', 'fail', `Missing directories: ${missingDirs.join(', ')}`);
    }

    // Check for health check implementation
    const healthCheckFiles = await this.findHealthCheckFiles();
    if (healthCheckFiles.length > 0) {
      this.addResult('Health Checks', 'pass', `${healthCheckFiles.length} health check files found`);
    } else {
      this.addResult('Health Checks', 'warning', 'No health check implementation found');
    }

    // Check for deployment configuration
    const deploymentConfigs = ['Dockerfile', 'docker-compose.yml', '.github/workflows'];
    const foundConfigs = [];

    for (const config of deploymentConfigs) {
      const exists = await fs.pathExists(config);
      if (exists) {
        foundConfigs.push(config);
      }
    }

    if (foundConfigs.length > 0) {
      this.addResult('Deployment Configuration', 'pass', `Found: ${foundConfigs.join(', ')}`);
    } else {
      this.addResult('Deployment Configuration', 'warning', 'No deployment configuration found');
    }
  }

  private addResult(category: string, status: 'pass' | 'fail' | 'warning', message: string, details?: string[]): void {
    this.results.push({ category, status, message, details });
  }

  private generateSummaryReport(): void {
    console.log('\n📊 PRODUCTION VALIDATION SUMMARY REPORT');
    console.log('==========================================\n');

    const passes = this.results.filter(r => r.status === 'pass').length;
    const warnings = this.results.filter(r => r.status === 'warning').length;
    const failures = this.results.filter(r => r.status === 'fail').length;
    const total = this.results.length;

    console.log(`Total Checks: ${total}`);
    console.log(`✅ Passed: ${passes}`);
    console.log(`⚠️  Warnings: ${warnings}`);
    console.log(`❌ Failed: ${failures}\n`);

    // Overall recommendation
    if (failures === 0 && warnings <= 2) {
      console.log('🟢 RECOMMENDATION: READY FOR PRODUCTION DEPLOYMENT');
    } else if (failures <= 2 && warnings <= 5) {
      console.log('🟡 RECOMMENDATION: READY FOR STAGING, REQUIRES FIXES FOR PRODUCTION');
    } else {
      console.log('🔴 RECOMMENDATION: NOT READY FOR PRODUCTION DEPLOYMENT');
    }

    console.log('\nDetailed Results:');
    console.log('-----------------');

    this.results.forEach(result => {
      const icon = result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
      console.log(`${icon} ${result.category}: ${result.message}`);
      
      if (result.details && result.details.length > 0) {
        result.details.forEach(detail => {
          console.log(`   • ${detail}`);
        });
      }
    });

    // Save report to file
    this.saveReportToFile();
  }

  private async saveReportToFile(): Promise<void> {
    const reportData = {
      timestamp: new Date().toISOString(),
      summary: {
        total: this.results.length,
        passed: this.results.filter(r => r.status === 'pass').length,
        warnings: this.results.filter(r => r.status === 'warning').length,
        failed: this.results.filter(r => r.status === 'fail').length
      },
      results: this.results
    };

    const reportPath = path.join('docs', 'validation-summary-report.json');
    await fs.ensureDir(path.dirname(reportPath));
    await fs.writeJson(reportPath, reportData, { spaces: 2 });
    
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  }

  private async getSourceFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const subFiles = await this.getSourceFiles(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories that can't be read
    }

    return files;
  }

  private async checkForSecurityConfig(): Promise<boolean> {
    const securityFiles = [
      'src/enterprise/security-manager.ts',
      'src/config/security.ts',
      'config/security.json'
    ];

    for (const file of securityFiles) {
      if (await fs.pathExists(file)) {
        return true;
      }
    }

    return false;
  }

  private async findHealthCheckFiles(): Promise<string[]> {
    const healthCheckFiles: string[] = [];
    const files = await this.getSourceFiles('src');

    for (const file of files) {
      if (file.includes('health') || file.includes('monitoring')) {
        healthCheckFiles.push(file);
      }
    }

    return healthCheckFiles;
  }
}

// Run validation if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new ProductionValidator();
  validator.runAllValidations().catch(console.error);
}

export { ProductionValidator };