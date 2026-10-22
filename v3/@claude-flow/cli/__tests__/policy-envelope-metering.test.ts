import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const state = vi.hoisted(() => ({ root: '' }));
vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, userInfo: () => ({ ...actual.userInfo(), homedir: state.root }) };
});
// Exercise the actual policy and caller-identity exports without loading
// unrelated password-hashing/native security dependencies in this fixture.
vi.mock('@claude-flow/security', async () => ({
  ...await import('../../security/src/policy/index.js'),
  ...await import('../../security/src/mcp-caller-identity.js'),
}));
import { policyTools } from '../src/mcp-tools/policy-tools.js';
import { loadPolicyState, setPolicyMode, upsertPolicyRule, verifyPolicyLedger } from '../src/services/policy-runtime.js';
import { callMCPTool } from '../src/mcp-client.js';
import { configTools } from '../src/mcp-tools/config-tools.js';
import { DualModeOrchestrator, type WorkerConfig } from '../../codex/src/dual-mode/orchestrator.js';
import { delegateEnvelope, type CapabilityEnvelope } from '../../security/src/policy/index.js';
const evaluate = policyTools.find(t => t.name === 'policy_evaluate')!;
beforeEach(() => { state.root = mkdtempSync(join(tmpdir(), 'ruflo-envelope-meter-')); });
afterEach(() => rmSync(state.root, { recursive: true, force: true }));

async function asWorker(envelope: CapabilityEnvelope | undefined, action: () => Promise<void>): Promise<void> {
  execFileSync('git', ['init', '-q', state.root]);
  const orchestrator = new DualModeOrchestrator({ projectPath: state.root }) as unknown as {
    workerEnvironment(worker: WorkerConfig): NodeJS.ProcessEnv;
  };
  const environment = orchestrator.workerEnvironment({
    id: 'ordinary-worker', platform: 'codex', role: 'reader', prompt: 'inspect',
    readOnly: true, capabilityEnvelope: envelope,
  });
  const names = ['CLAUDE_FLOW_CAPABILITY_ENVELOPE', 'CLAUDE_FLOW_PRINCIPAL_ID', 'CLAUDE_FLOW_MCP_CALLER_AUTH'] as const;
  const previous = names.map(name => process.env[name]);
  const cwd = process.cwd();
  try {
    process.chdir(state.root);
    process.env.CLAUDE_FLOW_CAPABILITY_ENVELOPE = environment.CLAUDE_FLOW_CAPABILITY_ENVELOPE;
    process.env.CLAUDE_FLOW_PRINCIPAL_ID = environment.CLAUDE_FLOW_PRINCIPAL_ID;
    process.env.CLAUDE_FLOW_MCP_CALLER_AUTH = 'false';
    await action();
  } finally {
    process.chdir(cwd);
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
}

for (const mode of ['legacy', 'observe', 'enforce'] as const) {
  describe(`${mode} public policy evaluation`, () => {
    it.each(['maxCostUsd', 'maxTokens', 'maxConcurrency'])('does not bypass %s by omitting metering', async ceiling => {
      await upsertPolicyRule({ id: 'allow-fixture', effect: 'allow', actions: ['*'] }, state.root);
      await setPolicyMode(mode, state.root);
      const result = await evaluate.handler({ request: {
        identity: { id: 'agent:fixture', type: 'agent' },
        action: { type: 'memory.read', namespace: 'notes' },
        context: { envelope: { [ceiling]: 1 } },
      } }, { projectRoot: state.root });
      expect(result).toMatchObject({ outcome: 'denied', enforcedOutcome: 'denied' });
      expect(await verifyPolicyLedger(state.root)).toMatchObject({ valid: true });
    });
    it('permits explicitly metered zero-cost reads within zero ceilings', async () => {
      await upsertPolicyRule({ id: 'allow-fixture', effect: 'allow', actions: ['*'] }, state.root);
      await setPolicyMode(mode, state.root);
      expect(await evaluate.handler({ request: {
        identity: { id: 'agent:fixture', type: 'agent' },
        action: { type: 'memory.read', namespace: 'notes', costUsd: 0, tokens: 0, concurrency: 0 },
        context: { envelope: { maxCostUsd: 0, maxTokens: 0, maxConcurrency: 0 } },
      } }, { projectRoot: state.root })).toMatchObject({ enforcedOutcome: 'allowed' });
    });

    it('admits an ordinary generated worker envelope through real MCP dispatch', async () => {
      await upsertPolicyRule({ id: 'allow-fixture', effect: 'allow', actions: ['mcp.tool.call'] }, state.root);
      await setPolicyMode(mode, state.root);
      const tool = configTools.find(t => t.name === 'config_set')!;
      const handler = vi.spyOn(tool, 'handler');
      try {
        await asWorker(undefined, async () => {
          await expect(callMCPTool('config_set', { key: 'workerProof', value: 'admitted' }, { projectRoot: state.root }))
            .resolves.toMatchObject({ success: true });
          expect(handler).toHaveBeenCalledOnce();
          expect(readFileSync(join(state.root, '.claude-flow', 'config.json'), 'utf8')).toContain('admitted');
          const receipt = loadPolicyState(state.root).receipts.at(-1)!;
          expect(receipt.payload.request.identity.id).toBe('agent:ordinary-worker');
          expect(receipt.payload.request.action.costUsd).toBeUndefined();
          expect(receipt.payload.request.action.tokens).toBeUndefined();
          expect(receipt.payload.request.action.concurrency).toBeUndefined();
          expect(receipt.payload.request.context?.envelope?.maxConcurrency).toBeUndefined();
          expect(receipt.payload.decision.enforcedOutcome).toBe('allowed');
        });
      } finally {
        handler.mockRestore();
      }
    });

    it.each([
      ['maxCostUsd', 'cost-outside-envelope'],
      ['maxTokens', 'tokens-outside-envelope'],
      ['maxConcurrency', 'concurrency-outside-envelope'],
    ] as const)('preserves an opted-in %s and denies an unmetered worker before its handler', async (ceiling, reason) => {
      await upsertPolicyRule({ id: 'allow-fixture', effect: 'allow', actions: ['mcp.tool.call'] }, state.root);
      await setPolicyMode(mode, state.root);
      const tool = configTools.find(t => t.name === 'config_set')!;
      const handler = vi.spyOn(tool, 'handler');
      const requested: CapabilityEnvelope = { actions: ['*'], [ceiling]: 1 };
      try {
        await asWorker(requested, async () => {
          await expect(callMCPTool('config_set', { key: 'workerProof', value: 'must-not-run' }, { projectRoot: state.root }))
            .rejects.toThrow(reason);
          expect(handler).not.toHaveBeenCalled();
          expect(existsSync(join(state.root, '.claude-flow', 'config.json'))).toBe(false);
          const receipt = loadPolicyState(state.root).receipts.at(-1)!;
          expect(receipt.payload.request.context?.envelope?.[ceiling]).toBe(1);
          expect(receipt.payload.decision.enforcedOutcome).toBe('denied');
        });
      } finally {
        handler.mockRestore();
      }
    });
  });
}

it.each(['maxCostUsd', 'maxTokens', 'maxConcurrency'] as const)('retains an explicit %s during delegation', ceiling => {
  const parent: CapabilityEnvelope = { actions: ['*'], [ceiling]: 1, delegationDepth: 1 };
  expect(delegateEnvelope(parent, { actions: ['memory.read'] })[ceiling]).toBe(1);
  expect(() => delegateEnvelope(parent, { [ceiling]: 2 })).toThrow('capability-envelope-cannot-grow');
});
