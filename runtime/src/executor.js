import os from 'node:os';
import { readAllowedFile, resolveReadableFile, resolveWritableFile, writeAllowedFile } from './security.js';

const MAX_TRACE_BYTES = 48 * 1024;
const MAX_EXECUTED_NODES = 200;

function resolvePath(source, dottedPath) {
  let value = source;
  for (const part of String(dottedPath || '').trim().split('.')) {
    if (!part || value === null || value === undefined || !Object.prototype.hasOwnProperty.call(Object(value), part)) {
      return { found: false };
    }
    value = value[part];
  }
  return { found: true, value };
}

export function renderTemplate(template, variables) {
  return String(template ?? '').replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
    const result = resolvePath(variables, expression);
    return result.found ? String(result.value ?? '') : match;
  });
}

function renderNestedTemplates(value, variables, depth = 0) {
  if (depth > 8) throw new Error('应用适配器输入嵌套过深');
  if (typeof value === 'string') return renderTemplate(value, variables);
  if (Array.isArray(value)) return value.map(item => renderNestedTemplates(item, variables, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderNestedTemplates(item, variables, depth + 1)]));
  }
  return value;
}

function traceValue(value) {
  if (value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) <= MAX_TRACE_BYTES) return value;
  return { truncated: true, preview: serialized.slice(0, 12_000), originalBytes: Buffer.byteLength(serialized) };
}

function nodeKind(node) {
  if (node?.data?.runtimeType) return String(node.data.runtimeType);
  const label = String(node?.data?.label || '');
  if (label === '条件分支') return 'condition';
  if (label === 'LLM') return 'llm';
  if (label === '直接回复') return 'reply';
  if (label === '设备能力') return 'device';
  if (label === 'Query触发器') return 'query';
  if (label === '循环定时器') return 'loop';
  if (label === '知识检索') return 'knowledge';
  if (label === 'HTTP请求') return 'http';
  if (label === '数据分析') return 'analysis';
  if (label.startsWith('开始') || node?.id === 'start') return 'start';
  return 'unknown';
}

function evaluateClause(clause, variables) {
  const current = resolvePath(variables, clause?.variable || 'query');
  const value = current.found ? current.value : '';
  const target = String(clause?.value || '');
  switch (clause?.operator) {
    case 'contains': return String(value).includes(target);
    case 'not_contains': return !String(value).includes(target);
    case 'start_with': return String(value).startsWith(target);
    case 'end_with': return String(value).endsWith(target);
    case 'is': return String(value) === target;
    case 'is_not': return String(value) !== target;
    case 'is_empty': return !value || String(value).trim() === '';
    case 'is_not_empty': return Boolean(value && String(value).trim() !== '');
    default: return false;
  }
}

function selectConditionHandle(config, variables) {
  if (config?.semanticMatch?.enabled) throw new Error('Local Runtime 暂不支持语义条件，请改用关键词条件');
  if (evaluateClause(config?.if || {}, variables)) return 'cond_0';
  for (let index = 0; index < (config?.elifs || []).length; index += 1) {
    if (evaluateClause(config.elifs[index], variables)) return `cond_${index + 1}`;
  }
  return config?.elseEnabled === false ? null : 'cond_else';
}

async function requirePermission(node, context, capability, actionLabel, approvalContext) {
  await context.client.ensurePermission({
    runId: context.jobId,
    nodeId: node.id,
    capability,
    actionLabel,
    context: approvalContext,
  }, { timeoutMs: context.approvalTimeoutMs });
}

async function executeDeviceAction(node, config, context) {
  const action = config?.action || 'system.info';
  if (action === 'system.info') {
    return {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpus: os.cpus().length,
      memoryBytes: os.totalmem(),
      runtime: process.version,
    };
  }
  if (action === 'file.read') {
    const requestedPath = renderTemplate(config?.path || '{{query}}', context.variables);
    const validated = await resolveReadableFile(requestedPath, context.allowedRoots);
    await requirePermission(node, context, 'file.read', '读取本地文本文件', {
      path: validated.target,
      access: 'read',
    });
    return readAllowedFile(requestedPath, context.allowedRoots);
  }
  if (action === 'file.write') {
    if (!context.allowWrites) throw new Error('本机文件写入未启用（NEXUSFLOW_ALLOW_WRITES=false）');
    const requestedPath = renderTemplate(config?.path || '', context.variables);
    const content = renderTemplate(config?.content || '{{query}}', context.variables);
    const validatedPath = await resolveWritableFile(requestedPath, context.allowedRoots);
    await requirePermission(node, context, 'file.write', '写入本地文本文件', {
      path: validatedPath,
      access: 'write',
      contentBytes: Buffer.byteLength(content),
    });
    return writeAllowedFile(requestedPath, content, context.allowedRoots);
  }
  if (action === 'app.invoke') {
    if (!context.adapterRegistry) throw new Error('本机未加载应用适配器注册表');
    let rawInput;
    try {
      rawInput = typeof config?.adapterInput === 'string'
        ? JSON.parse(config.adapterInput || '{}')
        : (config?.adapterInput || {});
    } catch {
      throw new Error('应用适配器输入必须是合法 JSON');
    }
    const input = renderNestedTemplates(rawInput, context.variables);
    const prepared = context.adapterRegistry.prepare(config?.adapterId, config?.adapterAction, input);
    await requirePermission(node, context, prepared.capability, prepared.actionLabel, prepared.approvalContext);
    return context.adapterRegistry.invoke(prepared);
  }
  throw new Error(`不支持的设备动作：${action}`);
}

