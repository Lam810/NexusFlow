import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeFetch, RuntimeClient } from '../src/client.js';

test('runtime fetch honors standard proxy variables and lowercase precedence', async () => {
  const calls = [];
  const dispatcher = { kind: 'test-proxy' };
  let proxyOptions;
  const runtimeFetch = createRuntimeFetch({
    environment: {
      HTTP_PROXY: 'http://uppercase-proxy.example:8080',
      http_proxy: 'http://lowercase-proxy.example:8080',
      HTTPS_PROXY: 'http://secure-proxy.example:8080',
      NO_PROXY: 'localhost,.internal.example',
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true };
    },
    proxyAgentFactory: options => {
      proxyOptions = options;
      return dispatcher;
    },
  });

  await runtimeFetch('https://nexusflow.example/api/health', { method: 'GET' });

  assert.deepEqual(proxyOptions, {
    httpProxy: 'http://lowercase-proxy.example:8080',
    httpsProxy: 'http://secure-proxy.example:8080',
    noProxy: 'localhost,.internal.example',
  });
  assert.equal(calls[0].init.dispatcher, dispatcher);
});

test('runtime fetch avoids creating a proxy dispatcher without proxy variables', async () => {
  let factoryCalled = false;
  const fetchImpl = async () => ({ ok: true });
  const runtimeFetch = createRuntimeFetch({
    environment: { NO_PROXY: '*' },
    fetchImpl,
    proxyAgentFactory: () => {
      factoryCalled = true;
      return {};
    },
  });

  assert.equal(runtimeFetch, fetchImpl);
  assert.equal(factoryCalled, false);
});

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
