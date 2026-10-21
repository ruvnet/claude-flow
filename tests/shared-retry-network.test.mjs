import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { RetryableErrors } from '../v3/@claude-flow/shared/src/resilience/retry.ts';
test('actual socket hang-up errors use their structured Node error code', async () => {
 const server = createServer(req => req.socket.destroy());
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 try {
  const error = await new Promise(resolve => get(`http://127.0.0.1:${server.address().port}`, response => { response.resume(); resolve(new Error('unexpected response')); }).on('error', resolve));
  assert.equal(error.code, 'ECONNRESET'); assert.equal(RetryableErrors.network(error), true); assert.equal(RetryableErrors.transient(error), true);
 } finally { await new Promise(resolve => server.close(resolve)); }
});
test('message matching stays supported and non-network codes are excluded', () => {
 assert.equal(RetryableErrors.network(new Error('ECONNREFUSED')), true);
 assert.equal(RetryableErrors.network(Object.assign(new Error('missing file'), { code: 'ENOENT' })), false);
});
