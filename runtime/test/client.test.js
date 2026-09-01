import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeClient } from '../src/client.js';

test('approval resolved at the timeout boundary is accepted', async () => {
  const client = new RuntimeClient({ baseUrl: 'https://example.invalid', token: 'test' });
  client.requestPermission = async () => ({ requestId: 'permission-1', status: 'pending' });
  client.expirePermission = async () => {
    const error = new Error('already resolved');
    error.status = 409;
    throw error;
  };
  client.permissionStatus = async () => ({ status: 'allowed', decision: 'allow_once' });

  const result = await client.ensurePermission({}, { timeoutMs: 0, pollMs: 1 });
  assert.equal(result.status, 'allowed');
  assert.equal(result.requestId, 'permission-1');
});
