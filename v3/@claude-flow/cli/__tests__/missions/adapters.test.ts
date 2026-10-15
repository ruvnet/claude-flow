/**
 * ADR-406 M1 — CLI and MCP adapters are thin transports over one service
 * (London school: the service port is mocked; the adapters must forward input
 * unchanged, pick the project root from trusted context, and add nothing).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMissionTools, type MissionPort } from '../../src/mcp-tools/mission-tools.js';
import { inputFromFlags, missionCommand, setMissionPortFactory } from '../../src/commands/mission.js';
import { classifyMcpTool } from '../../src/services/policy-runtime.js';

function mockPort(): MissionPort & Record<string, ReturnType<typeof vi.fn>> {
  const reply = vi.fn(async () => ({ ok: true as const, data: { stub: true } }));
  return { create: reply, plan: vi.fn(reply), get: vi.fn(reply), events: vi.fn(reply), requestAction: vi.fn(reply) } as never;
}

afterEach(() => setMissionPortFactory(null));

describe('MCP mission tools', () => {
  it('forward input unchanged to the port for the context project root', async () => {
    const port = mockPort();
    const factory = vi.fn(() => port);
    const tools = Object.fromEntries(createMissionTools(factory).map((t) => [t.name, t]));
    expect(Object.keys(tools).sort()).toEqual(['mission_create', 'mission_events', 'mission_get', 'mission_plan', 'mission_request_action']);
    const input = { requestId: 'r', missionId: `msn_${'b'.repeat(24)}`, expectedRevision: 3, action: 'cancel', approved: true };
    await tools.mission_request_action.handler(input, { projectRoot: '/proj' });
    expect(factory).toHaveBeenCalledWith('/proj');
    // The adapter neither strips nor interprets `approved`; the service schema rejects it.
    expect(port.requestAction).toHaveBeenCalledWith(input);
  });

  it('are classified by the existing policy runtime like any MCP tool (no bypass)', () => {
    for (const name of ['mission_create', 'mission_plan', 'mission_get', 'mission_events', 'mission_request_action']) {
      expect(classifyMcpTool(name).actionType).toBe('mcp.tool.call');
    }
  });
});

describe('CLI mission command', () => {
  it('maps flags to the same raw input shape the MCP tools take', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-mission-cli-'));
    try {
      writeFileSync(join(dir, 'plan.json'), JSON.stringify({ tasks: [] }));
      expect(inputFromFlags('plan', { requestId: 'r1', mission: 'msn_x', expectedRevision: '2', planFile: 'plan.json' }, dir))
        .toEqual({ requestId: 'r1', missionId: 'msn_x', expectedRevision: 2, plan: { tasks: [] } });
      expect(inputFromFlags('events', { mission: 'msn_x', after: '5' }, dir)).toEqual({ missionId: 'msn_x', afterSequence: 5 });
      const created = inputFromFlags('create', { objective: 'o' }, dir);
      expect(created.requestId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('delegates to the port and reports conflicts with a distinct exit code', async () => {
    const port = mockPort();
    port.plan.mockResolvedValueOnce({ ok: false, code: 'revision-conflict', message: 'm', currentRevision: 4 });
    setMissionPortFactory(() => port);
    const r = await missionCommand.action!({ args: ['plan'], flags: { _: [], requestId: 'r', mission: 'msn_x', expectedRevision: 1 }, cwd: '/tmp', interactive: false });
    expect(port.plan).toHaveBeenCalledWith({ requestId: 'r', missionId: 'msn_x', expectedRevision: 1 });
    expect(r).toMatchObject({ success: false, exitCode: 3 });
    const unknown = await missionCommand.action!({ args: ['explode'], flags: { _: [] }, cwd: '/tmp', interactive: false });
    expect(unknown).toMatchObject({ success: false, exitCode: 1 });
  });
});
