import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createClient } from '@libsql/client';
import VectorDB from '../src/vectorDB.js';

test('workflow updates and stored data remain scoped to their owner', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusflow-test-'));
  const db = new VectorDB(':memory:');
  t.after(async () => {
    await db.close();
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const owner = await db.createUser('owner', 'owner@example.com', 'hash');
  const other = await db.createUser('other', 'other@example.com', 'hash');
  await db.createWorkflow(owner.id, 'workflow-1', 'Owner workflow', [], []);

  assert.equal(await db.updateWorkflow(other.id, 'workflow-1', 'Hijacked', [], []), null);
  assert.equal((await db.getWorkflow(owner.id, 'workflow-1')).name, 'Owner workflow');
  assert.equal(await db.getWorkflow(other.id, 'workflow-1'), null);

  await db.insertFile(owner.id, {
    id: 'file-1', filename: 'private.txt', original_text: 'private', file_size: 7, file_type: 'txt', chunk_count: 1,
  });
  await db.insertDocument(owner.id, {
    id: 'doc-1', filename: 'private.txt', original_text: 'private', chunk_index: 0, chunk_text: 'private', embedding: [1, 0], file_size: 7, file_type: 'txt',
  });

  assert.equal((await db.getAllFiles(owner.id)).length, 1);
  assert.equal((await db.getAllFiles(other.id)).length, 0);
  assert.equal((await db.getAllDocuments(other.id)).length, 0);
  assert.deepEqual(await db.deleteFile(other.id, 'private.txt'), { docsDeleted: 0, fileDeleted: 0 });
  assert.equal((await db.getAllFiles(owner.id)).length, 1);

  await db.addDynamicData(owner.id, 'Private note', 'owner only', [1, 0]);
  assert.equal((await db.getAllDynamicData(owner.id)).length, 1);
  assert.equal((await db.getAllDynamicData(other.id)).length, 0);
  assert.equal(await db.clearAllDynamicData(other.id), 0);

  await db.saveChatHistory(owner.id, 'workflow-1', 'question', 'answer', [1, 0], Date.now());
  assert.equal((await db.getChatHistory(owner.id, 'workflow-1')).length, 1);
  assert.equal((await db.getChatHistory(other.id, 'workflow-1')).length, 0);
  assert.equal(await db.clearChatHistory(other.id, 'workflow-1'), 0);
});

test('legacy document tables gain tenant columns during startup migration', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusflow-migration-test-'));
  const legacy = createClient({ url: ':memory:' });
  await legacy.batch([
    `CREATE TABLE documents (
      id TEXT PRIMARY KEY, filename TEXT, original_text TEXT, chunk_index INTEGER,
      chunk_text TEXT, embedding BLOB, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      file_size INTEGER, file_type TEXT
    )`,
    `CREATE TABLE files (
      id TEXT PRIMARY KEY, filename TEXT, original_text TEXT, file_size INTEGER,
      file_type TEXT, chunk_count INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  ], 'write');
  const db = new VectorDB({ url: ':memory:', client: legacy });
  t.after(async () => {
    await db.close();
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const documentColumns = (await db.all('PRAGMA table_info(documents)')).map(column => column.name);
  const fileColumns = (await db.all('PRAGMA table_info(files)')).map(column => column.name);
  assert.ok(documentColumns.includes('user_id'));
  assert.ok(fileColumns.includes('user_id'));
});

test('runtime devices and run traces remain tenant and device scoped', async t => {
  const db = new VectorDB(':memory:');
  t.after(() => db.close());
  const owner = await db.createUser('runtime_owner', 'runtime-owner@example.com', 'hash');
  const other = await db.createUser('runtime_other', 'runtime-other@example.com', 'hash');
  await db.createWorkflow(owner.id, 'workflow-runtime', 'Runtime flow', [{ id: 'start' }], []);
  const token = 'nfr_test-token';
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const device = await db.createRuntimeDevice(owner.id, {
    id: 'device-runtime', name: 'AI PC', tokenHash, capabilities: { platform: 'test' },
  });
  assert.equal(device.name, 'AI PC');
  assert.equal((await db.getRuntimeDeviceByTokenHash(tokenHash)).id, device.id);
  assert.equal((await db.getRuntimeDevices(other.id)).length, 0);

  await db.createWorkflowRun(owner.id, {
    id: 'run-runtime', workflowId: 'workflow-runtime', deviceId: device.id,
    input: { query: 'hello' }, workflowSnapshot: { name: 'Runtime flow', nodes: [], edges: [] },
  });
  assert.equal(await db.getWorkflowRun(other.id, 'run-runtime'), null);
  const claimed = await db.claimWorkflowRun({ ...device, user_id: owner.id });
  assert.equal(claimed.status, 'claimed');
  assert.equal((await db.claimWorkflowRun({ ...device, user_id: owner.id })), null);
  assert.equal((await db.startWorkflowRun({ ...device, user_id: owner.id }, claimed.id)).status, 'running');
  await db.addWorkflowRunStep({ ...device, user_id: owner.id }, claimed.id, {
    nodeId: 'start', nodeType: 'start', nodeLabel: '开始', status: 'done',
    input: { query: 'hello' }, output: { mode: 'local' }, durationMs: 2,
  });
  const permission = await db.requestRuntimePermission({ ...device, user_id: owner.id }, {
    runId: claimed.id, nodeId: 'file-node', capability: 'file.read',
    actionLabel: '读取本地文本文件', context: { path: '/safe/note.txt' },
  });
  assert.equal(permission.status, 'pending');
  assert.equal((await db.getRuntimePermissionRequests(other.id)).length, 0);
  assert.equal(await db.resolveRuntimePermissionRequest(other.id, permission.id, 'allow_always'), null);
  assert.equal((await db.resolveRuntimePermissionRequest(owner.id, permission.id, 'allow_always')).status, 'allowed');
  assert.equal((await db.getRuntimePermissionGrants(owner.id)).length, 1);
  const autoGranted = await db.requestRuntimePermission({ ...device, user_id: owner.id }, {
    runId: claimed.id, nodeId: 'file-node-2', capability: 'file.read',
    actionLabel: '读取本地文本文件', context: { path: '/safe/second.txt' },
  });
  assert.equal(autoGranted.status, 'allowed');
  assert.equal(autoGranted.decision, 'existing_grant');
  const grant = (await db.getRuntimePermissionGrants(owner.id))[0];
  assert.equal(await db.revokeRuntimePermissionGrant(other.id, grant.id), false);
  assert.equal(await db.revokeRuntimePermissionGrant(owner.id, grant.id), true);
  const complete = await db.completeWorkflowRun({ ...device, user_id: owner.id }, claimed.id, {
    status: 'succeeded', output: { answer: 'done' }, error: null,
  });
  assert.equal(complete.status, 'succeeded');
  const detail = await db.getWorkflowRunWithSteps(owner.id, claimed.id);
  assert.equal(detail.steps.length, 1);
  assert.equal(detail.steps[0].output.mode, 'local');

  await db.createWorkflowRun(owner.id, {
    id: 'run-cancelled', workflowId: 'workflow-runtime', deviceId: device.id,
    input: {}, workflowSnapshot: { name: 'Runtime flow', nodes: [], edges: [] },
  });
  const cancelledRun = await db.claimWorkflowRun({ ...device, user_id: owner.id });
  await db.startWorkflowRun({ ...device, user_id: owner.id }, cancelledRun.id);
  const cancelledPermission = await db.requestRuntimePermission({ ...device, user_id: owner.id }, {
    runId: cancelledRun.id, nodeId: 'write-node', capability: 'file.write',
    actionLabel: '写入本地文本文件', context: { path: '/safe/note.txt' },
  });
  assert.equal(cancelledPermission.status, 'pending');
  assert.equal(await db.cancelWorkflowRun(owner.id, cancelledRun.id), true);
  assert.equal((await db.getRuntimePermissionRequestForDevice({ ...device, user_id: owner.id }, cancelledPermission.id)).status, 'expired');
  assert.equal(await db.resolveRuntimePermissionRequest(owner.id, cancelledPermission.id, 'allow_once'), null);

  await db.createWorkflowRun(owner.id, {
    id: 'run-revoked-device', workflowId: 'workflow-runtime', deviceId: device.id,
    input: {}, workflowSnapshot: { name: 'Runtime flow', nodes: [], edges: [] },
  });
  const revokedRun = await db.claimWorkflowRun({ ...device, user_id: owner.id });
  await db.startWorkflowRun({ ...device, user_id: owner.id }, revokedRun.id);
  const revokedPermission = await db.requestRuntimePermission({ ...device, user_id: owner.id }, {
    runId: revokedRun.id, nodeId: 'app-node', capability: 'app.notes.open',
    actionLabel: '打开 Notes', context: {},
  });
  assert.equal((await db.resolveRuntimePermissionRequest(owner.id, revokedPermission.id, 'allow_always')).status, 'allowed');
  assert.equal(await db.revokeRuntimeDevice(other.id, device.id), false);
  assert.equal(await db.revokeRuntimeDevice(owner.id, device.id), true);
  assert.equal(await db.getRuntimeDeviceByTokenHash(tokenHash), null);
  assert.equal((await db.getWorkflowRun(owner.id, revokedRun.id)).status, 'cancelled');
  assert.equal((await db.getRuntimePermissionRequestForDevice({ ...device, user_id: owner.id }, revokedPermission.id)).status, 'expired');
  assert.equal((await db.getRuntimePermissionGrants(owner.id)).length, 0);
});
