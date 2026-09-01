import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AppAdapterRegistry } from '../src/adapters.js';

test('app adapters use a fixed executable with shell disabled', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-adapter-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, 'adapters.json');
  await fs.writeFile(manifestPath, JSON.stringify({
    version: 1,
    adapters: [{
      id: 'photos', label: 'Photos', executable: process.execPath,
      actions: [{ id: 'open', label: 'Open file', args: ['--inspect-port={{input.port}}', '{{input.path}}'] }],
    }],
  }));
  let spawned;
  const spawnProcess = (executable, args, options) => {
    spawned = { executable, args, options };
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  const registry = await AppAdapterRegistry.fromFile(manifestPath, spawnProcess);
  const prepared = registry.prepare('photos', 'open', {
    port: 9229, path: 'C:\\Safe\\photo.png', executable: 'malicious.exe',
  });
  assert.equal(prepared.capability, 'app.photos.open');
  assert.equal(prepared.approvalContext.executable, path.basename(process.execPath));
  const result = await registry.invoke(prepared);
  assert.equal(result.launched, true);
  assert.equal(spawned.executable, await fs.realpath(process.execPath));
  assert.deepEqual(spawned.args, ['--inspect-port=9229', 'C:\\Safe\\photo.png']);
  assert.equal(spawned.options.shell, false);
  assert.equal(spawned.options.windowsHide, true);
});

test('adapter manifests reject relative executables and unresolved inputs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-adapter-invalid-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, 'adapters.json');
  await fs.writeFile(manifestPath, JSON.stringify({
    version: 1,
    adapters: [{ id: 'unsafe', executable: 'cmd.exe', actions: [{ id: 'run', args: [] }] }],
  }));
  await assert.rejects(() => AppAdapterRegistry.fromFile(manifestPath), /绝对路径/);

  const registry = new AppAdapterRegistry([{
    id: 'safe', label: 'Safe', executable: process.execPath, executableName: path.basename(process.execPath),
    actions: [{ id: 'open', label: 'Open', args: ['{{input.path}}'], wait: false, timeoutMs: 1_000 }],
  }]);
  assert.throws(() => registry.prepare('safe', 'open', {}), /缺少必需输入/);
});

test('detached adapter launch reports spawn failures', async () => {
  const registry = new AppAdapterRegistry([{
    id: 'safe', label: 'Safe', executable: process.execPath, executableName: path.basename(process.execPath),
    actions: [{ id: 'open', label: 'Open', args: [], wait: false, timeoutMs: 1_000 }],
  }], () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error('launch denied')));
    return child;
  });
  await assert.rejects(() => registry.invoke(registry.prepare('safe', 'open')), /launch denied/);
});
