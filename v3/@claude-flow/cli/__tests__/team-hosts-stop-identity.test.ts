/**
 * stopIdentity per host adapter: map a stop-hook payload to team/agent.
 */
import { describe, it, expect } from 'vitest';
import { getAdapter, normalizeAgentLabel } from '../src/mcp-tools/team-hosts/index.js';

const noEnv = {} as NodeJS.ProcessEnv;

describe('team host stopIdentity', () => {
  it('grok: description role:agent form', () => {
    expect(getAdapter('grok').stopIdentity({ description: 'architect:architect' }, noEnv)).toEqual({ agent: 'architect' });
    expect(getAdapter('grok').stopIdentity({ toolInput: { description: 'tester:qa-1' }, teamName: 'demo' }, noEnv))
      .toEqual({ agent: 'qa-1', team: 'demo' });
  });

  it('grok: SUBAGENT_NAME env wins over the payload', () => {
    const env = { SUBAGENT_NAME: 'reviewer:rev' } as NodeJS.ProcessEnv;
    expect(getAdapter('grok').stopIdentity({ description: 'x:y' }, env).agent).toBe('rev');
  });

  it('claude: subagentName and agent_type', () => {
    expect(getAdapter('claude').stopIdentity({ subagentName: 'coder' }, noEnv).agent).toBe('coder');
    expect(getAdapter('claude').stopIdentity({ agent_type: 'tester', team: 't1' }, noEnv)).toEqual({ agent: 'tester', team: 't1' });
  });

  it('codex: Claude-shaped names plus agent_type, agent_id and name', () => {
    expect(getAdapter('codex').stopIdentity({ agent_type: 'reviewer' }, noEnv).agent).toBe('reviewer');
    expect(getAdapter('codex').stopIdentity({ agent_id: 'dev-2' }, noEnv).agent).toBe('dev-2');
    expect(getAdapter('codex').stopIdentity({ name: 'researcher' }, noEnv).agent).toBe('researcher');
    expect(getAdapter('codex').stopIdentity({ agentName: 'arch' }, noEnv).agent).toBe('arch');
  });

  it('command hosts (and unknown labels) use the command adapter', () => {
    expect(getAdapter('myagent').id).toBe('command');
    expect(getAdapter('myagent').stopIdentity({ agent: 'w1', outcome: 'failed' }, noEnv)).toEqual({ agent: 'w1', outcome: 'failed' });
  });

  it('ignores an invalid outcome and empty payloads', () => {
    expect(getAdapter('grok').stopIdentity({ agent: 'a', outcome: 'maybe' }, noEnv)).toEqual({ agent: 'a' });
    expect(getAdapter('grok').stopIdentity(null, noEnv)).toEqual({});
    expect(getAdapter('codex').stopIdentity('not-json', noEnv)).toEqual({});
  });

  it('normalizeAgentLabel', () => {
    expect(normalizeAgentLabel('role:agent')).toBe('agent');
    expect(normalizeAgentLabel('a:b:c')).toBe('c');
    expect(normalizeAgentLabel(' my agent ')).toBe('my-agent');
    expect(normalizeAgentLabel('x'.repeat(100))).toHaveLength(64);
  });
});
