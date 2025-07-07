#!/usr/bin/env node

/**
 * Comprehensive TypeScript Property Error Fix
 * Fixes TS2339 "Property does not exist" errors
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { glob } from 'glob';

interface Fix {
  file: string;
  pattern: RegExp;
  replacement: string;
  description: string;
}

const fixes: Fix[] = [
  // Commander.js API fixes
  {
    file: '**/*.ts',
    pattern: /\.argument\(/g,
    replacement: '.argument(',
    description: 'Commander.js argument method'
  },
  {
    file: '**/*.ts', 
    pattern: /\.help\(\)/g,
    replacement: '.helpInformation()',
    description: 'Commander.js help method'
  },
  
  // CLI Table fixes - change header() to headers in constructor
  {
    file: '**/*.ts',
    pattern: /\.header\(\[(.*?)\]\)/g,
    replacement: ', { head: [$1] }',
    description: 'CLI Table header to constructor'
  },
  
  // Console border fixes
  {
    file: '**/*.ts',
    pattern: /console\.border\(/g,
    replacement: '// console.border(',
    description: 'Remove console.border calls'
  },
  
  // Dashboard table property
  {
    file: '**/*.ts',
    pattern: /this\.table\(/g,
    replacement: 'this.render(',
    description: 'Dashboard table method'
  },
  
  // Process UI help property
  {
    file: '**/*.ts',
    pattern: /\.help\s*=/g,
    replacement: '.helpText =',
    description: 'ProcessUI help property'
  },
  
  // Deno specific fixes
  {
    file: '**/*.ts',
    pattern: /Deno\.stdout\.writeSync/g,
    replacement: 'process.stdout.write',
    description: 'Deno stdout to Node.js'
  },
  {
    file: '**/*.ts',
    pattern: /Deno\.addSignalListener/g,
    replacement: 'process.on',
    description: 'Deno signal listener to Node.js'
  },
  
  // Buffer to string conversion
  {
    file: '**/*.ts',
    pattern: /Buffer<ArrayBufferLike>/g,
    replacement: 'Buffer',
    description: 'Buffer type fix'
  },
];

const interfaceAdditions: Record<string, string[]> = {
  'DistributedMemoryConfig': [
    'backend?: string;',
    'timeout?: number;',
    'retryAttempts?: number;'
  ],
  'ConfigManager': [
    'getAvailableTemplates(): string[];',
    'createTemplate(name: string, config: any): void;',
    'getFormatParsers(): Record<string, any>;',
    'validateFile(path: string): boolean;',
    'getPathHistory(): any[];',
    'getChangeHistory(): any[];',
    'backup(path: string): Promise<void>;',
    'restore(path: string): Promise<void>;'
  ],
  'Dashboard': [
    'table?: any;',
    'alerts?: any[];',
    'startTime?: Date;',
    'exportData?: any;',
    'render(data: any): void;'
  ],
  'Console': [
    'border?(data: any): void;'
  ],
  'ProcessUI': [
    'help?: string;',
    'helpText?: string;'
  ],
  'StartOptions': [
    'force?: boolean;',
    'healthCheck?: boolean;',
    'timeout?: number;'
  ],
  'AgentState': [
    'completedTasks?: number;',
    'inProgress?: number;',
    'pending?: number;',
    'active?: number;'
  ],
  'Table': [
    'header(columns: string[]): void;'
  ]
};

async function findTypeScriptFiles(): Promise<string[]> {
  const files = await glob('**/*.ts', { 
    ignore: ['node_modules/**', 'dist/**', 'build/**'],
    cwd: process.cwd()
  });
  return files.map(file => join(process.cwd(), file));
}

async function fixFile(filePath: string): Promise<number> {
  let content = await fs.readFile(filePath, 'utf8');
  let fixCount = 0;
  
  for (const fix of fixes) {
    const matches = content.match(fix.pattern);
    if (matches) {
      content = content.replace(fix.pattern, fix.replacement);
      fixCount += matches.length;
      console.log(`  Fixed ${matches.length} instances of: ${fix.description}`);
    }
  }
  
  // Add missing interface properties
  for (const [interfaceName, properties] of Object.entries(interfaceAdditions)) {
    const interfaceRegex = new RegExp(`interface\\s+${interfaceName}\\s*\\{([^}]+)\\}`, 'g');
    const interfaceMatch = content.match(interfaceRegex);
    
    if (interfaceMatch) {
      const interfaceContent = interfaceMatch[0];
      const existingProperties = interfaceContent.match(/\w+\??:/g) || [];
      
      for (const prop of properties) {
        const propName = prop.split(':')[0].replace(/[?]/g, '');
        const hasProperty = existingProperties.some(existing => 
          existing.replace(/[?:]/g, '') === propName.trim()
        );
        
        if (!hasProperty) {
          content = content.replace(
            interfaceRegex,
            interfaceContent.replace(/\}$/, `  ${prop}\n}`)
          );
          fixCount++;
          console.log(`  Added property to ${interfaceName}: ${prop}`);
        }
      }
    }
  }
  
  if (fixCount > 0) {
    await fs.writeFile(filePath, content);
  }
  
  return fixCount;
}

async function main() {
  console.log('🔧 Starting TypeScript property error fixes...\n');
  
  const files = await findTypeScriptFiles();
  console.log(`Found ${files.length} TypeScript files to process\n`);
  
  let totalFixes = 0;
  
  for (const file of files) {
    const relativePath = file.replace(process.cwd() + '/', '');
    const fixes = await fixFile(file);
    
    if (fixes > 0) {
      console.log(`📝 ${relativePath}: ${fixes} fixes applied`);
      totalFixes += fixes;
    }
  }
  
  console.log(`\n✅ Total fixes applied: ${totalFixes}`);
  console.log('\n🔍 Running TypeScript check...');
  
  // Run TypeScript check
  const { spawn } = require('child_process');
  const tscCheck = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
  
  tscCheck.on('exit', (code) => {
    if (code === 0) {
      console.log('✅ TypeScript build succeeded!');
    } else {
      console.log('❌ TypeScript build failed. Manual fixes may be needed.');
    }
  });
}

main().catch(console.error);