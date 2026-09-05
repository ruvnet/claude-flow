/**
 * Tests for business_pod_validate + business_pod_route_backend MCP tools
 * + pod-schema validator + domain-affinity policy
 * (ADR-164 Phase 2 + Phase 3, ADR-164.1 reservationExpiryMs bound).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { businessPodTools } from '../src/mcp-tools/business-pod-tools.js';
import {
  validatePodTemplate,
  PodTemplateValidationError,
  type PodTemplate,
} from '../src/business-pods/pod-schema.js';
import {
  selectAgentBackend,
  CLOUD_BUDGET_THRESHOLD_USD,
} from '../src/business-pods/domain-affinity-policy.js';

function findTool(name: string) {
  const t = businessPodTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

const TEMPLATES_DIR = resolve(
  __dirname,
  '../../../../plugins/ruflo-business-pods/templates',
);
const POD_NAMES = ['sales', 'marketing', 'finance', 'ops', 'support', 'hr', 'exec'] as const;
const loadJson = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(TEMPLATES_DIR, `${name}.json`), 'utf-8'));

const salesJson = loadJson('sales');

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

describe('pod-schema validator — structural', () => {
  it('rejects non-object input with JSON-pointer "/"', () => {
    expect(() => validatePodTemplate('not an object')).toThrow(PodTemplateValidationError);
    expect(() => validatePodTemplate(null)).toThrow(/pod-template must be a JSON object/);
    expect(() => validatePodTemplate([])).toThrow(/pod-template must be a JSON object/);
  });

  it('rejects missing required fields with structured error', () => {
    expect(() => validatePodTemplate({})).toThrow(/field "name" must be a non-empty string/);
    expect(() => validatePodTemplate({ name: 'sales' })).toThrow(/displayName/);
  });

  it('rejects malformed name (must be lowercase-kebab)', () => {
    const t = clone(salesJson) as Record<string, unknown>;
    t.name = 'Sales Pod';
    expect(() => validatePodTemplate(t)).toThrow(/lowercase-kebab/);
  });

  it('rejects empty agents array', () => {
    const t = clone(salesJson) as any;
    t.agents = [];
    expect(() => validatePodTemplate(t)).toThrow(/agents must have ≥1 entry/);
  });

  it('rejects empty allowedMcpTools array', () => {
    const t = clone(salesJson) as any;
    t.allowedMcpTools = [];
    expect(() => validatePodTemplate(t)).toThrow(/allowedMcpTools must have ≥1 entry/);
  });

  it('rejects empty bench.successCriteria', () => {
    const t = clone(salesJson) as any;
    t.bench.successCriteria = [];
    expect(() => validatePodTemplate(t)).toThrow(/successCriteria must have ≥1 entry/);
  });

  it('rejects invalid piiPolicy', () => {
    const t = clone(salesJson) as any;
    t.piiPolicy = 'invalid';
    expect(() => validatePodTemplate(t)).toThrow(/piiPolicy must be one of/);
  });

  it('rejects malformed cronSchedule', () => {
    const t = clone(salesJson) as any;
    t.cronSchedule = 'every six hours';
    expect(() => validatePodTemplate(t)).toThrow(/cronSchedule must be a POSIX cron expression/);
  });

  it('rejects budgetUsdPerRun exceeding budgetUsdMonthly', () => {
    const t = clone(salesJson) as any;
    t.budgetUsdPerRun = 100;
    t.budgetUsdMonthly = 50;
    expect(() => validatePodTemplate(t)).toThrow(/budgetUsdPerRun must not exceed budgetUsdMonthly/);
  });

  it('rejects negative budgets', () => {
    const t = clone(salesJson) as any;
    t.budgetUsdMonthly = -1;
    expect(() => validatePodTemplate(t)).toThrow(/budgetUsdMonthly must be ≥0/);
  });

  it('ADR-164.1 §3.2 — reservationExpiryMs below 5000 ms is rejected', () => {
    const t = clone(salesJson) as any;
    t.reservationExpiryMs = 1000;
    expect(() => validatePodTemplate(t)).toThrow(/reservationExpiryMs must be within \[5000, 300000\] ms/);
  });

  it('ADR-164.1 §3.2 — reservationExpiryMs above 300000 ms is rejected', () => {
    const t = clone(salesJson) as any;
    t.reservationExpiryMs = 600_000;
    expect(() => validatePodTemplate(t)).toThrow(/reservationExpiryMs must be within \[5000, 300000\] ms/);
  });

  it('reservationExpiryMs is optional — omitting it validates', () => {
    const t = clone(salesJson) as any;
    delete t.reservationExpiryMs;
    expect(() => validatePodTemplate(t)).not.toThrow();
  });

  it('accepts the Phase 2 sales.json template verbatim', () => {
    const t = validatePodTemplate(salesJson) as PodTemplate;
    expect(t.name).toBe('sales');
    expect(t.roomId).toBe('sales');
    expect(t.agents.length).toBe(4);
    expect(t.piiPolicy).toBe('soc2');
    expect(t.budgetUsdMonthly).toBe(50);
    expect(t.reservationExpiryMs).toBe(60_000);
  });
});

describe('Phase 3 — all 7 pod templates validate', () => {
  for (const name of POD_NAMES) {
    it(`${name}.json validates without errors`, () => {
      const raw = loadJson(name);
      const t = validatePodTemplate(raw);
      expect(t.name).toBe(name);
      expect(t.agents.length).toBeGreaterThanOrEqual(1);
      expect(t.allowedMcpTools.length).toBeGreaterThanOrEqual(1);
      expect(t.bench.successCriteria.length).toBeGreaterThanOrEqual(1);
    });
  }

  it('ops.json bench description references the synthetic-HTTP-endpoint test (ADR-164 §4.4)', () => {
    const ops = validatePodTemplate(loadJson('ops')) as PodTemplate;
    expect(ops.bench.description).toMatch(/synthetic.*endpoint/i);
    expect(ops.bench.description).toMatch(/200/);
    expect(ops.bench.description).toMatch(/500/);
    expect(ops.bench.description).toMatch(/60 seconds|60s/i);
    expect(ops.allowedMcpTools).toContain('http_fetch');
    expect(ops.allowedMcpTools).toContain('aidefence_analyze');
    expect(ops.allowedMcpTools).toContain('terminal_execute');
    expect(ops.allowedMcpTools).toContain('agent_execute');
  });

  it('exec.json bench description references the founder-bootstrap trust elevation (ADR-164 §3.5.4)', () => {
    const exec = validatePodTemplate(loadJson('exec')) as PodTemplate;
    expect(exec.bench.description).toMatch(/share-context/);
    expect(exec.bench.description).toMatch(/3\.5\.4|founder-bootstrap|escape hatch/i);
  });

  it('finance.json + hr.json + exec.json use gdpr piiPolicy (most restrictive)', () => {
    for (const n of ['finance', 'hr', 'exec'] as const) {
      const t = validatePodTemplate(loadJson(n)) as PodTemplate;
      expect(t.piiPolicy).toBe('gdpr');
      expect(t.preferLocalExecution).toBe(true);
    }
  });
});

describe('business_pod_validate MCP tool', () => {
  it('exposes business_pod_validate with required schema shape', () => {
    const t = findTool('business_pod_validate');
    expect(t.name).toBe('business_pod_validate');
    expect(t.inputSchema.type).toBe('object');
    expect(t.inputSchema.properties).toBeDefined();
    expect(typeof t.handler).toBe('function');
    // ADR-112 — description must be ≥80 chars and carry use-when guidance.
    expect(t.description.length).toBeGreaterThanOrEqual(80);
    expect(t.description).toMatch(/Use when/i);
    expect(t.description).toMatch(/wrong because/i);
  });

  it('exposes business_pod_route_backend with required schema shape', () => {
    const t = findTool('business_pod_route_backend');
    expect(t.name).toBe('business_pod_route_backend');
    expect(t.inputSchema.type).toBe('object');
    expect(t.inputSchema.properties).toBeDefined();
    expect(typeof t.handler).toBe('function');
    // ADR-112 — description must be ≥80 chars and carry use-when guidance.
    expect(t.description.length).toBeGreaterThanOrEqual(80);
    expect(t.description).toMatch(/Use when/i);
    expect(t.description).toMatch(/wrong because/i);
  });

  it('exposes exactly 2 business-pod tools (Phase 2 + Phase 3)', () => {
    expect(businessPodTools.length).toBe(2);
  });

  it('happy path: returns {success:true, valid:true, template, warnings}', async () => {
    const tool = findTool('business_pod_validate');
    const r: any = await tool.handler({ podTemplate: salesJson });
    expect(r.success).toBe(true);
    expect(r.valid).toBe(true);
    expect(r.template.name).toBe('sales');
    expect(r.warnings).toEqual([]);
  });

  it('error path: returns {success:false, valid:false, error, path}', async () => {
    const tool = findTool('business_pod_validate');
    const bad = clone(salesJson) as any;
    bad.reservationExpiryMs = 1000;
    const r: any = await tool.handler({ podTemplate: bad });
    expect(r.success).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/reservationExpiryMs/);
    expect(r.path).toBe('/');
  });

  it('error path: non-object podTemplate is rejected before validation', async () => {
    const tool = findTool('business_pod_validate');
    const r: any = await tool.handler({ podTemplate: 'not an object' });
    expect(r.success).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/podTemplate must be a JSON object/);
  });

  it('warns (does not fail) on unknown agent types', async () => {
    const tool = findTool('business_pod_validate');
    const withUnknown = clone(salesJson) as any;
    withUnknown.agents[0].agentType = 'not-a-real-agent-type-xyz';
    const r: any = await tool.handler({ podTemplate: withUnknown });
    expect(r.success).toBe(true);
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/not-a-real-agent-type-xyz/);
  });
});

describe('Phase 3 — domain-affinity policy (selectAgentBackend)', () => {
  // Synthesize the four combinations of (preferLocalExecution × budget vs threshold)
  // off the sales template — keeps the test independent of pod-file edits.
  const base = clone(salesJson) as PodTemplate;

  it('preferLocalExecution=true → local-stdio regardless of budget', () => {
    const t = { ...base, preferLocalExecution: true, budgetUsdMonthly: 999 };
    const d = selectAgentBackend(t);
    expect(d.backend).toBe('local-stdio');
    expect(d.reason).toMatch(/local stdio/);
  });

  it('preferLocalExecution=true → local-stdio even with budget=0', () => {
    const t = { ...base, preferLocalExecution: true, budgetUsdMonthly: 0, budgetUsdPerRun: 0 };
    const d = selectAgentBackend(t);
    expect(d.backend).toBe('local-stdio');
  });

  it(`preferLocalExecution=false AND budgetUsdMonthly >= ${CLOUD_BUDGET_THRESHOLD_USD} → cloud-managed`, () => {
    const t = {
      ...base,
      preferLocalExecution: false,
      budgetUsdMonthly: CLOUD_BUDGET_THRESHOLD_USD,
    };
    const d = selectAgentBackend(t);
    expect(d.backend).toBe('cloud-managed');
    expect(d.reason).toMatch(/cloud Managed Agents/);
  });

  it(`preferLocalExecution=false AND budgetUsdMonthly < ${CLOUD_BUDGET_THRESHOLD_USD} → remote-peer`, () => {
    const t = {
      ...base,
      preferLocalExecution: false,
      budgetUsdMonthly: CLOUD_BUDGET_THRESHOLD_USD - 1,
      budgetUsdPerRun: 0.05,
    };
    const d = selectAgentBackend(t);
    expect(d.backend).toBe('remote-peer');
    expect(d.reason).toMatch(/federation peer node/);
  });

  it('rejects malformed input (non-object)', () => {
    expect(() => selectAgentBackend(null as any)).toThrow(/must be a validated PodTemplate/);
    expect(() => selectAgentBackend('not a pod' as any)).toThrow(/must be a validated PodTemplate/);
  });

  it('rejects pod missing preferLocalExecution', () => {
    const t: any = { ...base };
    delete t.preferLocalExecution;
    expect(() => selectAgentBackend(t)).toThrow(/preferLocalExecution must be boolean/);
  });

  it('rejects pod with non-finite budgetUsdMonthly', () => {
    const t: any = { ...base, budgetUsdMonthly: Number.NaN };
    expect(() => selectAgentBackend(t)).toThrow(/budgetUsdMonthly must be a finite number/);
  });
});

describe('Phase 3 — business_pod_route_backend MCP tool', () => {
  it('routes the sales template per §3.4 rules', async () => {
    const tool = findTool('business_pod_route_backend');
    const r: any = await tool.handler({ podTemplate: salesJson });
    expect(r.success).toBe(true);
    expect(r.valid).toBe(true);
    // sales has preferLocalExecution=false and budgetUsdMonthly=50 → cloud-managed.
    expect(r.backend).toBe('cloud-managed');
    expect(r.pod.name).toBe('sales');
    expect(r.pod.budgetUsdMonthly).toBe(50);
    expect(r.reason).toMatch(/cloud Managed Agents/);
  });

  it('routes the marketing template (budget=40, preferLocal=false) to remote-peer', async () => {
    const tool = findTool('business_pod_route_backend');
    const r: any = await tool.handler({ podTemplate: loadJson('marketing') });
    expect(r.success).toBe(true);
    expect(r.backend).toBe('remote-peer');
  });

  it('routes the finance template (preferLocal=true) to local-stdio', async () => {
    const tool = findTool('business_pod_route_backend');
    const r: any = await tool.handler({ podTemplate: loadJson('finance') });
    expect(r.success).toBe(true);
    expect(r.backend).toBe('local-stdio');
  });

  it('accepts a podTemplatePath string and resolves it', async () => {
    const tool = findTool('business_pod_route_backend');
    const r: any = await tool.handler({
      podTemplatePath: resolve(TEMPLATES_DIR, 'hr.json'),
    });
    expect(r.success).toBe(true);
    expect(r.backend).toBe('local-stdio');
    expect(r.pod.name).toBe('hr');
  });

  it('rejects malformed input (no podTemplate and no podTemplatePath)', async () => {
    const tool = findTool('business_pod_route_backend');
    const r: any = await tool.handler({});
    expect(r.success).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/podTemplate.*or.*podTemplatePath/);
  });

  it('rejects a malformed pod template with structured error path', async () => {
    const tool = findTool('business_pod_route_backend');
    const bad = clone(salesJson) as any;
    bad.reservationExpiryMs = 1;
    const r: any = await tool.handler({ podTemplate: bad });
    expect(r.success).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/reservationExpiryMs/);
    expect(r.path).toBe('/');
  });
});
