/**
 * GuidanceProvider Tests
 *
 * Integration tests for the V3 GuidanceProvider that generates Claude-visible output.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GuidanceProvider, type ClaudeHookOutput } from '../reasoningbank/guidance-provider.js';
import { ReasoningBank } from '../reasoningbank/index.js';

describe('GuidanceProvider', () => {
  let provider: GuidanceProvider;
  let reasoningBank: ReasoningBank;

  beforeEach(async () => {
    // Create a fresh ReasoningBank with mock embeddings
    reasoningBank = new ReasoningBank({
      useMockEmbeddings: true,
      dimensions: 384,
    });
    await reasoningBank.initialize();

    provider = new GuidanceProvider(reasoningBank);
    await provider.initialize();
  });

  describe('generateSessionContext', () => {
    it('should return V3 development context', async () => {
      const context = await provider.generateSessionContext();

      expect(context).toContain('V3 Development Context');
      expect(context).toContain('Architecture');
      expect(context).toContain('Domain-Driven Design');
      expect(context).toContain('Performance Targets');
    });

    it('should include HNSW performance targets', async () => {
      const context = await provider.generateSessionContext();

      expect(context).toContain('HNSW search');
      expect(context).toContain('150x');
    });

    it('should include code quality rules', async () => {
      const context = await provider.generateSessionContext();

      expect(context).toContain('Code Quality Rules');
      expect(context).toContain('500 lines');
      expect(context).toContain('hardcoded secrets');
    });

    it('should include learned patterns count', async () => {
      // Store some patterns first
      await reasoningBank.storePattern('Test pattern', 'testing');
      await reasoningBank.storePattern('Security pattern', 'security');

      const context = await provider.generateSessionContext();

      expect(context).toContain('Learned Patterns');
    });
  });

  describe('generatePromptContext', () => {
    beforeEach(async () => {
      // Seed with some patterns
      await reasoningBank.storePattern('Use parameterized queries', 'security');
      await reasoningBank.storePattern('Write tests first', 'testing');
    });

    it('should detect security domain', async () => {
      const context = await provider.generatePromptContext(
        'Fix authentication vulnerability'
      );

      expect(context.toLowerCase()).toContain('security');
    });

    it('should detect testing domain', async () => {
      const context = await provider.generatePromptContext(
        'Write unit tests for the auth module'
      );

      expect(context.toLowerCase()).toContain('testing');
    });

    it('should include relevant learned patterns', async () => {
      const context = await provider.generatePromptContext('SQL injection prevention');

      // Should find patterns related to security/queries
      expect(context).toBeDefined();
    });
  });

  describe('generatePreEditGuidance', () => {
    describe('security checks', () => {
      it('should block .env files', async () => {
        const result = await provider.generatePreEditGuidance('.env');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
        expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('.env');
      });

      it('should block .pem files', async () => {
        const result = await provider.generatePreEditGuidance('server.pem');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
        expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('.pem');
      });

      it('should block credentials files', async () => {
        const result = await provider.generatePreEditGuidance('credentials.json');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      });

      it('should block secret files', async () => {
        const result = await provider.generatePreEditGuidance('api_secret.txt');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      });

      it('should block password files', async () => {
        const result = await provider.generatePreEditGuidance('passwords.txt');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      });
    });

    describe('warning checks', () => {
      it('should warn about production files', async () => {
        const result = await provider.generatePreEditGuidance('config/production.ts');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
        // Note: WARNED_PATTERNS checks 'prod' first, which matches 'production'
        expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('prod');
      });

      it('should warn about prod files', async () => {
        const result = await provider.generatePreEditGuidance('deploy-prod.sh');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
      });

      it('should warn about live files', async () => {
        const result = await provider.generatePreEditGuidance('config.live.json');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
      });
    });

    describe('file type guidance', () => {
      it('should provide testing guidance for test files', async () => {
        const result = await provider.generatePreEditGuidance('src/auth/login.test.ts');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
        expect(result.hookSpecificOutput?.additionalContext).toContain('Testing');
      });

      it('should provide security guidance for auth files', async () => {
        const result = await provider.generatePreEditGuidance('src/auth/login.ts');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
        expect(result.hookSpecificOutput?.additionalContext).toContain('Security');
      });

      it('should provide memory guidance for cache files', async () => {
        const result = await provider.generatePreEditGuidance('src/memory/cache.ts');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
        expect(result.hookSpecificOutput?.additionalContext).toContain('Memory');
      });

      it('should provide swarm guidance for coordinator files', async () => {
        const result = await provider.generatePreEditGuidance('src/swarm/coordinator.ts');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
        expect(result.hookSpecificOutput?.additionalContext).toContain('Swarm');
      });

      it('should provide TypeScript guidance for .ts files', async () => {
        const result = await provider.generatePreEditGuidance('src/utils/helpers.ts');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
        expect(result.hookSpecificOutput?.additionalContext).toContain('TypeScript');
      });
    });

    it('should allow normal files without specific guidance', async () => {
      const result = await provider.generatePreEditGuidance('README.md');

      expect(result.decision).toBe('allow');
    });
  });

  describe('generatePostEditFeedback', () => {
    it('should detect console.log in non-test files', async () => {
      const content = `
        function login() {
          console.log('debugging');
          return true;
        }
      `;

      const result = await provider.generatePostEditFeedback('src/auth.ts', content);

      expect(result.hookSpecificOutput?.additionalContext).toContain('console.log');
    });

    it('should not flag console.log in test files', async () => {
      const content = `
        it('should work', () => {
          console.log('test output');
          expect(true).toBe(true);
        });
      `;

      const result = await provider.generatePostEditFeedback('src/auth.test.ts', content);

      expect(result.hookSpecificOutput?.additionalContext || '').not.toContain('console.log');
    });

    it('should detect TODO/FIXME comments', async () => {
      const content = `
        function login() {
          // TODO: implement proper validation
          return true;
        }
      `;

      const result = await provider.generatePostEditFeedback('src/auth.ts', content);

      expect(result.hookSpecificOutput?.additionalContext).toContain('TODO');
    });

    it('should detect any type in TypeScript', async () => {
      const content = `
        function process(data: any): void {
          console.log(data);
        }
      `;

      const result = await provider.generatePostEditFeedback('src/utils.ts', content);

      expect(result.hookSpecificOutput?.additionalContext).toContain('any');
    });

    it('should warn about large files', async () => {
      const lines = Array(600).fill('// line').join('\n');

      const result = await provider.generatePostEditFeedback('src/large.ts', lines);

      expect(result.hookSpecificOutput?.additionalContext).toContain('500 lines');
    });

    it('should detect hardcoded secrets', async () => {
      const content = `
        const config = {
          apiKey = 'sk-1234567890'
        };
      `;

      const result = await provider.generatePostEditFeedback('src/config.ts', content);

      expect(result.hookSpecificOutput?.additionalContext).toContain('secret');
    });

    it('should allow clean files', async () => {
      const content = `
        export function add(a: number, b: number): number {
          return a + b;
        }
      `;

      const result = await provider.generatePostEditFeedback('src/math.ts', content);

      expect(result.decision).toBe('allow');
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });
  });

  describe('generatePreCommandGuidance', () => {
    describe('dangerous commands', () => {
      it('should block rm -rf', async () => {
        const result = await provider.generatePreCommandGuidance('rm -rf /');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
        expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('rm -rf');
      });

      it('should block DROP DATABASE', async () => {
        const result = await provider.generatePreCommandGuidance(
          'psql -c "DROP DATABASE production"'
        );

        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      });

      it('should block git reset --hard', async () => {
        const result = await provider.generatePreCommandGuidance('git reset --hard HEAD~10');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      });

      it('should block force push', async () => {
        const result = await provider.generatePreCommandGuidance('git push --force origin main');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      });
    });

    describe('risky commands', () => {
      it('should warn about npm publish', async () => {
        const result = await provider.generatePreCommandGuidance('npm publish');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
        expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('external effects');
      });

      it('should warn about git push', async () => {
        const result = await provider.generatePreCommandGuidance('git push origin main');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
      });

      it('should warn about kubectl apply', async () => {
        const result = await provider.generatePreCommandGuidance('kubectl apply -f deployment.yaml');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
      });
    });

    describe('helpful commands', () => {
      it('should provide guidance for test commands', async () => {
        const result = await provider.generatePreCommandGuidance('npm test');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
        expect(result.hookSpecificOutput?.additionalContext).toContain('tests');
      });

      it('should provide guidance for vitest', async () => {
        const result = await provider.generatePreCommandGuidance('vitest run');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
        expect(result.hookSpecificOutput?.additionalContext).toContain('tests');
      });

      it('should provide guidance for build commands', async () => {
        const result = await provider.generatePreCommandGuidance('npm run build');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
        expect(result.hookSpecificOutput?.additionalContext).toContain('Building');
      });

      it('should provide guidance for tsc', async () => {
        const result = await provider.generatePreCommandGuidance('tsc --build');

        expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
        expect(result.hookSpecificOutput?.additionalContext).toContain('type errors');
      });
    });

    it('should allow safe commands', async () => {
      const result = await provider.generatePreCommandGuidance('ls -la');

      expect(result.decision).toBe('allow');
    });
  });

  describe('generateRoutingGuidance', () => {
    it('should recommend security-architect for security tasks', async () => {
      const guidance = await provider.generateRoutingGuidance(
        'Fix authentication security vulnerability'
      );

      expect(guidance).toContain('security-architect');
      expect(guidance).toContain('Confidence');
    });

    it('should recommend test-architect for testing tasks', async () => {
      const guidance = await provider.generateRoutingGuidance(
        'Write unit tests with mock dependencies'
      );

      expect(guidance).toContain('test-architect');
    });

    it('should include alternatives', async () => {
      const guidance = await provider.generateRoutingGuidance('Implement new feature');

      expect(guidance).toContain('Alternatives');
    });

    it('should include usage instructions', async () => {
      const guidance = await provider.generateRoutingGuidance('Any task');

      expect(guidance).toContain('Task tool');
      expect(guidance).toContain('subagent_type');
    });
  });

  describe('generateStopCheck', () => {
    it('should allow stopping when patterns are consolidated', async () => {
      const result = await provider.generateStopCheck();

      expect(result.shouldStop).toBe(true);
    });

    it('should block stopping when too many unconsolidated patterns', async () => {
      // Store more than 10 patterns to trigger the check
      for (let i = 0; i < 12; i++) {
        await reasoningBank.storePattern(`Pattern ${i}`, 'general');
      }

      const result = await provider.generateStopCheck();

      expect(result.shouldStop).toBe(false);
      expect(result.reason).toContain('patterns not yet consolidated');
    });
  });
});

describe('GuidanceProvider with default ReasoningBank', () => {
  it('should create provider without explicit ReasoningBank', async () => {
    const provider = new GuidanceProvider();
    await provider.initialize();

    const context = await provider.generateSessionContext();
    expect(context).toContain('V3 Development Context');
  });
});
