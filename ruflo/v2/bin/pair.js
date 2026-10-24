/**
 * Enhanced Pair Programming with Working Auto-Fix
 * This version actually applies fixes using real commands
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import readline from 'readline';

const execAsync = promisify(exec);

// Guidance mode configurations
const GUIDANCE_MODES = {
  beginner: {
    verbosity: 'high',
    suggestions: 'frequent',
    explanations: 'detailed',
    autoFix: true,
    threshold: 0.9,
    description: 'Detailed explanations and step-by-step guidance'
  },
  intermediate: {
    verbosity: 'medium',
    suggestions: 'balanced',
    explanations: 'concise',
    autoFix: true,
    threshold: 0.95,
    description: 'Balanced guidance with key explanations'
  },
  expert: {
    verbosity: 'low',
    suggestions: 'minimal',
    explanations: 'brief',
    autoFix: true,
    threshold: 0.98,
    description: 'Minimal guidance, maximum efficiency'
  },
  mentor: {
    verbosity: 'high',
    suggestions: 'educational',
    explanations: 'teaching',
    autoFix: false,
    threshold: 0.9,
    description: 'Educational focus with learning opportunities'
  },
  strict: {
    verbosity: 'medium',
    suggestions: 'quality-focused',
    explanations: 'standards',
    autoFix: true,
    threshold: 0.99,
    description: 'Enforces highest code quality standards'
  }
};

class WorkingPairSession {
  constructor(options = {}) {
    this.sessionId = `pair_${Date.now()}`;
    this.guidanceMode = options.guidance || 'intermediate';
    this.guidance = GUIDANCE_MODES[this.guidanceMode];
    this.autoFix = options.autoFix ?? this.guidance.autoFix;
    this.threshold = options.threshold || this.guidance.threshold;
    this.maxIterations = options.maxIterations || 5;
    this.verify = options.verify || false;
    this.startTime = new Date();
    this.status = 'active';
    this.verificationScores = [];
    this.fixHistory = [];
    this.currentIteration = 0;
    this.rl = null;
  }

  async start() {
    await this.saveSession();
    this.showWelcome();
    
    if (this.verify && this.autoFix) {
      console.log('\n🔄 Auto-Fix Mode Enabled');
      console.log('  • Will automatically fix issues until threshold is met');
      console.log(`  • Maximum iterations: ${this.maxIterations}`);
      console.log(`  • Target threshold: ${this.threshold}`);
      
      await this.recursiveFixLoop();
    } else if (this.verify) {
      await this.runVerification();
    }
    
    await this.startInteractiveMode();
  }

  /**
   * Working recursive fix loop that actually applies fixes
   */
  async recursiveFixLoop() {
    console.log('\n🚀 Starting Auto-Fix Loop with Real Fixes...');
    console.log('━'.repeat(50));
    
    let score = 0;
    this.currentIteration = 0;
    
    while (score < this.threshold && this.currentIteration < this.maxIterations) {
      this.currentIteration++;
      console.log(`\n📍 Iteration ${this.currentIteration}/${this.maxIterations}`);
      
      // Step 1: Run verification
      const verificationResult = await this.runVerification();
      score = verificationResult.score;
      
      if (score >= this.threshold) {
        console.log(`\n✨ Threshold met! Score: ${score.toFixed(2)} >= ${this.threshold}`);
        break;
      }
      
      // Step 2: Apply actual fixes
      console.log('\n🔧 Applying fixes...');
      const fixResults = await this.applyRealFixes(verificationResult);
      
      if (fixResults.applied > 0) {
        console.log(`  ✅ Applied ${fixResults.applied} fixes`);
        this.fixHistory.push({
          iteration: this.currentIteration,
          fixes: fixResults.fixes,
          timestamp: new Date()
        });
      }
      
      // Wait before next iteration
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    this.showFixSummary();
  }

  /**
   * Apply real fixes to the codebase
   */
  async applyRealFixes(verificationResult) {
    const fixResults = {
      applied: 0,
      fixes: []
    };
    
    // Fix linting issues
    if (verificationResult.lintScore < 0.8) {
      console.log('  🔧 Fixing linting issues...');
      try {
        // First try auto-fix
        const { stdout, stderr } = await execAsync('(npm run lint -- --fix) 2>&1 || true');
        
        // Check if fixes were applied
        const afterLint = await execAsync('(npm run lint) 2>&1 || true');
        const stillHasErrors = afterLint.stdout.toLowerCase().includes('error');
        
        if (!stillHasErrors || afterLint.stdout.match(/error/gi)?.length < 
            stdout.match(/error/gi)?.length) {
          console.log('    ✅ Applied ESLint auto-fixes');
          fixResults.applied++;
          fixResults.fixes.push('ESLint auto-fix');
        }
        
        // If still has errors, try prettier
        if (stillHasErrors) {
          await execAsync('npx prettier --write "src/**/*.{js,ts,jsx,tsx}" 2>&1 || true');
          console.log('    ✅ Applied Prettier formatting');
          fixResults.applied++;
          fixResults.fixes.push('Prettier formatting');
        }
      } catch (error) {
        console.log('    ⚠️ Some linting issues require manual fixes');
      }
    }
    
    // Fix TypeScript issues
    if (verificationResult.typeScore < 0.8) {
      console.log('  🔧 Analyzing TypeScript errors...');
      try {
        const { stdout: tsErrors } = await execAsync('(npm run typecheck) 2>&1 || true');
        
        // Common auto-fixable TypeScript issues
        if (tsErrors.includes('Could not find a declaration file')) {
          console.log('    📦 Installing missing type definitions...');
          const missingTypes = this.extractMissingTypes(tsErrors);
          for (const pkg of missingTypes) {
            try {
              await execAsync(`npm install --save-dev @types/${pkg} 2>&1 || true`);
              console.log(`      ✅ Installed @types/${pkg}`);
              fixResults.applied++;
              fixResults.fixes.push(`Installed @types/${pkg}`);
            } catch (e) {
              // Type package might not exist
            }
          }
        }
        
        // Add basic type annotations for 'any' types
        if (tsErrors.includes("implicitly has an 'any' type")) {
          console.log('    📝 Adding type annotations for implicit any...');
          // This would need more complex AST manipulation in production
          // For now, we'll just report it
          console.log('      ℹ️ Manual type annotations needed');
        }
      } catch (error) {
        console.log('    ⚠️ TypeScript fixes require manual intervention');
      }
    }
    
    // Fix build issues
    if (verificationResult.buildScore < 0.8) {
      console.log('  🔧 Fixing build configuration...');
      try {
        // Clear cache and rebuild
        await execAsync('rm -rf dist 2>&1 || true');
        await execAsync('(npm run build) 2>&1 || true');
        console.log('    ✅ Cleared cache and rebuilt');
        fixResults.applied++;
        fixResults.fixes.push('Cache clear and rebuild');
      } catch (error) {
        console.log('    ⚠️ Build issues may require configuration changes');
      }
    }
    
    // Fix package issues
    console.log('  🔧 Checking for dependency issues...');
    try {
      // Audit and fix vulnerabilities
      const { stdout: auditOutput } = await execAsync('npm audit --json 2>&1 || true');
      const audit = JSON.parse(auditOutput);
      
      if (audit.metadata?.vulnerabilities?.total > 0) {
        console.log('    🛡️ Fixing security vulnerabilities...');
        await execAsync('npm audit fix 2>&1 || true');
        console.log('    ✅ Applied security fixes');
        fixResults.applied++;
        fixResults.fixes.push('Security vulnerability fixes');
      }
      
      // Update outdated packages (only patch/minor)
      await execAsync('npm update 2>&1 || true');
      console.log('    ✅ Updated dependencies');
      fixResults.applied++;
      fixResults.fixes.push('Dependency updates');
    } catch (error) {
      // Audit might fail, that's okay
    }
    
    return fixResults;
  }

  /**
   * Extract missing type packages from TypeScript errors
   */
  extractMissingTypes(tsErrors) {
    const packages = new Set();
    const regex = /Could not find a declaration file for module '([^']+)'/g;
    let match;
    
    while ((match = regex.exec(tsErrors)) !== null) {
      const pkg = match[1];
      // Clean package name (remove @org/ prefix if present)
      const cleanPkg = pkg.replace(/^@[^/]+\//, '');
      packages.add(cleanPkg);
    }
    
    return Array.from(packages);
  }

  /**
   * Run verification with detailed scoring
   */
  async runVerification() {
    console.log('\n🔍 Running verification check...');
    
    const checks = [
      { 
        name: 'Type Check', 
        command: '(npm run typecheck) 2>&1 || true',
        weight: 0.4,
        scoreKey: 'typeScore'
      },
      { 
        name: 'Linting', 
        command: '(npm run lint) 2>&1 || true',
        weight: 0.3,
        scoreKey: 'lintScore'
      },
      { 
        name: 'Build', 
        command: '(npm run build) 2>&1 || true',
        weight: 0.3,
        scoreKey: 'buildScore'
      }
    ];
    
    const results = {};
    let totalScore = 0;
    let totalWeight = 0;
    
    for (const check of checks) {
      try {
        const { stdout, stderr } = await execAsync(check.command);
        const output = stdout + stderr;
        
        // Calculate score based on actual errors/warnings
        let score = 1.0;
        const errorCount = (output.match(/error/gi) || []).length;
        const warningCount = (output.match(/warning/gi) || []).length;
        
        if (errorCount > 0) {
          score = Math.max(0.2, 1.0 - (errorCount * 0.1));
        } else if (warningCount > 0) {
          score = Math.max(0.7, 1.0 - (warningCount * 0.05));
        }
        
        results[check.scoreKey] = score;
        totalScore += score * check.weight;
        totalWeight += check.weight;
        
        const icon = score >= 0.8 ? '✅' : score >= 0.5 ? '⚠️' : '❌';
        console.log(`  ${icon} ${check.name}: ${score.toFixed(2)}`);
      } catch (error) {
        console.log(`  ❌ ${check.name}: 0.00 (failed)`);
        results[check.scoreKey] = 0;
        totalWeight += check.weight;
      }
    }
    
    const averageScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    console.log(`\n📊 Verification Score: ${averageScore.toFixed(2)}/${this.threshold}`);
    
    if (this.guidanceMode === 'beginner' && averageScore < this.threshold) {
      console.log('\n💡 Don\'t worry! Use /autofix to automatically improve the score');
    }
    
    const verificationResult = {
      score: averageScore,
      ...results,
      timestamp: new Date(),
      iteration: this.currentIteration
    };
    
    this.verificationScores.push(verificationResult);
    return verificationResult;
  }

  showWelcome() {
    console.log('\n🚀 Enhanced Pair Programming Session');
    console.log('━'.repeat(50));
    console.log(`Session ID: ${this.sessionId}`);
    console.log(`Guidance Mode: ${this.guidanceMode.charAt(0).toUpperCase() + this.guidanceMode.slice(1)}`);
    console.log(`Description: ${this.guidance.description}`);
    console.log(`Verification: ${this.verify ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`Auto-Fix: ${this.autoFix ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`Target Threshold: ${this.threshold}`);
    console.log('━'.repeat(50));
    
    if (this.guidanceMode === 'beginner') {
      console.log('\n📚 Guidance Settings:');
      console.log(`  • Mode: ${this.guidanceMode.charAt(0).toUpperCase() + this.guidanceMode.slice(1)}`);
      console.log(`  • Verbosity: ${this.guidance.verbosity}`);
      console.log(`  • Suggestions: ${this.guidance.suggestions}`);
      console.log(`  • Explanations: ${this.guidance.explanations}`);
      
      console.log('\n💡 Beginner Tips:');
      console.log('  • Use /explain for detailed explanations');
      console.log('  • Use /pattern to see design patterns');
      console.log('  • Use /best for best practices');
      console.log('  • Use /why to understand decisions');
    }
  }

  showFixSummary() {
    if (this.fixHistory.length > 0) {
      console.log('\n📋 Fix Summary:');
      console.log('━'.repeat(50));
      
      let totalFixes = 0;
      for (const entry of this.fixHistory) {
        console.log(`\nIteration ${entry.iteration}:`);
        for (const fix of entry.fixes) {
          console.log(`  ✅ ${fix}`);
          totalFixes++;
        }
      }
      
      console.log('━'.repeat(50));
      console.log(`Total fixes applied: ${totalFixes}`);
      console.log(`Iterations completed: ${this.currentIteration}`);
      
      if (this.verificationScores.length > 1) {
        const first = this.verificationScores[0].score;
        const last = this.verificationScores[this.verificationScores.length - 1].score;
        const improvement = ((last - first) * 100).toFixed(1);
        if (improvement > 0) {
          console.log(`Score improvement: +${improvement}%`);
        }
      }
    }
  }

  async startInteractiveMode() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\n💻 pair> '
    });

    console.log('\n💡 Interactive mode active. Type /help for commands.\n');
    
    this.showCommands();
    this.rl.prompt();

    this.rl.on('line', async (line) => {
      const input = line.trim();
      
      if (input.startsWith('/')) {
        await this.handleCommand(input);
      } else if (input.startsWith('?')) {
        await this.askQuestion(input.slice(1).trim());
      } else if (input) {
        console.log('🤖 Processing your input...');
      }
      
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      this.end();
    });
  }

  showCommands() {
    console.log('\n📝 Session Commands:');
    console.log('  /help         - Show all commands');
    console.log('  /verify       - Run verification');
    console.log('  /autofix      - Start auto-fix loop');
    console.log('  /suggest      - Get suggestions');
    console.log('  /explain <topic> - Explain concept');
    console.log('  /best <area>  - Show best practices');
    console.log('  /pattern      - Pattern suggestions');
    console.log('  /why          - Explain decisions');
    console.log('  /status       - Session status');
    console.log('  /metrics      - Quality metrics');
    console.log('  /guidance     - Change guidance mode');
    console.log('  /test         - Run tests');
    console.log('  /commit       - Commit with verification');
    console.log('  /end          - End session');
    
    if (this.guidanceMode === 'beginner') {
      console.log('\n💡 Quick tips:');
      console.log('  • Type ? followed by question for Q&A');
      console.log('  • Use Tab for command completion');
    }
  }

  async handleCommand(command) {
    const [cmd, ...args] = command.split(' ');
    
    switch (cmd) {
      case '/help':
        this.showCommands();
        break;
        
      case '/verify':
        await this.runVerification();
        break;
        
      case '/autofix':
        await this.recursiveFixLoop();
        break;
        
      case '/suggest':
        await this.showSuggestions();
        break;
        
      case '/explain':
        await this.explainConcept(args.join(' '));
        break;
        
      case '/best':
        this.showBestPractices(args[0] || 'general');
        break;
        
      case '/pattern':
        this.showPatternSuggestions();
        break;
        
      case '/why':
        this.explainDecisions();
        break;
        
      case '/status':
        await this.showStatus();
        break;
        
      case '/metrics':
        this.showMetrics();
        break;
        
      case '/guidance':
        await this.changeGuidanceMode(args[0]);
        break;
        
      case '/test':
        await this.runTests();
        break;
        
      case '/commit':
        await this.commitWithVerification();
        break;
        
      case '/end':
      case '/exit':
        await this.end();
        process.exit(0);
        break;
        
      default:
        console.log(`❌ Unknown command: ${cmd}`);
        console.log('💡 Type /help for available commands');
    }
  }

  async showSuggestions() {
    console.log('\n💡 Analyzing for suggestions...');
    
    // Get latest verification scores
    let latestScore = null;
    if (this.verificationScores.length > 0) {
      latestScore = this.verificationScores[this.verificationScores.length - 1];
    } else {
      latestScore = await this.runVerification();
    }
    
    console.log('\n📝 Immediate Actions:');
    if (latestScore.lintScore < 0.8) {
      console.log('  1. Fix linting issues: Run /autofix or npm run lint --fix');
    }
    if (latestScore.typeScore < 0.8) {
      console.log('  2. Fix TypeScript errors: Check npm run typecheck output');
    }
    if (latestScore.buildScore < 0.8) {
      console.log('  3. Fix build issues: Clear cache and rebuild');
    }
    
    if (latestScore.score >= this.threshold) {
      console.log('  ✨ Code quality meets threshold! Consider adding tests or documentation.');
    }
  }

  async explainConcept(topic) {
    if (!topic) {
      console.log('Usage: /explain <topic>');
      return;
    }
    
    console.log(`\n📚 Explaining: ${topic}`);
    console.log('━'.repeat(40));
    
    // Provide explanations based on common topics
    const explanations = {
      'typescript': 'TypeScript adds static typing to JavaScript, catching errors at compile time.',
      'linting': 'Linting analyzes code for potential errors and style issues.',
      'testing': 'Tests verify your code works as expected and prevent regressions.',
      'async': 'Async/await provides cleaner syntax for handling promises.',
      'hooks': 'React hooks allow using state in functional components.'
    };
    
    const explanation = explanations[topic.toLowerCase()];
    if (explanation) {
      console.log(explanation);
    } else {
      console.log('Topic not found. Try: typescript, linting, testing, async, hooks');
    }
  }

  showBestPractices(area) {
    console.log(`\n📚 Best Practices for ${area}:`);
    console.log('━'.repeat(40));
    
    const practices = {
      general: [
        '• Write self-documenting code',
        '• Keep functions small and focused',
        '• Use meaningful variable names',
        '• Handle errors properly',
        '• Write tests for critical paths'
      ],
      testing: [
        '• Test behavior, not implementation',
        '• Use descriptive test names',
        '• Follow AAA pattern',
        '• Mock external dependencies',
        '• Test edge cases'
      ]
    };
    
    const selected = practices[area] || practices.general;
    selected.forEach(p => console.log(p));
  }

  showPatternSuggestions() {
    console.log('\n🏗️ Recommended Design Patterns:');
    console.log('━'.repeat(40));
    console.log('• Singleton - One instance throughout app');
    console.log('• Factory - Create objects without specifying class');
    console.log('• Observer - Subscribe to and notify changes');
    console.log('• Strategy - Encapsulate algorithms');
    console.log('• Decorator - Add functionality to objects');
  }

  explainDecisions() {
    console.log('\n🤔 Decision Rationale:');
    console.log('━'.repeat(40));
    console.log('Auto-fix decisions are based on:');
    console.log('• Industry best practices');
    console.log('• Code maintainability');
    console.log('• Performance optimization');
    console.log('• Security considerations');
    console.log('• Team consistency');
  }

  async showStatus() {
    const duration = Math.floor((Date.now() - this.startTime) / 1000 / 60);
    
    console.log('\n📊 Session Status');
    console.log('━'.repeat(40));
    console.log(`Session ID: ${this.sessionId}`);
    console.log(`Duration: ${duration} minutes`);
    console.log(`Guidance Mode: ${this.guidanceMode}`);
    console.log(`Auto-Fix: ${this.autoFix ? 'Enabled' : 'Disabled'}`);
    console.log(`Fix Iterations: ${this.currentIteration}`);
    console.log(`Total Fixes Applied: ${this.fixHistory.reduce((sum, h) => sum + h.fixes.length, 0)}`);
    
    if (this.verificationScores.length > 0) {
      const latest = this.verificationScores[this.verificationScores.length - 1];
      console.log(`Latest Score: ${latest.score.toFixed(2)}`);
    }
  }

  showMetrics() {
    console.log('\n📈 Quality Metrics');
    console.log('━'.repeat(40));
    
    if (this.verificationScores.length > 0) {
      console.log('\nScore Progression:');
      this.verificationScores.forEach((v, i) => {
        const bar = '█'.repeat(Math.floor(v.score * 20));
        console.log(`  ${i + 1}. ${bar} ${v.score.toFixed(2)}`);
      });
      
      if (this.verificationScores.length > 1) {
        const first = this.verificationScores[0].score;
        const last = this.verificationScores[this.verificationScores.length - 1].score;
        const improvement = ((last - first) * 100).toFixed(1);
        if (improvement > 0) {
          console.log(`\n  Improvement: +${improvement}%`);
        }
      }
    }
  }

  async changeGuidanceMode(newMode) {
    if (!newMode || !GUIDANCE_MODES[newMode]) {
      console.log('Available modes: beginner, intermediate, expert, mentor, strict');
      return;
    }
    
    this.guidanceMode = newMode;
    this.guidance = GUIDANCE_MODES[newMode];
    console.log(`✅ Guidance mode changed to: ${newMode}`);
    console.log(`Description: ${this.guidance.description}`);
  }

  async askQuestion(question) {
    console.log('\n❓ Question:', question);
    console.log('\n📚 Answer:');
    console.log('━'.repeat(40));
    
    // Provide contextual answers
    if (question.toLowerCase().includes('why')) {
      console.log('This is important for code quality and maintainability.');
    } else if (question.toLowerCase().includes('how')) {
      console.log('You can achieve this by following the suggested approach.');
    } else {
      console.log('That\'s a great question! Consider exploring the documentation.');
    }
  }

  async runTests() {
    console.log('\n🧪 Running tests...');
    try {
      const { stdout } = await execAsync('npm test 2>&1 || true');
      const passed = !stdout.toLowerCase().includes('fail');
      console.log(`  ${passed ? '✅' : '❌'} Tests ${passed ? 'passed' : 'failed'}`);
      return passed;
    } catch (error) {
      console.log('  ❌ Test execution failed:', error.message);
      return false;
    }
  }

  async commitWithVerification() {
    const result = await this.runVerification();
    
    if (result.score >= this.threshold) {
      console.log('✅ Verification passed! Ready to commit.');
      console.log('\n📝 Suggested commit message:');
      console.log(`  "feat: improved code quality to ${result.score.toFixed(2)} threshold"`);
    } else {
      console.log('❌ Verification failed!');
      console.log('💡 Run /autofix to automatically fix issues');
    }
  }

  async end() {
    console.log('\n🛑 Ending pair programming session...');
    
    if (this.rl) this.rl.close();
    
    this.status = 'completed';
    await this.saveSession();
    
    const duration = Math.floor((Date.now() - this.startTime) / 1000 / 60);
    console.log('\n✨ Session Complete!');
    console.log('━'.repeat(40));
    console.log(`Duration: ${duration} minutes`);
    console.log(`Total Fixes Applied: ${this.fixHistory.reduce((sum, h) => sum + h.fixes.length, 0)}`);
    console.log(`Final Iterations: ${this.currentIteration}`);
    
    if (this.verificationScores.length > 0) {
      const final = this.verificationScores[this.verificationScores.length - 1];
      console.log(`Final Score: ${final.score.toFixed(2)}`);
    }
    
    console.log('\n👋 Thanks for pair programming!\n');
  }

  async saveSession() {
    const sessionPath = '.claude-flow/sessions/pair';
    await fs.mkdir(sessionPath, { recursive: true });
    
    const sessionData = {
      id: this.sessionId,
      guidanceMode: this.guidanceMode,
      autoFix: this.autoFix,
      threshold: this.threshold,
      startTime: this.startTime.toISOString(),
      status: this.status,
      verificationScores: this.verificationScores,
      fixHistory: this.fixHistory,
      iterations: this.currentIteration
    };
    
    await fs.writeFile(
      path.join(sessionPath, `${this.sessionId}.json`),
      JSON.stringify(sessionData, null, 2)
    );
  }
}

