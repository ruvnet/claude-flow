/**
 * Tests for business_pod_validate MCP tool + pod-schema validator
 * (ADR-164 Phase 2, ADR-164.1 reservationExpiryMs bound).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { businessPodTools } from '../src/mcp-tools/business-pod-tools.js';
import {
  validatePodTemplate,
  PodTemplateValidationError,
} from '../src/business-pods/pod-schema.js';

function findTool(name: string) {
  const t = businessPodTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

const SALES_TEMPLATE_PATH = resolve(
  __dirname,
  '../../../../plugins/ruflo-business-pods/templates/sales.json',
);
const salesJson = JSON.parse(readFileSync(SALES_TEMPLATE_PATH, 'utf-8'));

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
    const t = clone(salesJson);
    t.name = 'Sales Pod';
    expect(() => validatePodTemplate(t)).toThrow(/lowercase-kebab/);
  });

  it('rejects empty agents array', () => {
    const t = clone(salesJson);
    t.agents = [];
    expect(() => validatePodTemplate(t)).toThrow(/agents must have ≥1 entry/);
  });

  it('rejects empty allowedMcpTools array', () => {
    const t = clone(salesJson);
    t.allowedMcpTools = [];
    expect(() => validatePodTemplate(t)).toThrow(/allowedMcpTools must have ≥1 entry/);
  });

  it('rejects empty bench.successCriteria', () => {
    const t = clone(salesJson);
    t.bench.successCriteria = [];
    expect(() => validatePodTemplate(t)).toThrow(/successCriteria must have ≥1 entry/);
  });

  it('rejects invalid piiPolicy', () => {
    const t = clone(salesJson);
    t.piiPolicy = 'invalid';
    expect(() => validatePodTemplate(t)).toThrow(/piiPolicy must be one of/);
  });

  it('rejects malformed cronSchedule', () => {
    const t = clone(salesJson);
    t.cronSchedule = 'every six hours';
    expect(() => validatePodTemplate(t)).toThrow(/cronSchedule must be a POSIX cron expression/);
  });

  it('rejects budgetUsdPerRun exceeding budgetUsdMonthly', () => {
    const t = clone(salesJson);
    t.budgetUsdPerRun = 100;
    t.budgetUsdMonthly = 50;
    expect(() => validatePodTemplate(t)).toThrow(/budgetUsdPerRun must not exceed budgetUsdMonthly/);
  });

  it('rejects negative budgets', () => {
    const t = clone(salesJson);
    t.budgetUsdMonthly = -1;
    expect(() => validatePodTemplate(t)).toThrow(/budgetUsdMonthly must be ≥0/);
  });

  it('ADR-164.1 §3.2 — reservationExpiryMs below 5000 ms is rejected', () => {
    const t = clone(salesJson);
    t.reservationExpiryMs = 1000;
    expect(() => validatePodTemplate(t)).toThrow(/reservationExpiryMs must be within \[5000, 300000\] ms/);
  });

  it('ADR-164.1 §3.2 — reservationExpiryMs above 300000 ms is rejected', () => {
    const t = clone(salesJson);
    t.reservationExpiryMs = 600_000;
    expect(() => validatePodTemplate(t)).toThrow(/reservationExpiryMs must be within \[5000, 300000\] ms/);
  });

  it('reservationExpiryMs is optional — omitting it validates', () => {
    const t = clone(salesJson);
    delete t.reservationExpiryMs;
    expect(() => validatePodTemplate(t)).not.toThrow();
  });

  it('accepts the Phase 2 sales.json template verbatim', () => {
    const t = validatePodTemplate(salesJson);
    expect(t.name).toBe('sales');
    expect(t.roomId).toBe('sales');
    expect(t.agents.length).toBe(4);
    expect(t.piiPolicy).toBe('soc2');
    expect(t.budgetUsdMonthly).toBe(50);
    expect(t.reservationExpiryMs).toBe(60_000);
  });
});

describe('business_pod_validate MCP tool', () => {
  it('exposes exactly 1 tool with required schema shape', () => {
    expect(businessPodTools.length).toBe(1);
    const t = businessPodTools[0];
    expect(t.name).toBe('business_pod_validate');
    expect(t.inputSchema.type).toBe('object');
    expect(t.inputSchema.properties).toBeDefined();
    expect(typeof t.handler).toBe('function');
    // ADR-112 — description must be ≥80 chars and carry use-when guidance.
    expect(t.description.length).toBeGreaterThanOrEqual(80);
    expect(t.description).toMatch(/Use when/i);
    expect(t.description).toMatch(/wrong because/i);
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
    const bad = clone(salesJson);
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
    const withUnknown = clone(salesJson);
    withUnknown.agents[0].agentType = 'not-a-real-agent-type-xyz';
    const r: any = await tool.handler({ podTemplate: withUnknown });
    expect(r.success).toBe(true);
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/not-a-real-agent-type-xyz/);
  });
});
