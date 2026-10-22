import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MonitoringHooks } from '../v3/@claude-flow/cli/src/production/monitoring.ts';
test('exported metrics do not alias stored values or labels', () => {
 const m = new MonitoringHooks(); m.counter('read', 1, { route: 'original' }); const row = m.getMetrics('read')[0]; row.value = 999; row.labels.route = 'changed'; assert.equal(m.getMetrics('read')[0].value, 1); assert.equal(m.getMetrics('read')[0].labels.route, 'original');
});
test('exported alerts do not acknowledge live alerts through mutation', () => {
 const m = new MonitoringHooks({ alertThresholds: { load: { warning: 1, critical: 2 } } }); m.gauge('load', 3); const alert = m.getAlerts()[0]; alert.acknowledged = true; assert.equal(m.getAlerts().length, 1); assert.equal(m.acknowledgeAlert(alert.id), true); assert.equal(m.getAlerts().length, 0);
});
test('health status results do not alias live checks', async () => {
 const m = new MonitoringHooks(); m.registerHealthCheck('db', async () => ({ healthy: true })); const result = await m.runHealthChecks(); result.checks.db.status = 'unhealthy'; const status = m.getHealthStatus(); assert.equal(status.checks.db.status, 'healthy'); status.checks.db.message = 'changed'; assert.equal(m.getHealthStatus().checks.db.message, undefined);
});
