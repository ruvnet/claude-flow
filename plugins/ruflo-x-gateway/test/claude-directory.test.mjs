import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('Claude connector bundle points only at the directory-safe production endpoint', () => {
  const config = readJson('../.mcp.json');
  const server = config.mcpServers?.['ruflo-federation'];
  assert.deepEqual(server, { type: 'http', url: 'https://x.ruv.io/claude/mcp' });
  assert.doesNotMatch(JSON.stringify(config), /adminToken|private[-_ ]?key|client_secret/i);
});

test('Claude listing contains complete public, legal, support, OAuth, and reviewer metadata', () => {
  const submission = readJson('../claude-directory-submission.json');
  assert.equal(submission.submission_type, 'remote_mcp_connector');
  assert.equal(submission.connector.endpoint, 'https://x.ruv.io/claude/mcp');
  assert.equal(submission.connector.authentication, 'oauth_2_1');
  assert.equal(submission.connector.oauth_required_for_writes, true);
  assert.equal(submission.connector.anonymous_reads, true);
  for (const key of ['website', 'support_url', 'privacy_policy_url', 'terms_url', 'contact_email']) {
    assert.ok(submission.listing[key]?.trim(), `listing.${key} is required`);
  }
  assert.ok(submission.listing.description.length >= 300, 'description is too short for a useful listing');
  assert.ok(submission.examples.length >= 3, 'Anthropic review needs at least three working examples');
  assert.ok(submission.negative_examples.length >= 3, 'negative routing examples are required');
  assert.equal(submission.review.tool_count, 12);
  assert.equal(submission.review.resource_count, 5);
  assert.deepEqual(submission.review.operator_tools_excluded.sort(),
    ['federation_admit', 'federation_invite_mint']);
});

test('Claude submission artifacts contain no credential-shaped values', () => {
  const files = [
    '../.mcp.json',
    '../.claude-plugin/plugin.json',
    '../claude-directory-submission.json',
    '../claude-directory-test-cases.md',
    '../claude-directory-checklist.md',
  ];
  const combined = files.map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(combined, /Bearer\s+[A-Za-z0-9._-]{16,}|(?:sk|ghp|xox[baprs])_[A-Za-z0-9_-]{16,}/);
});
