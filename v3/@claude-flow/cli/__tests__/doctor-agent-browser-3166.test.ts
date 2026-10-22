/** ADR-122 Phase 0: doctor reports the local browser runtime without launching it. */
import { describe, expect, it } from 'vitest';
import {
  checkAgentBrowserVersion,
  doctorCommand,
  evaluateAgentBrowserVersion,
} from '../src/commands/doctor.js';

describe('#3166 agent-browser doctor check', () => {
  it('passes a supported version and names the browser integration', () => {
    const check = evaluateAgentBrowserVersion('agent-browser v0.37.1\n');
    expect(check.status).toBe('pass');
    expect(check.message).toContain('v0.37.1');
    expect(check.message).toContain('browser MCP tools');
    expect(evaluateAgentBrowserVersion('0.27.0').status).toBe('pass');
  });

  it('warns below 0.27 and on an older prerelease', () => {
    for (const output of ['agent-browser 0.26.9', 'v0.27.0-rc.1']) {
      const check = evaluateAgentBrowserVersion(output);
      expect(check.status).toBe('warn');
      expect(check.fix).toContain('agent-browser');
    }
  });

  it('warns when the version output is empty or unparsable', () => {
    for (const output of ['', 'agent-browser version unknown']) {
      expect(evaluateAgentBrowserVersion(output).status).toBe('warn');
    }
  });

  it('warns when the executable is missing or the bounded probe fails', async () => {
    const missing = await checkAgentBrowserVersion(async () => {
      throw Object.assign(new Error('spawn agent-browser ENOENT'), { code: 'ENOENT' });
    });
    expect(missing.status).toBe('warn');
    expect(missing.message).toContain('Not found on PATH');

    const failed = await checkAgentBrowserVersion(async () => {
      throw new Error('probe timed out');
    });
    expect(failed.status).toBe('warn');
    expect(failed.message).toContain('probe timed out');
  });

  it('exposes the check through doctor --component browser', async () => {
    const ctx = {
      flags: { component: 'browser' }, args: [], config: {},
    } as unknown as Parameters<NonNullable<typeof doctorCommand.action>>[0];
    const result = await doctorCommand.action!(ctx);
    const data = result.data as { results: Array<{ name: string; status: string }> };
    expect(data.results).toHaveLength(1);
    expect(data.results[0].name).toBe('agent-browser CLI (ADR-122)');
    expect(['pass', 'warn']).toContain(data.results[0].status);
  });
});
