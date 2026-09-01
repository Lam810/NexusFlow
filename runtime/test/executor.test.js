import assert from 'node:assert/strict';
import test from 'node:test';
import { executeWorkflow, renderTemplate } from '../src/executor.js';

test('template rendering and condition routing produce node traces', async () => {
  const traces = [];
  const client = {
    trace: async (_runId, step) => traces.push(step),
    modelChat: async () => ({ text: 'model answer', model: 'test-model', usage: null }),
  };
  const job = {
    id: 'run-1',
    input: { query: '技术问题' },
    workflow_snapshot: {
      nodes: [
        { id: 'start', data: { label: '开始' } },
        { id: 'condition', data: { label: '条件分支', config: { if: { variable: 'query', operator: 'contains', value: '技术' }, elseEnabled: true } } },
        { id: 'llm', data: { label: 'LLM', config: { userPrompt: '{{query}}' } } },
        { id: 'reply', data: { label: '直接回复', config: { mode: 'template', template: '{{llm_text}}' } } },
      ],
      edges: [
        { source: 'start', target: 'condition' },
        { source: 'condition', sourceHandle: 'cond_0', target: 'llm' },
        { source: 'llm', target: 'reply' },
      ],
    },
  };
  const result = await executeWorkflow({ job, client });
  assert.equal(result.answer, 'model answer');
  assert.deepEqual(traces.map(step => step.nodeId), ['start', 'condition', 'llm', 'reply']);
  assert.equal(renderTemplate('Hi {{user.name}}', { user: { name: 'Nexus' } }), 'Hi Nexus');
});

test('application adapter nodes wait for exact capability approval', async () => {
  const traces = [];
  const approvals = [];
  const client = {
    trace: async (_runId, step) => traces.push(step),
    ensurePermission: async request => approvals.push(request),
  };
  const adapterRegistry = {
    prepare: (adapterId, actionId, input) => ({
      capability: `app.${adapterId}.${actionId}`,
      actionLabel: 'Photos · Open',
      approvalContext: { adapterId, actionId, arguments: [input.path] },
      adapter: { id: adapterId }, action: { id: actionId }, args: [input.path],
    }),
    invoke: async prepared => ({ launched: true, adapterId: prepared.adapter.id, actionId: prepared.action.id }),
  };
  const result = await executeWorkflow({
    job: {
      id: 'run-app', input: { query: 'C:\\Safe\\photo.png' },
      workflow_snapshot: {
        nodes: [
          { id: 'start', data: { label: '开始' } },
          { id: 'device', data: { label: '设备能力', runtimeType: 'device', config: {
            action: 'app.invoke', adapterId: 'photos', adapterAction: 'open',
            adapterInput: '{"path":"{{query}}"}',
          } } },
        ],
        edges: [{ source: 'start', target: 'device' }],
      },
    },
    client,
    adapterRegistry,
    approvalTimeoutMs: 60_000,
  });
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].capability, 'app.photos.open');
  assert.equal(approvals[0].nodeId, 'device');
  assert.equal(result.variables.device.launched, true);
  assert.deepEqual(traces.map(step => step.status), ['done', 'done']);
});
