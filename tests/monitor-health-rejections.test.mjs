import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MonitoringHooks } from '../v3/@claude-flow/cli/src/production/monitoring.ts';
test('non-Error health failures are recorded without aborting later checks', async () => {
 const m = new MonitoringHooks();
 for (const [name, value] of [['null', null], ['undefined', undefined], ['string', 'offline']]) m.registerHealthCheck(name, async () => { throw value; });
 m.registerHealthCheck('healthy', async () => ({ healthy: true }));
 const result = await m.runHealthChecks();
 assert.equal(result.healthy, false);
 for (const [name, value] of [['null', null], ['undefined', undefined], ['string', 'offline']]) { assert.equal(result.checks[name].status, 'unhealthy'); assert.equal(result.checks[name].message, String(value)); }
 assert.equal(result.checks.healthy.status, 'healthy');
});
test('Error rejection retains the original message', async () => {
 const m = new MonitoringHooks(); m.registerHealthCheck('error', async () => { throw new Error('unavailable'); });
 assert.equal((await m.runHealthChecks()).checks.error.message, 'unavailable');
});
