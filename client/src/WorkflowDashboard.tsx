import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import WorkflowCard from './WorkflowCard';
import ModelSettings from './ModelSettings';
import RuntimeCenter from './RuntimeCenter';

interface Workflow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface WorkflowDashboardProps {
  token: string;
  onEditWorkflow: (workflowId: string) => void;
  onLogout: () => void;
  user: any;
}

function NexusMark() {
  return <span className="nexus-mark compact" aria-hidden="true"><span /><span /><span /></span>;
}

export default function WorkflowDashboard({ onEditWorkflow, onLogout, user }: WorkflowDashboardProps) {
  const [activeSection, setActiveSection] = useState<'workflows' | 'runtime'>('workflows');
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Workflow | null>(null);
  const [modelConfigured, setModelConfigured] = useState(false);
  const [pendingRun, setPendingRun] = useState<Workflow | null>(null);
  const [runtimeDevices, setRuntimeDevices] = useState<Array<{ id: string; name: string; online: boolean; revokedAt: string | null }>>([]);
  const [runDeviceId, setRunDeviceId] = useState('');
  const [runQuery, setRunQuery] = useState('');
  const [dispatching, setDispatching] = useState(false);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2_800);
  };

  const loadWorkflows = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/workflows', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('工作流加载失败，请稍后重试');
      const data = await response.json();
      setWorkflows(data.workflows || []);
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  };

  const loadModelStatus = () => {
    fetch('/api/model-config', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setModelConfigured(Boolean(data.configured)))
      .catch(() => setModelConfigured(false));
  };

  useEffect(() => {
    void loadWorkflows();
    loadModelStatus();
  }, []);

  const createWorkflow = async (event: FormEvent) => {
    event.preventDefault();
    const name = newWorkflowName.trim();
    if (!name) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/workflows', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          nodes: [{ id: 'start', type: 'start', position: { x: 100, y: 100 }, data: { label: '开始' } }],
          edges: [],
        }),
      });
      if (!response.ok) throw new Error('创建工作流失败');
      const data = await response.json();
      setShowCreateDialog(false);
      setNewWorkflowName('');
      notify('工作流已创建');
      await loadWorkflows();
      if (data.workflow?.id) onEditWorkflow(data.workflow.id);
    } catch (cause: any) {
      setError(cause.message);
      setLoading(false);
    }
  };

  const deleteWorkflow = async () => {
    if (!pendingDelete) return;
    const deleting = pendingDelete;
    setPendingDelete(null);
    try {
      const response = await fetch(`/api/workflows/${deleting.id}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) throw new Error('删除工作流失败');
      setWorkflows(items => items.filter(item => item.id !== deleting.id));
      notify(`已删除「${deleting.name}」`);
    } catch (cause: any) {
      setError(cause.message);
    }
  };

  const duplicateWorkflow = async (workflowId: string) => {
    try {
      const sourceResponse = await fetch(`/api/workflows/${workflowId}`, { credentials: 'same-origin' });
      if (!sourceResponse.ok) throw new Error('读取工作流失败');
      const source = (await sourceResponse.json()).workflow;
      const response = await fetch('/api/workflows', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${source.name} · 副本`, nodes: source.nodes, edges: source.edges }),
      });
      if (!response.ok) throw new Error('复制工作流失败');
      notify('工作流副本已创建');
      await loadWorkflows();
    } catch (cause: any) {
      setError(cause.message);
    }
  };

  const openLocalRun = async (workflow: Workflow) => {
    setPendingRun(workflow);
    setRunQuery('');
    setError('');
    try {
      const response = await fetch('/api/runtime/devices', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('设备列表加载失败');
      const devices = (await response.json()).devices || [];
      const available = devices.filter((device: any) => !device.revokedAt);
      setRuntimeDevices(available);
      setRunDeviceId((available.find((device: any) => device.online) || available[0])?.id || '');
    } catch (cause: any) {
      setError(cause.message);
    }
  };

  const dispatchLocalRun = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingRun || !runDeviceId) return;
    setDispatching(true);
    try {
      const response = await fetch('/api/runtime/runs', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: pendingRun.id, deviceId: runDeviceId, input: { query: runQuery } }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '任务派发失败');
      setPendingRun(null);
      setActiveSection('runtime');
      notify(`运行 ${payload.run.id.slice(-8)} 已派发`);
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setDispatching(false);
    }
  };

  const visibleWorkflows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return workflows;
    return workflows.filter(workflow => workflow.name.toLowerCase().includes(normalized));
  }, [query, workflows]);

  const latestUpdate = workflows.length
    ? new Date(Math.max(...workflows.map(item => new Date(item.updated_at || item.created_at).getTime())))
      .toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    : '—';

  return (
    <div className="workspace-shell">
      <aside className="workspace-rail">
        <div className="rail-brand"><NexusMark /><div><strong>NexusFlow</strong><span>STUDIO</span></div></div>
        <nav className="rail-nav" aria-label="主导航">
          <button className={activeSection === 'workflows' ? 'active' : ''} onClick={() => setActiveSection('workflows')}><svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg><span>工作流</span></button>
          <button onClick={() => setShowModelSettings(true)}><svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" /></svg><span>模型</span></button>
          <button className={activeSection === 'runtime' ? 'active' : ''} onClick={() => setActiveSection('runtime')}><svg viewBox="0 0 24 24"><path d="M4 19h16M6 16l4-5 3 3 5-7" /></svg><span>运行记录</span><i>LIVE</i></button>
          <button className="rail-disabled" title="即将开放"><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></svg><span>知识库</span><i>SOON</i></button>
        </nav>
        <div className="rail-spacer" />
        <div className="rail-system"><i /><span>System online</span></div>
        <button className="rail-user" onClick={onLogout} title="点击退出登录">
          <span>{String(user?.username || 'U').slice(0, 1).toUpperCase()}</span>
          <div><strong>{user?.username}</strong><small>退出登录</small></div>
          <b>↗</b>
        </button>
      </aside>

      <main className="workspace-main">
        {activeSection === 'runtime' ? <RuntimeCenter /> : <>
        <header className="workspace-header">
          <div><span className="eyebrow">ASSISTANT WORKSPACE</span><h1>工作流控制台</h1><p>编排模型、知识与设备能力，让助手从理解走向执行。</p></div>
          <div className="workspace-header-actions">
            <button className={`model-pill ${modelConfigured ? 'connected' : ''}`} onClick={() => setShowModelSettings(true)}>
              <i />{modelConfigured ? '模型已连接' : '配置模型'}<span>›</span>
            </button>
            <button className="primary-action" onClick={() => setShowCreateDialog(true)}><span>＋</span> 新建工作流</button>
          </div>
        </header>

        <section className="workspace-metrics" aria-label="工作区概览">
          <div><span>WORKFLOWS</span><strong>{String(workflows.length).padStart(2, '0')}</strong><small>已创建工作流</small></div>
          <div><span>MODEL LINK</span><strong className={modelConfigured ? 'metric-good' : 'metric-warn'}>{modelConfigured ? 'ON' : '—'}</strong><small>{modelConfigured ? 'OpenAI 协议已就绪' : '等待配置'}</small></div>
          <div><span>LAST ACTIVE</span><strong className="metric-date">{latestUpdate}</strong><small>最近一次更新</small></div>
          <div className="metric-signal"><span>RUNTIME</span><div><i /><i /><i /><i /><i /><i /></div><small>Cloud function ready</small></div>
        </section>

        {error && <div className="workspace-alert" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError('')}>×</button></div>}

        <section className="workflow-library">
          <div className="library-toolbar">
            <div><h2>你的工作流</h2><span>{visibleWorkflows.length} 个项目</span></div>
            <label className="search-box">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索工作流" aria-label="搜索工作流" />
              {query && <button onClick={() => setQuery('')} aria-label="清除搜索">×</button>}
            </label>
          </div>

          {loading ? (
            <div className="workflow-grid" aria-label="正在加载工作流">
              {[0, 1, 2].map(item => <div className="workflow-skeleton" key={item}><i /><span /><span /><b /></div>)}
            </div>
          ) : visibleWorkflows.length > 0 ? (
            <div className="workflow-grid">
              {visibleWorkflows.map((workflow, index) => (
                <WorkflowCard key={workflow.id} workflow={workflow} index={index} onEdit={onEditWorkflow} onDelete={() => setPendingDelete(workflow)} onRun={openLocalRun} onDuplicate={duplicateWorkflow} />
              ))}
              {!query && <button className="workflow-new-tile" onClick={() => setShowCreateDialog(true)}><span>＋</span><strong>新建工作流</strong><small>从空白画布开始</small></button>}
            </div>
          ) : (
            <div className="workflow-empty">
              <div className="empty-orbit"><span>＋</span></div>
              <span className="eyebrow">EMPTY CANVAS</span>
              <h3>{query ? '没有匹配的工作流' : '构建你的第一个助手工作流'}</h3>
              <p>{query ? '换一个关键词试试，或清除当前搜索。' : '从一个触发器开始，连接模型、知识与设备动作。'}</p>
              <button className="primary-action" onClick={() => query ? setQuery('') : setShowCreateDialog(true)}>{query ? '清除搜索' : '开始构建'} <span>→</span></button>
            </div>
          )}
        </section>
        </>}
      </main>

      {showCreateDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowCreateDialog(false); }}>
          <form className="dialog-card create-dialog" onSubmit={createWorkflow} role="dialog" aria-modal="true" aria-labelledby="create-workflow-title">
            <div className="dialog-kicker">NEW WORKFLOW</div>
            <button type="button" className="dialog-close" onClick={() => setShowCreateDialog(false)} aria-label="关闭">×</button>
            <h2 id="create-workflow-title">创建工作流</h2>
            <p>先给它一个清晰的名字，随后进入画布添加能力节点。</p>
            <label className="form-field"><span>工作流名称</span><div className="input-shell"><input value={newWorkflowName} onChange={event => setNewWorkflowName(event.target.value)} placeholder="例如：每日信息助理" maxLength={80} required autoFocus /></div><small>{newWorkflowName.length}/80</small></label>
            <div className="template-preview"><div><i>01</i><strong>START</strong></div><span>→</span><div className="ghost"><i>02</i><strong>ADD NODE</strong></div></div>
            <div className="dialog-actions"><button type="button" className="secondary-action" onClick={() => setShowCreateDialog(false)}>取消</button><button className="primary-action" disabled={loading}>创建并打开 <span>→</span></button></div>
          </form>
        </div>
      )}

      {pendingDelete && (
        <div className="modal-backdrop">
          <div className="dialog-card confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
            <div className="danger-icon">!</div><h2 id="delete-title">删除这个工作流？</h2><p>「{pendingDelete.name}」及其画布配置将被永久删除，此操作无法撤销。</p>
            <div className="dialog-actions"><button className="secondary-action" onClick={() => setPendingDelete(null)}>保留</button><button className="danger-action" onClick={deleteWorkflow}>确认删除</button></div>
          </div>
        </div>
      )}

      {pendingRun && (
        <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPendingRun(null); }}>
          <form className="dialog-card local-run-dialog" onSubmit={dispatchLocalRun} role="dialog" aria-modal="true">
            <div className="dialog-kicker">DISPATCH TO AI PC</div>
            <button type="button" className="dialog-close" onClick={() => setPendingRun(null)}>×</button>
            <h2>本机运行「{pendingRun.name}」</h2>
            <p>任务会进入队列，由选中的 Local Runtime 主动认领。每个节点的轨迹都会实时回传。</p>
            {runtimeDevices.length > 0 ? <>
              <label className="form-field"><span>执行设备</span><div className="input-shell"><select value={runDeviceId} onChange={event => setRunDeviceId(event.target.value)} required>{runtimeDevices.map(device => <option value={device.id} key={device.id}>{device.online ? '● ' : '○ '}{device.name}{device.online ? ' · 在线' : ' · 离线/排队'}</option>)}</select></div></label>
              <label className="form-field"><span>Query 输入 <em>可留空用于后台工作流</em></span><div className="input-shell run-query-shell"><textarea value={runQuery} onChange={event => setRunQuery(event.target.value)} placeholder="输入这次运行要处理的内容" maxLength={8000} /></div><small>{runQuery.length}/8000</small></label>
              <div className="dialog-actions"><button type="button" className="secondary-action" onClick={() => setPendingRun(null)}>取消</button><button className="primary-action" disabled={dispatching}>{dispatching ? '正在派发…' : '派发到本机'} <span>→</span></button></div>
            </> : <div className="no-runtime-callout"><strong>还没有可用设备</strong><p>先进入“运行记录”配对 Local Runtime，再回来派发任务。</p><button type="button" className="primary-action" onClick={() => { setPendingRun(null); setActiveSection('runtime'); }}>去配对设备</button></div>}
          </form>
        </div>
      )}

      {showModelSettings && <ModelSettings onClose={() => { setShowModelSettings(false); loadModelStatus(); }} />}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </div>
  );
}
