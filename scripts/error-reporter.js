#!/usr/bin/env node

/**
 * TypeScript Error Reporter - Enhanced CI/CD Error Reporting
 * Agent 2: CI/CD Specialist Implementation
 */

import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TypeScriptErrorReporter {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
    this.reportDir = path.join(this.projectRoot, 'reports');
    this.timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  }

  async ensureReportDirectory() {
    try {
      await fs.mkdir(this.reportDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create reports directory:', error.message);
    }
  }

  parseTypeScriptErrors(output) {
    const errors = [];
    const lines = output.split('\\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Match TypeScript error pattern: file(line,col): error TSxxxx: message
      const errorMatch = line.match(/^(.+)\\((\\d+),(\\d+)\\):\\s*error\\s+(TS\\d+):\\s*(.+)$/);
      
      if (errorMatch) {
        const [, filePath, lineNum, colNum, errorCode, message] = errorMatch;
        
        errors.push({
          file: filePath,
          line: parseInt(lineNum),
          column: parseInt(colNum),
          code: errorCode,
          message: message.trim(),
          severity: 'error',
          category: this.categorizeError(errorCode),
          context: this.getErrorContext(lines, i)
        });
      }
    }
    
    return errors;
  }

  categorizeError(errorCode) {
    const categories = {
      // Type-related errors
      'TS2322': 'type-assignment',
      'TS2339': 'property-access',
      'TS2304': 'name-resolution',
      'TS2345': 'argument-type',
      'TS2363': 'property-assignment',
      
      // Strict mode errors
      'TS2531': 'null-undefined',
      'TS2532': 'null-undefined', 
      'TS2783': 'this-implicitly-any',
      'TS7006': 'implicit-any',
      'TS7053': 'index-access',
      
      // Function-related
      'TS2554': 'function-args',
      'TS2555': 'function-args',
      'TS2556': 'function-args',
      
      // Import/Export
      'TS2307': 'module-resolution',
      'TS2306': 'module-resolution',
      'TS1259': 'module-resolution',
      
      // Configuration
      'TS6133': 'unused-variable',
      'TS6196': 'unused-parameter',
      'TS2393': 'duplicate-function'
    };
    
    return categories[errorCode] || 'other';
  }

  getErrorContext(lines, errorIndex) {
    const contextLines = [];
    const start = Math.max(0, errorIndex - 2);
    const end = Math.min(lines.length, errorIndex + 3);
    
    for (let i = start; i < end; i++) {
      if (lines[i].trim()) {
        contextLines.push({
          lineNumber: i + 1,
          content: lines[i],
          isErrorLine: i === errorIndex
        });
      }
    }
    
    return contextLines;
  }

  async generateErrorReport() {
    await this.ensureReportDirectory();
    
    console.log('🔍 Generating TypeScript Error Report...');
    
    try {
      // Run TypeScript compiler to capture errors
      const command = 'npx tsc --noEmit --pretty false';
      execSync(command, { 
        cwd: this.projectRoot,
        stdio: 'pipe'
      });
      
      console.log('✅ No TypeScript errors found!');
      return { success: true, errors: [] };
      
    } catch (error) {
      const output = error.stdout?.toString() || error.stderr?.toString() || '';
      const errors = this.parseTypeScriptErrors(output);
      
      const report = {
        timestamp: new Date().toISOString(),
        success: false,
        summary: {
          totalErrors: errors.length,
          categories: this.summarizeByCategory(errors),
          files: this.summarizeByFile(errors)
        },
        errors: errors,
        recommendations: this.generateRecommendations(errors)
      };
      
      // Save detailed JSON report
      const jsonReportPath = path.join(this.reportDir, `typescript-errors-${this.timestamp}.json`);
      await fs.writeFile(jsonReportPath, JSON.stringify(report, null, 2));
      
      // Generate human-readable report
      const htmlReportPath = path.join(this.reportDir, `typescript-errors-${this.timestamp}.html`);
      await this.generateHtmlReport(report, htmlReportPath);
      
      // Generate console output
      this.printConsoleReport(report);
      
      console.log(`\\n📄 Detailed reports saved:`);
      console.log(`   JSON: ${jsonReportPath}`);
      console.log(`   HTML: ${htmlReportPath}`);
      
      return report;
    }
  }

  summarizeByCategory(errors) {
    const categories = {};
    errors.forEach(error => {
      categories[error.category] = (categories[error.category] || 0) + 1;
    });
    return categories;
  }

  summarizeByFile(errors) {
    const files = {};
    errors.forEach(error => {
      files[error.file] = (files[error.file] || 0) + 1;
    });
    return files;
  }

  generateRecommendations(errors) {
    const recommendations = [];
    const categories = this.summarizeByCategory(errors);
    
    if (categories['null-undefined'] > 0) {
      recommendations.push({
        category: 'null-undefined',
        priority: 'high',
        title: 'Null/Undefined Safety',
        description: 'Add null checks and use optional chaining (?.) where appropriate',
        example: 'Use obj?.property instead of obj.property when obj might be null'
      });
    }
    
    if (categories['implicit-any'] > 0) {
      recommendations.push({
        category: 'implicit-any',
        priority: 'high',
        title: 'Add Explicit Types',
        description: 'Replace implicit any types with explicit type annotations',
        example: 'function example(param: string): number { ... }'
      });
    }
    
    if (categories['unused-variable'] > 0) {
      recommendations.push({
        category: 'unused-variable',
        priority: 'medium',
        title: 'Remove Unused Code',
        description: 'Remove unused variables and parameters or prefix with underscore',
        example: 'Use _unusedParam for intentionally unused parameters'
      });
    }
    
    if (categories['module-resolution'] > 0) {
      recommendations.push({
        category: 'module-resolution',
        priority: 'high',
        title: 'Fix Import Paths',
        description: 'Check import paths and ensure modules exist',
        example: 'Verify file paths and use correct relative/absolute imports'
      });
    }
    
    return recommendations;
  }

  printConsoleReport(report) {
    console.log('\\n❌ TypeScript Error Report:');
    console.log(`   Total Errors: ${report.summary.totalErrors}`);
    console.log(`   Timestamp: ${report.timestamp}`);
    
    console.log('\\n📊 Errors by Category:');
    Object.entries(report.summary.categories).forEach(([category, count]) => {
      console.log(`   ${category}: ${count}`);
    });
    
    console.log('\\n📁 Errors by File:');
    Object.entries(report.summary.files)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .forEach(([file, count]) => {
        console.log(`   ${file}: ${count}`);
      });
    
    console.log('\\n🔧 Top Recommendations:');
    report.recommendations
      .filter(rec => rec.priority === 'high')
      .slice(0, 3)
      .forEach(rec => {
        console.log(`   • ${rec.title}: ${rec.description}`);
      });
  }

  async generateHtmlReport(report, outputPath) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>TypeScript Error Report - ${report.timestamp}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .error { border-left: 4px solid #e74c3c; padding: 10px; margin: 10px 0; background: #fdf2f2; }
        .category { display: inline-block; background: #3498db; color: white; padding: 2px 8px; border-radius: 3px; font-size: 12px; }
        .file-path { font-family: monospace; color: #2c3e50; }
        .error-code { font-weight: bold; color: #e74c3c; }
        .recommendations { background: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .high-priority { border-left: 4px solid #e74c3c; }
        .medium-priority { border-left: 4px solid #f39c12; }
        .low-priority { border-left: 4px solid #27ae60; }
    </style>
</head>
<body>
    <h1>TypeScript Error Report</h1>
    
    <div class="summary">
        <h2>Summary</h2>
        <p><strong>Total Errors:</strong> ${report.summary.totalErrors}</p>
        <p><strong>Generated:</strong> ${report.timestamp}</p>
        
        <h3>Errors by Category</h3>
        ${Object.entries(report.summary.categories).map(([cat, count]) => 
          `<span class="category">${cat}: ${count}</span>`
        ).join(' ')}
    </div>
    
    <div class="recommendations">
        <h2>🔧 Recommendations</h2>
        ${report.recommendations.map(rec => `
          <div class="${rec.priority}-priority" style="margin: 10px 0; padding: 10px;">
            <h4>${rec.title}</h4>
            <p>${rec.description}</p>
            <code>${rec.example}</code>
          </div>
        `).join('')}
    </div>
    
    <h2>Detailed Errors</h2>
    ${report.errors.map(error => `
      <div class="error">
        <div class="file-path">${error.file}:${error.line}:${error.column}</div>
        <div class="error-code">${error.code}</div>
        <div>${error.message}</div>
        <span class="category">${error.category}</span>
      </div>
    `).join('')}
</body>
</html>`;
    
    await fs.writeFile(outputPath, html);
  }
}

// Main execution
async function main() {
  const reporter = new TypeScriptErrorReporter();
  
  console.log('📋 TypeScript Error Reporter - Agent 2: CI/CD Specialist');
  
  const report = await reporter.generateErrorReport();
  
  // Exit with appropriate code
  process.exit(report.success ? 0 : 1);
}

// Handle CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { TypeScriptErrorReporter };