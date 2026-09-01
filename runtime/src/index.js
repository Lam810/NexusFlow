#!/usr/bin/env node
import os from 'node:os';
import { AppAdapterRegistry } from './adapters.js';
import { RuntimeClient } from './client.js';
import { executeWorkflow } from './executor.js';
import { parseAllowedRoots } from './security.js';

const baseUrl = String(process.env.NEXUSFLOW_URL || '').replace(/\/+$/, '');
const token = String(process.env.NEXUSFLOW_DEVICE_TOKEN || '');
const allowedRoots = parseAllowedRoots(process.env.NEXUSFLOW_ALLOWED_DIRS || '');
const allowWrites = process.env.NEXUSFLOW_ALLOW_WRITES === 'true';
const pollMs = Math.max(1_000, Math.min(Number(process.env.NEXUSFLOW_POLL_MS) || 3_000, 60_000));
const runOnce = process.env.NEXUSFLOW_RUN_ONCE === 'true';
const approvalTimeoutMs = Math.max(10_000, Math.min(Number(process.env.NEXUSFLOW_APPROVAL_TIMEOUT_MS) || 300_000, 1_800_000));
const adaptersFile = String(process.env.NEXUSFLOW_ADAPTERS_FILE || '').trim();

if (!/^https?:\/\//i.test(baseUrl)) {
  console.error('NEXUSFLOW_URL 必须是 http(s) 地址');
  process.exit(1);
}
if (!/^nfr_[A-Za-z0-9_-]+$/.test(token)) {
  console.error('NEXUSFLOW_DEVICE_TOKEN 未配置或格式无效');
  process.exit(1);
}

const adapterRegistry = await AppAdapterRegistry.fromFile(adaptersFile);
const client = new RuntimeClient({ baseUrl, token });
const appAdapters = adapterRegistry.capabilities();
const capabilities = {
  runtimeVersion: '0.2.0',
  platform: os.platform(),
  arch: os.arch(),
  nodeVersion: process.version,
  actions: ['system.info', 'file.read', ...(allowWrites ? ['file.write'] : []), ...(appAdapters.length ? ['app.invoke'] : [])],
  appAdapters,
  allowedRootCount: allowedRoots.length,
  writesEnabled: allowWrites,
};

let stopping = false;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processJob(job) {
  console.log(`[run ${job.id}] 已认领：${job.workflow_snapshot?.name || job.workflow_id}`);
  await client.start(job.id);
  try {
    const output = await executeWorkflow({ job, client, allowedRoots, allowWrites, adapterRegistry, approvalTimeoutMs });
    await client.complete(job.id, { status: 'succeeded', output });
    console.log(`[run ${job.id}] 执行成功`);
  } catch (error) {
    try {
      await client.complete(job.id, { status: 'failed', error: error.message });
    } catch (reportError) {
      console.error(`[run ${job.id}] 失败状态回传失败：${reportError.message}`);
    }
    console.error(`[run ${job.id}] 执行失败：${error.message}`);
  }
}

async function main() {
  const heartbeat = await client.heartbeat(capabilities);
  console.log(`NexusFlow Local Runtime 已连接（设备 ${heartbeat.deviceId}，轮询 ${pollMs}ms，文件写入${allowWrites ? '已开启' : '已关闭'}，应用适配器 ${appAdapters.length} 个）`);
  let lastHeartbeat = Date.now();
  do {
    if (Date.now() - lastHeartbeat >= 30_000) {
      await client.heartbeat(capabilities);
      lastHeartbeat = Date.now();
    }
    const job = await client.claim();
    if (job) await processJob(job);
    if (!runOnce && !stopping) await delay(pollMs);
  } while (!runOnce && !stopping);
  console.log('NexusFlow Local Runtime 已停止');
}

main().catch(error => {
  console.error(`Runtime 无法继续：${error.message}`);
  process.exitCode = 1;
});