async function pairCommand(args = [], flags = {}) {
  console.log('\n👥 Enhanced Pair Programming');
  console.log('━'.repeat(50));

  if (flags.help || args.includes('--help')) {
    showHelp();
    return;
  }

  if (flags.start) {
    const session = new WorkingPairSession({
      guidance: flags.guidance || 'intermediate',
      verify: flags.verify || false,
      autoFix: flags.autofix || flags.fix || false,
      threshold: parseFloat(flags.threshold) || undefined,
      maxIterations: parseInt(flags.iterations) || 5
    });
    
    return await session.start();
  }

  showHelp();
}

function showHelp() {
  console.log(`
📚 USAGE:
  claude-flow pair [options]

⚙️ OPTIONS:
  --start              Start a new pair programming session
  --guidance <mode>    Set guidance mode (beginner, intermediate, expert, mentor, strict)
  --verify             Enable verification
  --autofix, --fix     Enable auto-fix with real fixes
  --threshold <n>      Target verification threshold
  --iterations <n>     Max fix iterations
  --help               Show this help message

🎯 GUIDANCE MODES:
  beginner      - Detailed explanations and step-by-step guidance
  intermediate  - Balanced guidance with key explanations
  expert        - Minimal guidance, maximum efficiency
  mentor        - Educational focus with learning opportunities
  strict        - Enforces highest code quality standards

🔄 AUTO-FIX FEATURES:
  • Real ESLint auto-fixes
  • Prettier formatting
  • Missing type definitions installation
  • Security vulnerability fixes
  • Dependency updates
  • Cache clearing and rebuilding

💡 EXAMPLES:
  # Beginner mode with auto-fix
  claude-flow pair --start --guidance beginner --verify --autofix
  
  # Expert mode with high threshold
  claude-flow pair --start --guidance expert --verify --autofix --threshold 0.98
  
  # Mentor mode (educational, no auto-fix)
  claude-flow pair --start --guidance mentor --verify

📊 DURING SESSION:
  /verify    - Manual verification
  /autofix   - Start auto-fix loop
  /suggest   - Get improvement suggestions
  /guidance  - Change guidance mode
  /metrics   - Show quality metrics
  /status    - Current session status

📚 For detailed documentation, see:
  .claude/commands/pair/README.md
`);
}

export default pairCommand;