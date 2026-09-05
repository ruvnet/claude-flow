import { describe, expect, it } from 'vitest';
import { listMCPTools } from '../src/mcp-client.js';
import {
  buildCapabilityBrain,
  IMPLEMENTATION_LOOP,
  recommendCapabilities,
} from '../src/mcp-tools/capability-brain.js';
import {
  configureGuidanceToolProvider,
  guidanceTools,
} from '../src/mcp-tools/guidance-tools.js';

function decode(result: unknown): Record<string, any> {
  const payload = result as { content: Array<{ text: string }> };
  return JSON.parse(payload.content[0]!.text);
}

describe('Ruflo capability brain', () => {
  it('classifies every live registered MCP tool without duplicates', () => {
    const tools = listMCPTools();
    const brain = buildCapabilityBrain(tools, new Date('2026-07-28T00:00:00.000Z'));

    expect(brain.coverage.registeredToolCount).toBe(tools.length);
    expect(brain.coverage.classifiedToolCount).toBe(tools.length);
    expect(brain.coverage.coveragePercent).toBe(100);
    expect(brain.coverage.duplicateToolNames).toEqual([]);
    expect(brain.coverage.fallbackClassifiedTools).toEqual([]);

    const assigned = brain.domains.flatMap((domain) => domain.tools.map((tool) => tool.name));
    expect(new Set(assigned).size).toBe(tools.length);
    for (const domain of brain.domains) {
      expect(domain.packageOwners.length).toBeGreaterThan(0);
      expect(domain.availabilityMode).toBeTruthy();
      expect(domain.riskFlags.length).toBeGreaterThan(0);
      expect(domain.loopPhases.length).toBeGreaterThan(0);
      for (const tool of domain.tools) {
        expect(tool.domain).toBe(domain.id);
        expect(tool.packageOwner).toBeTruthy();
        expect(tool.availabilityMode).toBe(domain.availabilityMode);
        expect(tool.riskFlags.length).toBeGreaterThan(0);
      }
    }

    const testgen = brain.domains.find((domain) => domain.id === 'test-generation')!;
    expect(testgen.exactTools).toContain('testgen_tdd_repair');
    expect(testgen.health.registered).toBe(false);
    const auth = brain.domains.find((domain) => domain.id === 'identity-auth')!;
    expect(auth.commands).toContain('auth status --check');
    expect(auth.health.registered).toBe(false);
    expect(auth.riskFlags).toEqual(
      expect.arrayContaining(['network', 'credential-pii', 'approval']),
    );
    expect(brain.cliCommands).toHaveLength(52);
  });

  it('does not confuse registration with runtime health or authorization', () => {
    const brain = buildCapabilityBrain([{ name: 'memory_search' }]);
    const memory = brain.domains.find((domain) => domain.id === 'memory-knowledge')!;

    expect(memory.health).toEqual({
      registered: true,
      configured: 'unknown',
      reachable: 'unknown',
      healthy: 'unknown',
      authorized: 'unknown',
    });
  });

  it('conservatively reports agent, cloud, browser, terminal, and promotion effects', () => {
    const brain = buildCapabilityBrain([
      { name: 'agent_execute' },
      { name: 'managed_agent_create' },
      { name: 'browser_act' },
      { name: 'terminal_execute' },
      { name: 'agenticow_promote' },
    ]);
    const byName = new Map(
      brain.domains.flatMap((domain) => domain.tools).map((tool) => [tool.name, tool]),
    );

    for (const name of ['agent_execute', 'managed_agent_create']) {
      expect(byName.get(name)?.risk).toBe('privileged');
      expect(byName.get(name)?.riskFlags).toEqual(
        expect.arrayContaining(['process-exec', 'network', 'credential-pii', 'spend']),
      );
    }
    expect(byName.get('browser_act')?.riskFlags).toEqual(
      expect.arrayContaining(['network', 'credential-pii', 'spend', 'approval']),
    );
    expect(byName.get('terminal_execute')?.riskFlags).toEqual(
      expect.arrayContaining(['process-exec', 'credential-pii', 'destructive']),
    );
    expect(byName.get('agenticow_promote')?.riskFlags).toEqual(
      expect.arrayContaining(['memory-poisoning', 'promotion']),
    );
  });

  it('routes claim federation through policy, consensus, and the guarded loop', () => {
    const brain = buildCapabilityBrain([
      { name: 'claims_check' },
      { name: 'policy_evaluate' },
      { name: 'hive_mind_init' },
      { name: 'security_audit' },
    ]);
    const recommendation = recommendCapabilities(
      brain,
      'Implement secure claim federation policy and benchmark it',
    );

    expect(recommendation.domains.map((domain) => domain.id)).toContain('policy-authorization');
    expect(recommendation.domains.map((domain) => domain.id)).toContain('consensus-federation');
    expect(recommendation.implementationLoop.map((step) => step.id)).toEqual(
      IMPLEMENTATION_LOOP.map((step) => step.id),
    );
    expect(recommendation.guardrails.join(' ')).toContain('never self-authorizing');
  });

  it('makes external publication an authorized final stage', () => {
    const publish = IMPLEMENTATION_LOOP.at(-1)!;
    expect(publish.id).toBe('publish');
    expect(publish.mutation).toBe('external');
    expect(publish.requiredEvidence).toContain('authorization');
    expect(IMPLEMENTATION_LOOP.findIndex((step) => step.id === 'benchmark')).toBeLessThan(
      IMPLEMENTATION_LOOP.findIndex((step) => step.id === 'optimize'),
    );
  });

  it('serves live coverage and implementation-loop views through MCP', async () => {
    const synthetic = [
      { name: 'guidance_brain', description: 'brain' },
      { name: 'memory_search', description: 'recall' },
      { name: 'metaharness_score', description: 'score' },
    ];
    configureGuidanceToolProvider(() => synthetic);
    const tool = guidanceTools.find((entry) => entry.name === 'guidance_brain')!;

    const coverage = decode(await tool.handler({ mode: 'coverage' }, {} as never));
    expect(coverage.coverage.registeredToolCount).toBe(3);
    expect(coverage.coverage.coveragePercent).toBe(100);

    const loop = decode(await tool.handler({ mode: 'implementation-loop' }, {} as never));
    expect(loop.steps.map((step: { id: string }) => step.id)).toEqual(
      IMPLEMENTATION_LOOP.map((step) => step.id),
    );
    expect(loop.invariants.join(' ')).toContain('cannot authorize promotion');
  });

  it('never presents stale compatibility references as live recommendations', async () => {
    configureGuidanceToolProvider(() => [
      { name: 'aidefence_scan', description: 'content safety' },
      { name: 'policy_evaluate', description: 'authorization' },
      { name: 'guidance_recommend', description: 'recommend' },
    ]);
    const tool = guidanceTools.find((entry) => entry.name === 'guidance_recommend')!;
    const result = decode(await tool.handler({ task: 'Run a security audit and policy check' }, {} as never));
    const legacySecurity = result.recommendations.find(
      (entry: { area: string }) => entry.area === 'security',
    );

    expect(legacySecurity.tools).toEqual([]);
    expect(legacySecurity.unregisteredLegacyToolRefs).toContain('security_scan');
    expect(result.capabilityBrain.domains.map((entry: { id: string }) => entry.id))
      .toEqual(expect.arrayContaining(['content-safety', 'policy-authorization']));
  });

  it('discovers the repository ecosystem beyond the legacy .claude skill root', async () => {
    const tool = guidanceTools.find((entry) => entry.name === 'guidance_discover')!;
    const result = decode(await tool.handler({ type: 'all' }, {} as never));

    expect(result.agents.count).toBeGreaterThan(0);
    expect(result.skills.count).toBeGreaterThan(100);
    expect(result.plugins.count).toBeGreaterThan(30);
    expect(result.packages.count).toBeGreaterThan(20);
    expect(result.capabilityBrain.note).toContain('does not prove');
  });
});
