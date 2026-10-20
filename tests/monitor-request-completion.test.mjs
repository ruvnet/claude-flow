import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MonitoringHooks } from '../v3/@claude-flow/cli/src/production/monitoring.ts';
test('request completion is idempotent', () => {
 const m = new MonitoringHooks(); const end = m.startRequest('one'); end(); end();
 assert.equal(m.getPerformanceMetrics().activeRequests, 0);
 assert.equal(m.getMetrics('response_time_ms').length, 1);
});
test('completion from before reset cannot corrupt the new monitoring interval', () => {
 const m = new MonitoringHooks(); const oldEnd = m.startRequest('old'); m.reset(); const end = m.startRequest('new'); oldEnd();
 assert.equal(m.getPerformanceMetrics().activeRequests, 1);
 assert.equal(m.getMetrics('response_time_ms').length, 0);
 end(); assert.equal(m.getPerformanceMetrics().activeRequests, 0);
});