async function executeNode(node, context) {
  const kind = nodeKind(node);
  const config = node?.data?.config || {};
  if (kind === 'start') return { output: { mode: config.mode || 'local' } };
  if (kind === 'query') {
    if (!String(context.query || '').trim()) throw new Error('Query 触发器需要非空 query');
    return { output: { query: context.query } };
  }
  if (kind === 'condition') {
    const branchHandle = selectConditionHandle(config, context.variables);
    context.variables.condition = { branch: branchHandle };
    return { output: { branch: branchHandle }, branchHandle };
  }
  if (kind === 'llm') {
    const response = await context.client.modelChat({
      model: config.model,
      temperature: config.temperature,
      messages: [
        { role: 'system', content: renderTemplate(config.systemPrompt || '你是一个有用的助手。', context.variables) },
        { role: 'user', content: renderTemplate(config.userPrompt || '{{query}}', context.variables) },
      ],
    });
    context.variables.llm_text = response.text;
    context.variables[`llm_text_${node.id}`] = response.text;
    return { output: { text: response.text, model: response.model, usage: response.usage } };
  }
  if (kind === 'reply') {
    const answer = config.mode === 'llm'
      ? String(context.variables.llm_text || context.query)
      : renderTemplate(config.template || '{{query}}', context.variables);
    context.variables.answer = answer;
    return { output: { answer } };
  }
  if (kind === 'device') {
    const result = await executeDeviceAction(node, config, context);
    context.variables.device = result;
    context.variables[`device_${node.id}`] = result;
    return { output: result };
  }
  if (kind === 'loop') return { output: { skipped: true, reason: '本地手动运行只执行一次；定时调度将在后续版本提供' } };
  if (kind === 'knowledge') throw new Error('Local Runtime 暂不支持知识检索节点');
  if (kind === 'http') throw new Error('Local Runtime 为安全起见暂不执行 HTTP 请求节点');
  if (kind === 'analysis') throw new Error('Local Runtime 暂不支持数据分析节点');
  throw new Error(`Local Runtime 不认识节点“${node?.data?.label || node?.id}”`);
}

export async function executeWorkflow({
  job,
  client,
  allowedRoots = [],
  allowWrites = false,
  adapterRegistry = null,
  approvalTimeoutMs = 300_000,
}) {
  const snapshot = job?.workflow_snapshot || {};
  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
  const edges = Array.isArray(snapshot.edges) ? snapshot.edges : [];
  if (nodes.length === 0) throw new Error('工作流没有可执行节点');

  const input = job?.input && typeof job.input === 'object' ? job.input : { query: String(job?.input || '') };
  const query = String(input.query || '');
  const context = {
    query,
    variables: { ...input, query, kb_text: '', http_text: '' },
    client,
    allowedRoots,
    allowWrites,
    adapterRegistry,
    approvalTimeoutMs,
    jobId: job.id,
  };
  const incoming = new Set(edges.map(edge => edge.target));
  const start = nodes.find(node => nodeKind(node) === 'start') || nodes.find(node => !incoming.has(node.id));
  if (!start) throw new Error('找不到工作流起点');
  const visited = new Set();
  let current = start;

  while (current) {
    if (visited.has(current.id)) throw new Error(`检测到循环：节点 ${current.id} 被重复执行`);
    if (visited.size >= MAX_EXECUTED_NODES) throw new Error(`单次运行最多执行 ${MAX_EXECUTED_NODES} 个节点`);
    visited.add(current.id);
    const startedAt = new Date();
    let result;
    try {
      result = await executeNode(current, context);
      const completedAt = new Date();
      await client.trace(job.id, {
        nodeId: current.id,
        nodeType: nodeKind(current),
        nodeLabel: String(current.data?.label || current.id),
        status: 'done',
        input: traceValue({ query: context.query }),
        output: traceValue(result.output),
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      });
    } catch (error) {
      const completedAt = new Date();
      await client.trace(job.id, {
        nodeId: current.id,
        nodeType: nodeKind(current),
        nodeLabel: String(current.data?.label || current.id),
        status: 'failed',
        input: traceValue({ query: context.query }),
        error: error.message,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      });
      throw error;
    }

    const outgoing = edges.filter(edge => edge.source === current.id);
    const nextEdge = result.branchHandle
      ? outgoing.find(edge => edge.sourceHandle === result.branchHandle)
      : outgoing[0];
    current = nextEdge ? nodes.find(node => node.id === nextEdge.target) : null;
  }

  return traceValue({
    answer: context.variables.answer || context.variables.llm_text || '',
    variables: context.variables,
    executedNodes: [...visited],
  });
}
