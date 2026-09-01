import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('API authentication, ownership checks, and secret scrubbing work together', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusflow-api-test-'));
  const modelRequests = [];
  const localModelServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      modelRequests.push({ url: req.url, authorization: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'local response' } }] }));
    });
  });
  await new Promise(resolve => localModelServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => localModelServer.close(resolve)));
  const localModelAddress = localModelServer.address();
  const localModelUrl = `http://127.0.0.1:${localModelAddress.port}/v1/chat/completions`;
  process.env.JWT_SECRET = 'integration-test-secret-that-is-long-enough-2026';
  process.env.BCRYPT_ROUNDS = '4';
  process.env.DATABASE_PATH = ':memory:';
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  process.env.LOCAL_MODEL_URL = localModelUrl;
  process.env.ALLOW_PRIVATE_NETWORK_REQUESTS = 'true';
  process.env.MODEL_CONFIG_ENCRYPTION_KEY = 'integration-model-encryption-key-that-is-long-enough';

  const { app, vectorDB } = await import(`../src/index.js?test=${Date.now()}`);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await vectorDB.close();
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    delete process.env.DATABASE_PATH;
    delete process.env.BCRYPT_ROUNDS;
    delete process.env.LOCAL_MODEL_URL;
    delete process.env.ALLOW_PRIVATE_NETWORK_REQUESTS;
    delete process.env.MODEL_CONFIG_ENCRYPTION_KEY;
  });

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);

  const anonymous = await fetch(`${baseUrl}/api/workflows`);
  assert.equal(anonymous.status, 401);

  async function register(username, email) {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ username, email, password: 'correct horse battery staple' }),
    });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /nexusflow_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    return { data: await response.json(), cookie: setCookie.split(';')[0] };
  }

  const owner = await register('owner_api', 'owner-api@example.com');
  const other = await register('other_api', 'other-api@example.com');
  assert.equal(owner.data.token, undefined);
  const ownerHeaders = {
    Cookie: owner.cookie,
    Origin: 'http://localhost:5173',
    'Content-Type': 'application/json',
  };

  const currentUser = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: owner.cookie } });
  assert.equal(currentUser.status, 200);
  assert.equal((await currentUser.json()).user.username, 'owner_api');

  const emptyModelConfig = await fetch(`${baseUrl}/api/model-config`, { headers: ownerHeaders });
  assert.equal(emptyModelConfig.status, 200);
  assert.deepEqual(await emptyModelConfig.json(), {
    configured: false, baseUrl: '', model: '', embeddingModel: '', hasApiKey: false,
  });

  const missingOrigin = await fetch(`${baseUrl}/api/workflows`, {
    method: 'POST',
    headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Blocked workflow', nodes: [], edges: [] }),
  });
  assert.equal(missingOrigin.status, 403);

  const localChat = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      provider: 'local',
      apiUrl: localModelUrl,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });
  assert.equal(localChat.status, 200);
  assert.equal((await localChat.json()).choices[0].message.content, 'local response');

  const accountSecret = 'account-model-secret';
  const saveModelConfig = await fetch(`${baseUrl}/api/model-config`, {
    method: 'PUT',
    headers: ownerHeaders,
    body: JSON.stringify({
      baseUrl: `http://127.0.0.1:${localModelAddress.port}/v1`,
      model: 'account-chat-model',
      embeddingModel: 'account-embedding-model',
      apiKey: accountSecret,
    }),
  });
  assert.equal(saveModelConfig.status, 200);
  const savedPublicConfig = await saveModelConfig.json();
  assert.equal(savedPublicConfig.configured, true);
  assert.equal(savedPublicConfig.hasApiKey, true);
  assert.equal(JSON.stringify(savedPublicConfig).includes(accountSecret), false);
  const storedModelConfig = await vectorDB.getUserModelConfig(owner.data.user.id);
  assert.equal(storedModelConfig.api_key_encrypted.includes(accountSecret), false);

  const accountChat = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      provider: 'qwen',
      model: 'ignored-workflow-model',
      messages: [{ role: 'user', content: 'use account config' }],
    }),
  });
  assert.equal(accountChat.status, 200);
  assert.equal(modelRequests.at(-1).url, '/v1/chat/completions');
  assert.equal(modelRequests.at(-1).authorization, `Bearer ${accountSecret}`);
  assert.equal(modelRequests.at(-1).body.model, 'account-chat-model');

  const preserveKeyUpdate = await fetch(`${baseUrl}/api/model-config`, {
    method: 'PUT',
    headers: ownerHeaders,
    body: JSON.stringify({
      baseUrl: `http://127.0.0.1:${localModelAddress.port}/v1`,
      model: 'updated-account-model',
      embeddingModel: '',
      apiKey: '',
    }),
  });
  assert.equal(preserveKeyUpdate.status, 200);
  const otherModelConfig = await fetch(`${baseUrl}/api/model-config`, {
    headers: { Cookie: other.cookie, Origin: 'http://localhost:5173' },
  });
  assert.equal((await otherModelConfig.json()).configured, false);

  const createResponse = await fetch(`${baseUrl}/api/workflows`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      name: 'Secure workflow',
      nodes: [{ id: 'llm', data: { config: { apiKey: 'must-not-persist' } } }],
      edges: [],
    }),
  });
  assert.equal(createResponse.status, 200);
  const created = await createResponse.json();
  assert.equal(created.workflow.nodes[0].data.config.apiKey, '');

  const takeover = await fetch(`${baseUrl}/api/workflows/${created.workflow.id}`, {
    method: 'PUT',
    headers: {
      Cookie: other.cookie,
      Origin: 'http://localhost:5173',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Hijacked', nodes: [], edges: [] }),
  });
  assert.equal(takeover.status, 404);

  const ownerRead = await fetch(`${baseUrl}/api/workflows/${created.workflow.id}`, { headers: ownerHeaders });
  assert.equal(ownerRead.status, 200);
  assert.equal((await ownerRead.json()).workflow.name, 'Secure workflow');

  const pairDevice = await fetch(`${baseUrl}/api/runtime/devices`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ name: 'Test AI PC' }),
  });
  assert.equal(pairDevice.status, 201);
  const pairing = await pairDevice.json();
  assert.match(pairing.token, /^nfr_/);
  const storedDevice = await vectorDB.get('SELECT token_hash FROM runtime_devices WHERE id = ?', [pairing.device.id]);
  assert.equal(storedDevice.token_hash.includes(pairing.token), false);

  const agentHeaders = { Authorization: `Bearer ${pairing.token}`, 'Content-Type': 'application/json' };
  const heartbeat = await fetch(`${baseUrl}/api/runtime/agent/heartbeat`, {
    method: 'POST', headers: agentHeaders, body: JSON.stringify({ capabilities: { platform: 'test', writesEnabled: false } }),
  });
  assert.equal(heartbeat.status, 200);

  const queueRun = await fetch(`${baseUrl}/api/runtime/runs`, {
    method: 'POST', headers: ownerHeaders,
    body: JSON.stringify({ workflowId: created.workflow.id, deviceId: pairing.device.id, input: { query: 'runtime query' } }),
  });
  assert.equal(queueRun.status, 201);
  const queued = (await queueRun.json()).run;
  const otherRunRead = await fetch(`${baseUrl}/api/runtime/runs/${queued.id}`, {
    headers: { Cookie: other.cookie, Origin: 'http://localhost:5173' },
  });
  assert.equal(otherRunRead.status, 404);

  const claim = await fetch(`${baseUrl}/api/runtime/agent/jobs/claim`, { method: 'POST', headers: agentHeaders, body: '{}' });
  assert.equal(claim.status, 200);
  assert.equal((await claim.json()).job.id, queued.id);
  assert.equal((await fetch(`${baseUrl}/api/runtime/agent/runs/${queued.id}/start`, { method: 'POST', headers: agentHeaders, body: '{}' })).status, 200);
  const agentModel = await fetch(`${baseUrl}/api/runtime/agent/model/chat`, {
    method: 'POST', headers: agentHeaders,
    body: JSON.stringify({ messages: [{ role: 'user', content: 'runtime model call' }] }),
  });
  assert.equal(agentModel.status, 200);
  assert.equal((await agentModel.json()).text, 'local response');
  const permissionRequest = await fetch(`${baseUrl}/api/runtime/agent/permissions/request`, {
    method: 'POST', headers: agentHeaders,
    body: JSON.stringify({
      runId: queued.id, nodeId: 'file-node', capability: 'file.read',
      actionLabel: '读取本地文本文件', context: { path: '/safe/note.txt', access: 'read' },
    }),
  });
  assert.equal(permissionRequest.status, 201);
  const permission = await permissionRequest.json();
  assert.equal(permission.status, 'pending');
  const otherPermissions = await fetch(`${baseUrl}/api/runtime/permissions`, {
    headers: { Cookie: other.cookie, Origin: 'http://localhost:5173' },
  });
  assert.equal((await otherPermissions.json()).requests.length, 0);
  const otherResolve = await fetch(`${baseUrl}/api/runtime/permissions/${permission.requestId}/resolve`, {
    method: 'POST', headers: { Cookie: other.cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'allow_always' }),
  });
  assert.equal(otherResolve.status, 409);
  const ownerResolve = await fetch(`${baseUrl}/api/runtime/permissions/${permission.requestId}/resolve`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ decision: 'allow_always' }),
  });
  assert.equal(ownerResolve.status, 200);
  const permissionStatus = await fetch(`${baseUrl}/api/runtime/agent/permissions/${permission.requestId}/status`, {
    method: 'POST', headers: agentHeaders, body: '{}',
  });
  assert.equal((await permissionStatus.json()).status, 'allowed');
  const autoGrantedRequest = await fetch(`${baseUrl}/api/runtime/agent/permissions/request`, {
    method: 'POST', headers: agentHeaders,
    body: JSON.stringify({
      runId: queued.id, nodeId: 'file-node-2', capability: 'file.read',
      actionLabel: '读取本地文本文件', context: { path: '/safe/second.txt' },
    }),
  });
  assert.equal(autoGrantedRequest.status, 200);
  assert.equal((await autoGrantedRequest.json()).decision, 'existing_grant');
  const permissionCenter = await fetch(`${baseUrl}/api/runtime/permissions`, { headers: ownerHeaders });
  const permissionCenterData = await permissionCenter.json();
  assert.equal(permissionCenterData.grants.length, 1);
  assert.equal(permissionCenterData.requests.length, 2);
  const revokeGrant = await fetch(`${baseUrl}/api/runtime/permissions/grants/${permissionCenterData.grants[0].id}`, {
    method: 'DELETE', headers: ownerHeaders,
  });
  assert.equal(revokeGrant.status, 200);
  const trace = await fetch(`${baseUrl}/api/runtime/agent/runs/${queued.id}/steps`, {
    method: 'POST', headers: agentHeaders,
    body: JSON.stringify({ nodeId: 'start', nodeType: 'start', nodeLabel: '开始', status: 'done', input: {}, output: { mode: 'local' }, durationMs: 1 }),
  });
  assert.equal(trace.status, 201);
  const finish = await fetch(`${baseUrl}/api/runtime/agent/runs/${queued.id}/complete`, {
    method: 'POST', headers: agentHeaders,
    body: JSON.stringify({ status: 'succeeded', output: { answer: 'done' } }),
  });
  assert.equal(finish.status, 200);
  const runDetail = await fetch(`${baseUrl}/api/runtime/runs/${queued.id}`, { headers: ownerHeaders });
  const runDetailData = (await runDetail.json()).run;
  assert.equal(runDetailData.status, 'succeeded');
  assert.equal(runDetailData.steps.length, 1);
  assert.equal(runDetailData.steps[0].output.mode, 'local');

  const revokeDevice = await fetch(`${baseUrl}/api/runtime/devices/${pairing.device.id}`, { method: 'DELETE', headers: ownerHeaders });
  assert.equal(revokeDevice.status, 200);
  const revokedHeartbeat = await fetch(`${baseUrl}/api/runtime/agent/heartbeat`, {
    method: 'POST', headers: agentHeaders, body: '{}',
  });
  assert.equal(revokedHeartbeat.status, 401);

  const clearModelConfig = await fetch(`${baseUrl}/api/model-config`, { method: 'DELETE', headers: ownerHeaders });
  assert.equal(clearModelConfig.status, 200);
  assert.equal((await vectorDB.getUserModelConfig(owner.data.user.id)), undefined);
});
