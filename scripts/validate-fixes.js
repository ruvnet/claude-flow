#!/usr/bin/env node

/**
 * Fix Validation Script - Phase 1 Integration Testing
 * Validates specific categories of fixes as they are completed
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI color codes
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m'
};

class FixValidator {
    constructor() {
        this.testResults = {
            infrastructure: { status: 'pending', tests: [], errors: [] },
            terminal: { status: 'pending', tests: [], errors: [] },
            cli: { status: 'pending', tests: [], errors: [] },
            validation: { status: 'pending', tests: [], errors: [] },
            patterns: { status: 'pending', tests: [], errors: [] }
        };
    }

    log(message, color = 'reset') {
        console.log(`${colors[color]}${message}${colors.reset}`);
    }

    /**
     * Validate Jest mocking infrastructure fixes
     */
    async validateInfrastructureFixes() {
        this.log('\n🔧 Validating Infrastructure Fixes (Jest Mocking)', 'blue');
        
        try {
            // Test the specific file that was failing
            const testCommand = 'npm test -- --testPathPattern=test-utils --verbose';
            const result = execSync(testCommand, { encoding: 'utf8', stdio: 'pipe' });
            
            this.testResults.infrastructure.status = 'passed';
            this.testResults.infrastructure.tests.push('test-utils validation');
            this.log('✅ Test utilities mocking infrastructure: FIXED', 'green');
            
        } catch (error) {
            this.testResults.infrastructure.status = 'failed';
            this.testResults.infrastructure.errors.push(error.message);
            this.log('❌ Test utilities still failing', 'red');
            return false;
        }
        
        return true;
    }

    /**
     * Validate Terminal Manager async mocking fixes
     */
    async validateTerminalFixes() {
        this.log('\n🖥️  Validating Terminal Manager Fixes', 'blue');
        
        try {
            // Test Terminal Manager specifically
            const testCommand = 'npm test -- --testPathPattern=terminal-manager --verbose';
            const result = execSync(testCommand, { encoding: 'utf8', stdio: 'pipe' });
            
            this.testResults.terminal.status = 'passed';
            this.testResults.terminal.tests.push('terminal-manager async mocking');
            this.log('✅ Terminal Manager async mocking: FIXED', 'green');
            
        } catch (error) {
            this.testResults.terminal.status = 'failed';
            this.testResults.terminal.errors.push(error.message);
            this.log('❌ Terminal Manager tests still failing', 'red');
            return false;
        }
        
        return true;
    }

    /**
     * Validate CLI assertion syntax fixes
     */
    async validateCliFixes() {
        this.log('\n⌨️  Validating CLI Assertion Fixes', 'blue');
        
        const problematicFiles = [
            'tests/unit/incremental-updates.test.ts',
            'tests/unit/coordination/coordination.test.ts',
            'tests/unit/example.test.ts'
        ];
        
        try {
            // Test TypeScript compilation first
            const tscCommand = 'npx tsc --noEmit --project tsconfig.json';
            execSync(tscCommand, { encoding: 'utf8', stdio: 'pipe' });
            
            this.log('✅ TypeScript compilation: PASSED', 'green');
            
            // Test the specific files that had syntax errors
            for (const file of problematicFiles) {
                try {
                    const testCommand = `npm test -- --testPathPattern=${path.basename(file, '.test.ts')} --verbose`;
                    execSync(testCommand, { encoding: 'utf8', stdio: 'pipe' });
                    
                    this.testResults.cli.tests.push(file);
                    this.log(`✅ ${file}: FIXED`, 'green');
                } catch (fileError) {
                    this.testResults.cli.errors.push(`${file}: ${fileError.message}`);
                    this.log(`❌ ${file}: Still failing`, 'red');
                }
            }
            
            if (this.testResults.cli.errors.length === 0) {
                this.testResults.cli.status = 'passed';
                return true;
            }
            
        } catch (error) {
            this.testResults.cli.status = 'failed';
            this.testResults.cli.errors.push(error.message);
            this.log('❌ CLI assertion fixes incomplete', 'red');
            return false;
        }
        
        return false;
    }

    /**
     * Validate CI/CD and E2E test fixes
     */
    async validateValidationFixes() {
        this.log('\n🚀 Validating CI/CD & E2E Fixes', 'blue');
        
        try {
            // Test E2E backward compatibility specifically
            const testCommand = 'npm test -- --testPathPattern=backward-compatibility --verbose';
            const result = execSync(testCommand, { encoding: 'utf8', stdio: 'pipe' });
            
            this.testResults.validation.status = 'passed';
            this.testResults.validation.tests.push('backward-compatibility e2e');
            this.log('✅ E2E backward compatibility: FIXED', 'green');
            
        } catch (error) {
            this.testResults.validation.status = 'failed';
            this.testResults.validation.errors.push(error.message);
            this.log('❌ E2E tests still failing', 'red');
            return false;
        }
        
        return true;
    }

    /**
     * Validate mock pattern architecture fixes
     */
    async validatePatternFixes() {
        this.log('\n🏗️  Validating Mock Pattern Architecture', 'blue');
        
        try {
            // Run all tests to ensure mock patterns work across the board
            const testCommand = 'npm test -- --testPathPattern="mock|Mock" --verbose';
            const result = execSync(testCommand, { encoding: 'utf8', stdio: 'pipe' });
            
            this.testResults.patterns.status = 'passed';
            this.testResults.patterns.tests.push('mock patterns validation');
            this.log('✅ Mock pattern architecture: ROBUST', 'green');
            
        } catch (error) {
            this.testResults.patterns.status = 'failed';
            this.testResults.patterns.errors.push(error.message);
            this.log('❌ Mock patterns need refinement', 'red');
            return false;
        }
        
        return true;
    }

    /**
     * Run comprehensive integration validation
     */
    async runCompleteIntegration() {
        this.log('\n🎯 Running Complete Integration Validation', 'cyan');
        
        try {
            // Full test suite run
            const testCommand = 'npm test';
            const result = execSync(testCommand, { encoding: 'utf8', stdio: 'pipe' });
            
            // Parse results
            const lines = result.split('\n');
            const summaryLine = lines.find(line => line.includes('Test Suites:'));
            
            if (summaryLine && !summaryLine.includes('failed')) {
                this.log('🎉 COMPLETE INTEGRATION: SUCCESS', 'green');
                return true;
            } else {
                this.log('❌ Integration validation: Some tests still failing', 'red');
                return false;
            }
            
        } catch (error) {
            this.log('❌ Complete integration: FAILED', 'red');
            console.error(error.message);
            return false;
        }
    }

    /**
     * Generate comprehensive validation report
     */
    generateReport() {
        this.log('\n📊 PHASE 1 INTEGRATION VALIDATION REPORT', 'cyan');
        this.log('=' .repeat(60), 'cyan');
        
        const categories = Object.keys(this.testResults);
        let allPassed = true;
        
        categories.forEach(category => {
            const result = this.testResults[category];
            const status = result.status === 'passed' ? '✅' : 
                          result.status === 'failed' ? '❌' : '⏳';
            
            this.log(`\n${status} ${category.toUpperCase()}:`, 
                    result.status === 'passed' ? 'green' : 
                    result.status === 'failed' ? 'red' : 'yellow');
            
            if (result.tests.length > 0) {
                result.tests.forEach(test => {
                    this.log(`  ✓ ${test}`, 'green');
                });
            }
            
            if (result.errors.length > 0) {
                result.errors.forEach(error => {
                    this.log(`  ✗ ${error.substring(0, 100)}...`, 'red');
                });
                allPassed = false;
            }
        });
        
        this.log('\n' + '=' .repeat(60), 'cyan');
        
        if (allPassed) {
            this.log('🚀 PHASE 2 DEPLOYMENT: APPROVED', 'green');
        } else {
            this.log('⚠️  PHASE 2 DEPLOYMENT: BLOCKED - Fix remaining issues', 'yellow');
        }
        
        return allPassed;
    }

    /**
     * Main validation orchestration
     */
    async validate(category = 'all') {
        this.log('🎯 Phase 1 Fix Validation Starting...', 'cyan');
        this.log(`Timestamp: ${new Date().toISOString()}`, 'blue');
        
        const validators = {
            infrastructure: () => this.validateInfrastructureFixes(),
            terminal: () => this.validateTerminalFixes(),
            cli: () => this.validateCliFixes(),
            validation: () => this.validateValidationFixes(),
            patterns: () => this.validatePatternFixes()
        };
        
        if (category === 'all') {
            // Run all validations
            for (const [cat, validator] of Object.entries(validators)) {
                try {
                    await validator();
                } catch (error) {
                    this.log(`Error validating ${cat}: ${error.message}`, 'red');
                }
            }
            
            // Run complete integration if all categories pass
            const allPassed = Object.values(this.testResults)
                .every(result => result.status === 'passed');
            
            if (allPassed) {
                await this.runCompleteIntegration();
            }
            
        } else if (validators[category]) {
            await validators[category]();
        } else {
            this.log(`Unknown category: ${category}`, 'red');
            return false;
        }
        
        return this.generateReport();
    }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log('🎯 Starting validation script...');
    const category = process.argv[2] || 'all';
    console.log(`Category: ${category}`);
    const validator = new FixValidator();
    
    validator.validate(category).then(success => {
        console.log(`Validation ${success ? 'succeeded' : 'failed'}`);
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('Validation failed:', error);
        process.exit(1);
    });
}

export default FixValidator;