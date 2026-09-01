import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;

function resolveTemplate(template, source) {
  return String(template).replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
    let value = source;
    for (const part of String(expression).trim().split('.')) {
      if (!part || value === null || value === undefined || !Object.prototype.hasOwnProperty.call(Object(value), part)) {
        return match;
      }
      value = value[part];
    }
    return String(value ?? '');
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`本地应用超过 ${timeoutMs}ms 未退出`));
    }, timeoutMs);
    timeout.unref?.();
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ exitCode: 0 });
      else reject(new Error(`本地应用退出异常（code=${code ?? 'null'}, signal=${signal || 'none'}）`));
    });
  });
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

export class AppAdapterRegistry {
  constructor(adapters = [], spawnProcess = spawn) {
    this.adapters = new Map(adapters.map(adapter => [adapter.id, adapter]));
    this.spawnProcess = spawnProcess;
  }

  static async fromFile(filePath, spawnProcess = spawn) {
    if (!filePath) return new AppAdapterRegistry([], spawnProcess);
    const absolutePath = path.resolve(filePath);
    const payload = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
    if (payload?.version !== 1 || !Array.isArray(payload.adapters)) {
      throw new Error('应用适配器清单必须包含 version: 1 和 adapters 数组');
    }
    const adapters = [];
    const seen = new Set();
    for (const rawAdapter of payload.adapters) {
      const id = String(rawAdapter?.id || '').trim().toLowerCase();
      if (!ID_PATTERN.test(id) || seen.has(id)) throw new Error(`应用适配器 ID 无效或重复：${id || '(empty)'}`);
      seen.add(id);
      const executableSource = String(rawAdapter?.executable || '').trim();
      if (!path.isAbsolute(executableSource)) throw new Error(`适配器 ${id} 的 executable 必须是绝对路径`);
      const executable = await fs.realpath(executableSource);
      const executableStat = await fs.stat(executable);
      if (!executableStat.isFile()) throw new Error(`适配器 ${id} 的 executable 不是文件`);
      if (!Array.isArray(rawAdapter.actions) || rawAdapter.actions.length === 0) throw new Error(`适配器 ${id} 没有 actions`);
      const actionSeen = new Set();
      const actions = rawAdapter.actions.map(rawAction => {
        const actionId = String(rawAction?.id || '').trim().toLowerCase();
        if (!ID_PATTERN.test(actionId) || actionSeen.has(actionId)) throw new Error(`适配器 ${id} 的 action ID 无效或重复`);
        actionSeen.add(actionId);
        const args = Array.isArray(rawAction.args) ? rawAction.args.map(value => String(value)) : [];
        if (args.length > 32 || args.some(value => value.length > 2_000)) throw new Error(`适配器 ${id}.${actionId} 的参数模板过大`);
        return {
          id: actionId,
          label: String(rawAction.label || actionId).slice(0, 120),
          args,
          wait: rawAction.wait === true,
          timeoutMs: Math.max(1_000, Math.min(Number(rawAction.timeoutMs) || 30_000, 300_000)),
        };
      });
      adapters.push({
        id,
        label: String(rawAdapter.label || id).slice(0, 120),
        executable,
        executableName: path.basename(executable),
        actions,
      });
    }
    return new AppAdapterRegistry(adapters, spawnProcess);
  }

  capabilities() {
    return [...this.adapters.values()].map(adapter => ({
      id: adapter.id,
      label: adapter.label,
      actions: adapter.actions.map(action => ({ id: action.id, label: action.label })),
    }));
  }

  prepare(adapterId, actionId, input = {}) {
    const normalizedAdapterId = String(adapterId || '').trim().toLowerCase();
    const normalizedActionId = String(actionId || '').trim().toLowerCase();
    const adapter = this.adapters.get(normalizedAdapterId);
    if (!adapter) throw new Error(`本机未配置应用适配器：${normalizedAdapterId || '(empty)'}`);
    const action = adapter.actions.find(candidate => candidate.id === normalizedActionId);
    if (!action) throw new Error(`适配器 ${adapter.id} 不支持动作：${normalizedActionId || '(empty)'}`);
    const args = action.args.map(template => resolveTemplate(template, { input }));
    if (args.some(value => /\{\{[^}]+\}\}/.test(value))) throw new Error('应用适配器参数缺少必需输入');
    if (args.some(value => value.length > 4_000)) throw new Error('应用适配器渲染参数过大');
    return {
      adapter,
      action,
      args,
      capability: `app.${adapter.id}.${action.id}`,
      actionLabel: `${adapter.label} · ${action.label}`,
      approvalContext: {
        adapterId: adapter.id,
        adapterLabel: adapter.label,
        actionId: action.id,
        actionLabel: action.label,
        executable: adapter.executableName,
        arguments: args,
      },
    };
  }

  async invoke(prepared) {
    const child = this.spawnProcess(prepared.adapter.executable, prepared.args, {
      shell: false,
      windowsHide: true,
      detached: !prepared.action.wait,
      stdio: 'ignore',
    });
    if (!prepared.action.wait) {
      await waitForSpawn(child);
      child.unref?.();
      return {
        launched: true,
        adapterId: prepared.adapter.id,
        actionId: prepared.action.id,
        executable: prepared.adapter.executableName,
      };
    }
    const result = await waitForExit(child, prepared.action.timeoutMs);
    return {
      launched: true,
      completed: true,
      ...result,
      adapterId: prepared.adapter.id,
      actionId: prepared.action.id,
      executable: prepared.adapter.executableName,
    };
  }
}
