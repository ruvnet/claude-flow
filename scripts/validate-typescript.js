#!/usr/bin/env node

/**
 * TypeScript Validation Script
 * Prevents commits with TypeScript errors
 */

import { execSync } from 'child_process';
import chalk from 'chalk';

function runCommand(command, description) {
    console.log(chalk.blue(`🔍 ${description}...`));
    try {
        execSync(command, { stdio: 'inherit' });
        console.log(chalk.green(`✅ ${description} passed!`));
        return true;
    } catch (error) {
        console.log(chalk.red(`❌ ${description} failed!`));
        return false;
    }
}

function main() {
    console.log(chalk.cyan('🚀 TypeScript Validation Suite'));
    console.log(chalk.gray('Ensuring code quality before commit...\n'));
    
    let allPassed = true;
    
    // Run TypeScript type checking
    if (!runCommand('npm run typecheck', 'TypeScript type checking')) {
        allPassed = false;
        console.log(chalk.yellow('💡 Run "npm run typecheck" to see detailed TypeScript errors.'));
    }
    
    // Run ESLint
    if (!runCommand('npm run lint', 'ESLint validation')) {
        allPassed = false;
        console.log(chalk.yellow('💡 Run "npm run lint" to see detailed linting errors.'));
    }
    
    // Run circular dependency check
    if (!runCommand('npm run check-deps', 'Circular dependency check')) {
        allPassed = false;
        console.log(chalk.yellow('💡 Run "npm run check-deps" to see circular dependencies.'));
    }
    
    console.log('\n' + '='.repeat(50));
    
    if (allPassed) {
        console.log(chalk.green('🎉 All validations passed! Your code is ready to commit.'));
        process.exit(0);
    } else {
        console.log(chalk.red('🚫 Validation failed! Please fix the errors above before committing.'));
        console.log(chalk.yellow('📝 Tip: Run "npm run verify" to check all validations at once.'));
        process.exit(1);
    }
}

main();