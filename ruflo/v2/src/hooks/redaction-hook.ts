/**
 * Git Pre-commit Hook for API Key Redaction
 * Prevents sensitive data from being committed
 */

import { KeyRedactor } from '../utils/key-redactor.js';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

export async function validateNoSensitiveData(): Promise<{ safe: boolean; issues: string[] }> {
  const issues: string[] = [];

  try {
    // Get staged files
    const stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf-8' })
      .split('\n')
      .filter(f => f.trim() && !f.includes('.env') && !f.includes('node_modules') && !f.endsWith('.map'));

    // Common documentation placeholder patterns (these are safe)
    const placeholderPatterns = [
      /API_KEY=\(paste/i,
      /API_KEY=\(your/i,
      /API_KEY=\.\.\./i,
      /API_KEY="\.\.\."/i,
      /API_KEY="\(paste/i,
      /API_KEY="\(your/i,
      /API_KEY=sk-ant-\.\.\./i,       // Truncated example keys
      /API_KEY=sk-or-v1-\.\.\./i,     // Truncated example keys
      /API_KEY="sk-ant-\.\.\."/i,     // Quoted truncated keys
      /API_KEY="sk-or-v1-\.\.\."/i,   // Quoted truncated keys
      /API_KEY=sk-ant-xxxxx/i,        // xxxxx format examples
      /API_KEY=sk-or-v1-xxxxx/i,      // xxxxx format examples
      /TOKEN=\(paste/i,
      /TOKEN=\(your/i,
      /SECRET=\(paste/i,
      /SECRET=\(your/i,
    ];

    // Check each staged file
    for (const file of stagedFiles) {
      try {
        // Skip documentation files with obvious placeholders
        if (file.startsWith('docs/') || file.includes('/docs/')) {
          const content = readFileSync(file, 'utf-8');
          // Check if file only contains placeholder patterns
          const hasOnlyPlaceholders = placeholderPatterns.some(pattern => pattern.test(content));
          if (hasOnlyPlaceholders) {
            continue; // Skip - these are documentation examples
          }
        }

        const content = readFileSync(file, 'utf-8');

        // Check for placeholder patterns in the content
        const hasPlaceholders = placeholderPatterns.some(pattern => pattern.test(content));
        if (hasPlaceholders && (file.includes('example') || file.includes('template') || file.includes('/docs/'))) {
          continue; // Skip - these are examples/templates with placeholders
        }

        const validation = KeyRedactor.validate(content);

        if (!validation.safe) {
          // Double-check: if warnings are only about placeholder patterns, skip
          const warningsText = validation.warnings.join(' ');
          if (hasPlaceholders && !warningsText.includes('sk-ant-a') && !warningsText.includes('sk-or-v')) {
            continue; // Likely a false positive from documentation
          }
          issues.push(`⚠️  ${file}: ${validation.warnings.join(', ')}`);
        }
      } catch (error) {
        // File might be deleted or binary
        continue;
      }
    }

    return {
      safe: issues.length === 0,
      issues,
    };
  } catch (error) {
    console.error('Error validating sensitive data:', error);
    return {
      safe: false,
      issues: ['Failed to validate files'],
    };
  }
}

export async function runRedactionCheck(): Promise<number> {
  console.log('🔒 Running API key redaction check...\n');

  const result = await validateNoSensitiveData();

  if (!result.safe) {
    console.error('❌ COMMIT BLOCKED - Sensitive data detected:\n');
    result.issues.forEach(issue => console.error(issue));
    console.error('\n⚠️  Please remove sensitive data before committing.');
    console.error('💡 Tip: Use environment variables instead of hardcoding keys.\n');
    return 1;
  }

  console.log('✅ No sensitive data detected - safe to commit\n');
  return 0;
}

// CLI execution (ES module compatible)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runRedactionCheck()
    .then(code => process.exit(code))
    .catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
}
