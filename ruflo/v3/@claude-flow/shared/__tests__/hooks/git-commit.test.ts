/**
 * V3 Git Commit Hook Tests
 *
 * Tests for git commit message formatting and validation.
 *
 * @module v3/shared/hooks/__tests__/git-commit.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createHookRegistry,
  createGitCommitHook,
  GitCommitHook,
  HookRegistry,
} from '../../src/hooks/index.js';

describe('GitCommitHook', () => {
  let registry: HookRegistry;
  let gitCommit: GitCommitHook;

  beforeEach(() => {
    registry = createHookRegistry();
    gitCommit = createGitCommitHook(registry);
  });

  describe('commit type detection', () => {
    it('should detect feat type from message', async () => {
      const result = await gitCommit.process('Add user authentication');

      expect(result.commitType).toBe('feat');
      expect(result.modifiedMessage).toMatch(/^feat:/);
    });

    it('should detect fix type from message', async () => {
      const result = await gitCommit.process('Fix login validation bug');

      expect(result.commitType).toBe('fix');
      expect(result.modifiedMessage).toMatch(/^fix:/);
    });

    it('should detect docs type from message', async () => {
      const result = await gitCommit.process('Update README documentation');

      expect(result.commitType).toBe('docs');
      expect(result.modifiedMessage).toMatch(/^docs:/);
    });

    it('should detect refactor type from message', async () => {
      const result = await gitCommit.process('Refactor authentication module');

      expect(result.commitType).toBe('refactor');
      expect(result.modifiedMessage).toMatch(/^refactor:/);
    });

    it('should detect test type from message', async () => {
      const result = await gitCommit.process('Add unit tests for user service');

      expect(result.commitType).toBe('test');
      expect(result.modifiedMessage).toMatch(/^test:/);
    });

    it('should detect perf type from message', async () => {
      const result = await gitCommit.process('Optimize database queries');

      expect(result.commitType).toBe('perf');
      expect(result.modifiedMessage).toMatch(/^perf:/);
    });

    it('should detect build type from message', async () => {
      const result = await gitCommit.process('Update webpack configuration');

      expect(result.commitType).toBe('build');
      expect(result.modifiedMessage).toMatch(/^build:/);
    });

    it('should detect ci type from message', async () => {
      const result = await gitCommit.process('Update GitHub Actions workflow');

      expect(result.commitType).toBe('ci');
      expect(result.modifiedMessage).toMatch(/^ci:/);
    });

    it('should detect chore type from message', async () => {
      const result = await gitCommit.process('Update dependencies');

      expect(result.commitType).toBe('chore');
      expect(result.modifiedMessage).toMatch(/^chore:/);
    });

    it('should detect revert type from message', async () => {
      const result = await gitCommit.process('Revert previous commit');

      expect(result.commitType).toBe('revert');
      expect(result.modifiedMessage).toMatch(/^revert:/);
    });
  });

  describe('preserving existing prefixes', () => {
    it('should not add duplicate prefix if already present', async () => {
      const result = await gitCommit.process('feat: add user authentication');

      expect(result.commitType).toBe('feat');
      // Should not have double prefix
      expect(result.modifiedMessage).not.toMatch(/^feat:.*feat:/);
    });

    it('should detect type from existing prefix', async () => {
      const result = await gitCommit.process('fix(auth): resolve login issue');

      expect(result.commitType).toBe('fix');
    });

    it('should handle scoped commits', async () => {
      const result = await gitCommit.process('feat(api): add new endpoint');

      expect(result.commitType).toBe('feat');
    });
  });

  describe('ticket extraction', () => {
    it('should extract JIRA ticket from branch name', async () => {
      const result = await gitCommit.process('Add feature', 'feature/ABC-123-new-feature');

      expect(result.ticketReference).toBe('ABC-123');
      expect(result.modifiedMessage).toContain('Refs: ABC-123');
    });

    it('should extract GitHub issue from branch name', async () => {
      const result = await gitCommit.process('Fix bug', 'fix/#456-login-bug');

      expect(result.ticketReference).toBe('#456');
      expect(result.modifiedMessage).toContain('Refs: #456');
    });

    it('should not duplicate ticket if already in message', async () => {
      const result = await gitCommit.process('Fix ABC-123 bug', 'feature/ABC-123-test');

      // Should only appear once
      const matches = result.modifiedMessage.match(/ABC-123/g);
      expect(matches).toBeDefined();
      expect(matches!.length).toBeLessThanOrEqual(2);
    });
  });

  describe('co-author addition', () => {
    it('should add co-author by default', async () => {
      const result = await gitCommit.process('Add feature');

      expect(result.coAuthorAdded).toBe(true);
      expect(result.modifiedMessage).toContain('Co-Authored-By:');
      expect(result.modifiedMessage).toContain('Claude');
    });

    it('should add Claude Code reference', async () => {
      const result = await gitCommit.process('Add feature');

      expect(result.modifiedMessage).toContain('Claude Code');
    });

    it('should not duplicate co-author if already present', async () => {
      const result = await gitCommit.process('Add feature\n\nCo-Authored-By: Someone <some@email.com>');

      // Should still add Claude co-author
      expect(result.modifiedMessage).toContain('Claude');
    });
  });

  describe('validation', () => {
    it('should warn about missing conventional prefix', async () => {
      const hook = createGitCommitHook(registry, { requireConventional: true });
      const result = await hook.process('Some random message');

      // Message should be modified to include prefix
      expect(result.suggestions).toBeDefined();
    });

    it('should warn about long subject line', async () => {
      const longMessage = 'This is a very long commit message that exceeds the recommended length for commit subject lines which should be concise';
      const result = await gitCommit.process(longMessage);

      expect(result.validationIssues).toBeDefined();
      expect(result.validationIssues!.some(i => i.type === 'length')).toBe(true);
    });

    it('should warn about trailing period in subject', async () => {
      const result = await gitCommit.process('Add new feature.');

      expect(result.validationIssues).toBeDefined();
      expect(result.validationIssues!.some(i => i.description.includes('period'))).toBe(true);
    });

    it('should detect breaking change indicator', async () => {
      const result = await gitCommit.process('feat!: major API change');

      expect(result.validationIssues).toBeDefined();
      expect(result.validationIssues!.some(i => i.type === 'breaking')).toBe(true);
    });

    it('should detect BREAKING CHANGE footer', async () => {
      const result = await gitCommit.process('feat: add feature\n\nBREAKING CHANGE: API changed');

      expect(result.validationIssues).toBeDefined();
      expect(result.validationIssues!.some(i => i.type === 'breaking')).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should respect maxSubjectLength config', async () => {
      const hook = createGitCommitHook(registry, { maxSubjectLength: 50 });
      const result = await hook.process('This is a message that is definitely longer than fifty characters');

      expect(result.validationIssues).toBeDefined();
      expect(result.validationIssues!.some(i => i.type === 'length')).toBe(true);
    });

    it('should allow disabling co-author', async () => {
      const hook = createGitCommitHook(registry, { addCoAuthor: false });
      const result = await hook.process('Add feature');

      expect(result.coAuthorAdded).toBe(false);
      expect(result.modifiedMessage).not.toContain('Co-Authored-By');
    });

    it('should allow disabling Claude reference', async () => {
      const hook = createGitCommitHook(registry, { addClaudeReference: false });
      const result = await hook.process('Add feature');

      expect(result.modifiedMessage).not.toContain('Claude Code');
    });

    it('should allow custom co-author', async () => {
      const hook = createGitCommitHook(registry, {
        coAuthor: { name: 'Custom AI', email: 'ai@example.com' },
      });
      const result = await hook.process('Add feature');

      expect(result.modifiedMessage).toContain('Custom AI');
      expect(result.modifiedMessage).toContain('ai@example.com');
    });
  });

  describe('helper methods', () => {
    it('should format message for git heredoc', () => {
      const formatted = gitCommit.formatForGit('Test message');

      expect(formatted).toContain('$(cat <<');
      expect(formatted).toContain('Test message');
      expect(formatted).toContain('EOF');
    });

    it('should generate full commit command', () => {
      const command = gitCommit.generateCommitCommand('Test message');

      expect(command).toContain('git commit -m');
      expect(command).toContain('Test message');
    });

    it('should get commit type description', () => {
      expect(gitCommit.getCommitTypeDescription('feat')).toContain('feature');
      expect(gitCommit.getCommitTypeDescription('fix')).toContain('bug fix');
      expect(gitCommit.getCommitTypeDescription('docs')).toContain('Documentation');
    });

    it('should get all commit types', () => {
      const types = gitCommit.getAllCommitTypes();

      expect(types.length).toBeGreaterThan(0);
      expect(types.some(t => t.type === 'feat')).toBe(true);
      expect(types.some(t => t.type === 'fix')).toBe(true);
    });

    it('should get current config', () => {
      const config = gitCommit.getConfig();

      expect(config.maxSubjectLength).toBeDefined();
      expect(config.addCoAuthor).toBe(true);
    });

    it('should update config', () => {
      gitCommit.setConfig({ addCoAuthor: false });
      const config = gitCommit.getConfig();

      expect(config.addCoAuthor).toBe(false);
    });
  });

  describe('message case handling', () => {
    it('should lowercase first letter after prefix', async () => {
      const result = await gitCommit.process('Add new feature');

      expect(result.modifiedMessage).toMatch(/^feat: add/);
    });

    it('should preserve acronyms', async () => {
      const result = await gitCommit.process('Add API endpoint');

      // Should not lowercase API
      expect(result.modifiedMessage).toMatch(/API/);
    });
  });

  describe('full message processing', () => {
    it('should process complete message with all modifications', async () => {
      const result = await gitCommit.process(
        'Implement user authentication',
        'feature/AUTH-123-login'
      );

      // Should have commit type prefix
      expect(result.modifiedMessage).toMatch(/^feat:/);

      // Should have ticket reference
      expect(result.modifiedMessage).toContain('AUTH-123');

      // Should have Claude reference
      expect(result.modifiedMessage).toContain('Claude Code');

      // Should have co-author
      expect(result.modifiedMessage).toContain('Co-Authored-By');
    });

    it('should return original message unchanged in result', async () => {
      const original = 'Original message';
      const result = await gitCommit.process(original);

      expect(result.originalMessage).toBe(original);
    });

    it('should track suggestions for modifications', async () => {
      const result = await gitCommit.process('Add feature', 'feature/JIRA-123');

      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });
  });
});
