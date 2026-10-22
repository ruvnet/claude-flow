import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MonitoringHooks } from '../v3/@claude-flow/cli/src/production/monitoring.ts';
test('critical readings escalate an existing warning instead of being suppressed', () => {
 const m = new MonitoringHooks({ alertThresholds: { load: { warning: 10, critical: 20 } } });
 m.gauge('load', 11); const id = m.getAlerts()[0].id;
 m.gauge('load', 25);
 const alerts = m.getAlerts(); assert.equal(alerts.length, 1); assert.equal(alerts[0].id, id); assert.equal(alerts[0].level, 'critical'); assert.equal(alerts[0].value, 25); assert.equal(alerts[0].threshold, 20); assert.match(alerts[0].message, /critical/);
 m.gauge('load', 12); assert.equal(m.getAlerts()[0].level, 'critical');
});
test('repeated warning readings stay deduplicated', () => {
 const m = new MonitoringHooks({ alertThresholds: { load: { warning: 10, critical: 20 } } }); m.gauge('load', 11); m.gauge('load', 12); assert.equal(m.getAlerts().length, 1);
});
