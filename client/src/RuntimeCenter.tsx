import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type RuntimeDevice = {
  id: string;
  name: string;
  capabilities: Record<string, any>;
  lastSeenAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  online: boolean;
};

type RunStep = {
  id: string;
  sequence: number;
  node_id: string;
  node_type: string;
  node_label: string;
  status: string;
  input: unknown;
  output: unknown;
  error?: string | null;
  duration_ms?: number | null;
};

type WorkflowRun = {
  id: string;
  workflow_id: string;
  workflow_name: string;
  device_id: string;
  device_name: string;
  status: string;
  input: unknown;
  output: unknown;
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  steps?: RunStep[];
};

type PermissionRequest = {
  id: string;
  run_id: string;
  device_id: string;
  device_name: string;
  workflow_name: string;
  node_id: string;
  capability: string;
  action_label: string;
  context: Record<string, unknown>;
  status: 'pending' | 'allowed' | 'denied' | 'expired';
  decision?: string | null;
  requested_at: string;
  resolved_at?: string | null;
};

type PermissionGrant = {
  id: string;
  device_id: string;
  device_name: string;
  capability: string;
  action_label: string;
  created_at: string;
  updated_at: string;
};

const statusLabel: Record<string, string> = {
  queued: '排队中', claimed: '已认领', running: '运行中', succeeded: '成功', failed: '失败', cancelled: '已取消',
};

function parseServerDate(value?: string | null) {
  if (!value) return null;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value?: string | null) {
  const date = parseServerDate(value);
  return date ? date.toLocaleString('zh-CN', { hour12: false }) : '—';
}

function pretty(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export default function RuntimeCenter() {
  const [devices, setDevices] = useState<RuntimeDevice[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPairing, setShowPairing] = useState(false);
  const [deviceName, setDeviceName] = useState('我的 AI PC');
  const [pairingToken, setPairingToken] = useState('');
  const [copyState, setCopyState] = useState('');
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([]);
  const [permissionGrants, setPermissionGrants] = useState<PermissionGrant[]>([]);
  const [permissionView, setPermissionView] = useState<'inbox' | 'grants'>('inbox');
  const [resolvingPermission, setResolvingPermission] = useState('');
  const [approvalFeedback, setApprovalFeedback] = useState('');

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [deviceResponse, runResponse, permissionResponse] = await Promise.all([
        fetch('/api/runtime/devices', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/runtime/runs', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/runtime/permissions', { credentials: 'same-origin', cache: 'no-store' }),
      ]);
      if (!deviceResponse.ok || !runResponse.ok || !permissionResponse.ok) throw new Error('Runtime 状态加载失败');
      const [deviceData, runData, permissionData] = await Promise.all([
        deviceResponse.json(), runResponse.json(), permissionResponse.json(),
      ]);
      setDevices(deviceData.devices || []);
      setRuns(runData.runs || []);
      setPermissionRequests(permissionData.requests || []);
      setPermissionGrants(permissionData.grants || []);
      setError('');
    } catch (cause: any) {
      if (!quiet) setError(cause.message || 'Runtime 状态加载失败');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const timer = window.setInterval(() => void loadData(true), 5_000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  const loadRunDetail = async (runId: string) => {
    try {
      const response = await fetch(`/api/runtime/runs/${runId}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('运行详情加载失败');
      setSelectedRun((await response.json()).run);
    } catch (cause: any) {
      setError(cause.message);
    }
  };

  const pairDevice = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch('/api/runtime/devices', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: deviceName.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '设备配对失败');
      setPairingToken(payload.token);
      await loadData(true);
    } catch (cause: any) {
      setError(cause.message);
    }
  };

  const revokeDevice = async (device: RuntimeDevice) => {
    if (!window.confirm(`撤销「${device.name}」的 Runtime 访问？本机令牌会立即失效。`)) return;
    const response = await fetch(`/api/runtime/devices/${device.id}`, { method: 'DELETE', credentials: 'same-origin' });
    if (response.ok) await loadData(true);
    else setError((await response.json()).error || '撤销失败');
  };

  const cancelRun = async (runId: string) => {
    const response = await fetch(`/api/runtime/runs/${runId}/cancel`, { method: 'POST', credentials: 'same-origin' });
    if (response.ok) {
      setSelectedRun(null);
      await loadData(true);
    } else setError((await response.json()).error || '取消失败');
  };

  const resolvePermission = async (request: PermissionRequest, decision: 'allow_once' | 'allow_always' | 'deny') => {
    setResolvingPermission(`${request.id}:${decision}`);
    setError('');
    try {
      const response = await fetch(`/api/runtime/permissions/${request.id}/resolve`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '审批失败');
      setApprovalFeedback(decision === 'deny' ? '已拒绝本地操作' : decision === 'allow_always' ? '已建立此设备的持续授权' : '已允许本次操作');
      window.setTimeout(() => setApprovalFeedback(''), 2_400);
      await loadData(true);
    } catch (cause: any) {
      setError(cause.message || '审批失败');
    } finally {
      setResolvingPermission('');
    }
  };

  const revokeGrant = async (grant: PermissionGrant) => {
    if (!window.confirm(`撤销「${grant.action_label}」在设备「${grant.device_name}」上的持续授权？`)) return;
    const response = await fetch(`/api/runtime/permissions/grants/${grant.id}`, {
      method: 'DELETE', credentials: 'same-origin',
    });
    if (!response.ok) setError((await response.json()).error || '撤销授权失败');
    else {
      setApprovalFeedback('持续授权已撤销');
      window.setTimeout(() => setApprovalFeedback(''), 2_400);
      await loadData(true);
    }
  };

  const setupCommand = useMemo(() => {
    if (!pairingToken) return '';
    const url = window.location.origin;
    return `$env:NEXUSFLOW_URL="${url}"\n$env:NEXUSFLOW_DEVICE_TOKEN="${pairingToken}"\n$env:NEXUSFLOW_ALLOWED_DIRS="D:\\NexusFlowData"\n# 可选：复制 runtime/adapters.example.json 后设置应用适配器清单\n# $env:NEXUSFLOW_ADAPTERS_FILE="D:\\NexusFlow\\runtime\\adapters.json"\nnpm --prefix runtime start`;
  }, [pairingToken]);

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopyState(label);
    window.setTimeout(() => setCopyState(''), 1_800);
  };

  const onlineCount = devices.filter(device => device.online).length;
  const activeCount = runs.filter(run => ['queued', 'claimed', 'running'].includes(run.status)).length;
  const pendingPermissions = permissionRequests.filter(request => request.status === 'pending');
  const auditRequests = permissionRequests.filter(request => request.status !== 'pending').slice(0, 12);

  return (
    <>
      <header className="workspace-header runtime-heading">
        <div><span className="eyebrow">LOCAL EXECUTION PLANE</span><h1>Runtime 与运行追踪</h1><p>让工作流在你的 AI PC 上安全执行，并逐节点查看输入、输出、耗时与错误。</p></div>
        <div className="workspace-header-actions">
          <button className="secondary-action" onClick={() => void loadData()}>刷新状态</button>
          <button className="primary-action" onClick={() => { setPairingToken(''); setShowPairing(true); }}><span>＋</span> 配对设备</button>
        </div>
      </header>

      <section className="workspace-metrics runtime-metrics" aria-label="Runtime 概览">
        <div><span>DEVICES ONLINE</span><strong className={onlineCount ? 'metric-good' : 'metric-warn'}>{String(onlineCount).padStart(2, '0')}</strong><small>{devices.length} 台已配对设备</small></div>
        <div><span>ACTIVE RUNS</span><strong>{String(activeCount).padStart(2, '0')}</strong><small>排队、认领或执行中</small></div>
        <div><span>APPROVAL INBOX</span><strong className={pendingPermissions.length ? 'metric-warn' : 'metric-good'}>{String(pendingPermissions.length).padStart(2, '0')}</strong><small>{pendingPermissions.length ? '本地操作正在等待决定' : '没有待审批操作'}</small></div>
        <div className="runtime-security-metric"><span>SECURITY</span><strong>LOCKED</strong><small>出站连接 · 无 Shell · 目录白名单</small></div>
      </section>

      {error && <div className="workspace-alert" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError('')}>×</button></div>}

      <section className="runtime-grid">
        <article className="runtime-panel device-panel">
          <div className="runtime-panel-header"><div><span>EDGE DEVICES</span><h2>本机 Runtime</h2></div><b>{onlineCount}/{devices.filter(device => !device.revokedAt).length} ONLINE</b></div>
          {loading ? <div className="runtime-empty">正在发现设备…</div> : devices.length === 0 ? (
            <div className="runtime-empty"><i>⌁</i><strong>还没有配对设备</strong><p>生成一次性设备令牌，在你的电脑上启动 Runtime。</p><button className="secondary-action" onClick={() => setShowPairing(true)}>开始配对</button></div>
          ) : (
            <div className="device-list">
              {devices.map(device => (
                <div className={`device-row ${device.revokedAt ? 'revoked' : ''}`} key={device.id}>
                  <span className={`device-signal ${device.online ? 'online' : ''}`}><i /></span>
                  <div><strong>{device.name}</strong><small>{device.revokedAt ? '访问已撤销' : device.online ? 'Runtime 在线' : `最后在线 ${formatTime(device.lastSeenAt)}`}</small></div>
                  <div className="device-capabilities"><span>{device.capabilities?.platform || 'unknown'}</span><span>{device.capabilities?.writesEnabled ? 'WRITE ON' : 'READ ONLY'}</span>{device.capabilities?.appAdapters?.length > 0 && <span>{device.capabilities.appAdapters.length} APPS</span>}</div>
                  {!device.revokedAt && <button className="runtime-link danger" onClick={() => void revokeDevice(device)}>撤销</button>}
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="runtime-panel runs-panel">
          <div className="runtime-panel-header"><div><span>EXECUTION LOG</span><h2>最近运行</h2></div><b>{runs.length} RECORDS</b></div>
          {loading ? <div className="runtime-empty">正在读取轨迹…</div> : runs.length === 0 ? (
            <div className="runtime-empty"><i>↯</i><strong>还没有运行记录</strong><p>回到工作流列表，选择“本机运行”派发第一个任务。</p></div>
          ) : (
            <div className="run-list">
              {runs.map(run => (
                <button className="run-row" key={run.id} onClick={() => void loadRunDetail(run.id)}>
                  <span className={`run-status ${run.status}`}><i />{statusLabel[run.status] || run.status}</span>
                  <div><strong>{run.workflow_name || run.workflow_id}</strong><small>{run.device_name || 'Unknown device'} · {formatTime(run.created_at)}</small></div>
                  <code>{run.id.slice(-8)}</code><b>›</b>
                </button>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className={`permission-center ${pendingPermissions.length ? 'has-pending' : ''}`}>
        <header className="permission-center-header">
          <div className="permission-center-mark"><span /><i /></div>
          <div><span>HUMAN AUTHORIZATION GATE</span><h2>权限审批中心</h2><p>Runtime 在读取文件、写入文件或启动本地应用前会暂停于此；未经明确许可不会继续。</p></div>
          <div className="permission-tabs" role="tablist" aria-label="权限中心视图">
            <button className={permissionView === 'inbox' ? 'active' : ''} onClick={() => setPermissionView('inbox')} role="tab" aria-selected={permissionView === 'inbox'}>审批收件箱 {pendingPermissions.length > 0 && <b>{pendingPermissions.length}</b>}</button>
            <button className={permissionView === 'grants' ? 'active' : ''} onClick={() => setPermissionView('grants')} role="tab" aria-selected={permissionView === 'grants'}>持续授权 <b>{permissionGrants.length}</b></button>
          </div>
        </header>

        {permissionView === 'inbox' ? <div className="permission-inbox">
          <div className="permission-list-heading"><span>PENDING DECISIONS</span><b>{pendingPermissions.length ? 'ACTION REQUIRED' : 'ALL CLEAR'}</b></div>
          {pendingPermissions.length === 0 ? <div className="permission-clear-state"><i>✓</i><div><strong>没有等待中的本地操作</strong><p>敏感动作会带着设备、工作流、能力和实际参数出现在这里。</p></div></div> : pendingPermissions.map(request => {
            const risk = request.capability === 'file.write' ? 'high' : 'guarded';
            const isResolving = resolvingPermission.startsWith(request.id);
            return <article className={`permission-request ${risk}`} key={request.id}>
              <div className="permission-risk-rail"><span>{risk === 'high' ? 'HIGH' : 'GUARDED'}</span><i /></div>
              <div className="permission-request-main">
                <div className="permission-request-title"><div><span>{request.capability}</span><h3>{request.action_label}</h3></div><time>{formatTime(request.requested_at)}</time></div>
                <div className="permission-request-meta"><span><i>PC</i>{request.device_name}</span><span><i>WF</i>{request.workflow_name}</span><span><i>ND</i>{request.node_id}</span></div>
                <details className="permission-context"><summary>查看本次操作参数 <b>⌄</b></summary><pre>{pretty(request.context)}</pre></details>
              </div>
              <div className="permission-actions">
                <button className="permission-deny" disabled={isResolving} onClick={() => void resolvePermission(request, 'deny')}>{resolvingPermission === `${request.id}:deny` ? '拒绝中…' : '拒绝'}</button>
                <button className="permission-once" disabled={isResolving} onClick={() => void resolvePermission(request, 'allow_once')}>{resolvingPermission === `${request.id}:allow_once` ? '批准中…' : '仅本次允许'}</button>
                <button className="permission-always" disabled={isResolving} onClick={() => void resolvePermission(request, 'allow_always')}>{resolvingPermission === `${request.id}:allow_always` ? '授权中…' : '始终允许此能力'}</button>
                <small>“始终允许”仅限 {request.device_name}</small>
              </div>
            </article>;
          })}

          {auditRequests.length > 0 && <div className="permission-audit">
            <div className="permission-list-heading"><span>RECENT AUDIT</span><b>IMMUTABLE EVENTS</b></div>
            {auditRequests.map(request => <div className="permission-audit-row" key={request.id}>
              <span className={`permission-decision ${request.status}`}><i />{request.status === 'allowed' ? '已允许' : request.status === 'denied' ? '已拒绝' : '已过期'}</span>
              <div><strong>{request.action_label}</strong><small>{request.device_name} · {request.workflow_name}</small></div>
              <code>{request.decision || request.status}</code><time>{formatTime(request.resolved_at || request.requested_at)}</time>
            </div>)}
          </div>}
        </div> : <div className="permission-grants">
          <div className="permission-list-heading"><span>ACTIVE DEVICE GRANTS</span><b>{permissionGrants.length} PERSISTENT</b></div>
          {permissionGrants.length === 0 ? <div className="permission-clear-state"><i>⌁</i><div><strong>没有持续授权</strong><p>选择“始终允许此能力”后，设备级授权会显示在这里，并可随时撤销。</p></div></div> : permissionGrants.map(grant => <div className="permission-grant-row" key={grant.id}>
            <span className="grant-lock"><i /></span><div><strong>{grant.action_label}</strong><small>{grant.capability}</small></div><span>{grant.device_name}</span><time>{formatTime(grant.updated_at)}</time><button onClick={() => void revokeGrant(grant)}>撤销授权</button>
          </div>)}
        </div>}
      </section>

      {showPairing && (
        <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowPairing(false); }}>
          <form className="dialog-card pairing-dialog" onSubmit={pairDevice} role="dialog" aria-modal="true">
            <div className="dialog-kicker">PAIR LOCAL RUNTIME</div>
            <button type="button" className="dialog-close" onClick={() => setShowPairing(false)}>×</button>
            <h2>连接你的 AI PC</h2>
            {!pairingToken ? <>
              <p>创建后会生成只显示一次的设备令牌。Runtime 仅向 NexusFlow 发起 HTTPS 请求，不开放本机端口。</p>
              <label className="form-field"><span>设备名称</span><div className="input-shell"><input value={deviceName} onChange={event => setDeviceName(event.target.value)} maxLength={80} required autoFocus /></div></label>
              <div className="runtime-safety-list"><span>✓ 无任意 Shell</span><span>✓ 文件目录白名单</span><span>✓ 敏感操作需审批</span></div>
              <div className="dialog-actions"><button type="button" className="secondary-action" onClick={() => setShowPairing(false)}>取消</button><button className="primary-action">生成设备令牌</button></div>
            </> : <>
              <p>复制下面的 PowerShell 命令到已克隆 NexusFlow 的电脑中运行。关闭后无法再次查看令牌。</p>
              <div className="token-warning">只显示一次 · 不要把令牌提交到 Git 或发给他人</div>
              <div className="runtime-command"><pre>{setupCommand}</pre><button type="button" onClick={() => void copy(setupCommand, 'command')}>{copyState === 'command' ? '已复制' : '复制命令'}</button></div>
              <label className="runtime-token-label">设备令牌 <button type="button" onClick={() => void copy(pairingToken, 'token')}>{copyState === 'token' ? '已复制' : '复制'}</button></label>
              <code className="runtime-token">{pairingToken}</code>
              <div className="dialog-actions"><button type="button" className="primary-action" onClick={() => setShowPairing(false)}>我已保存</button></div>
            </>}
          </form>
        </div>
      )}

      {selectedRun && (
        <div className="modal-backdrop run-detail-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedRun(null); }}>
          <section className="run-detail" role="dialog" aria-modal="true">
            <header><div><span>RUN TRACE · {selectedRun.id.slice(-8)}</span><h2>{selectedRun.workflow_name || selectedRun.workflow_id}</h2><p>{selectedRun.device_name} · {formatTime(selectedRun.created_at)}</p></div><button onClick={() => setSelectedRun(null)}>×</button></header>
            <div className="run-detail-summary"><span className={`run-status ${selectedRun.status}`}><i />{statusLabel[selectedRun.status] || selectedRun.status}</span><span>开始 {formatTime(selectedRun.started_at)}</span><span>结束 {formatTime(selectedRun.completed_at)}</span>{['queued', 'claimed', 'running'].includes(selectedRun.status) && <button onClick={() => void cancelRun(selectedRun.id)}>取消运行</button>}</div>
            {selectedRun.error && <div className="run-error">{selectedRun.error}</div>}
            <div className="trace-timeline">
              {(selectedRun.steps || []).length === 0 ? <div className="runtime-empty">等待 Runtime 回传第一个节点…</div> : selectedRun.steps!.map(step => (
                <details className={`trace-step ${step.status}`} key={step.id} open={step.status === 'failed'}>
                  <summary><i>{String(step.sequence).padStart(2, '0')}</i><div><strong>{step.node_label}</strong><span>{step.node_type} · {step.duration_ms || 0}ms</span></div><b>{step.status === 'done' ? 'DONE' : step.status.toUpperCase()}</b><em>⌄</em></summary>
                  <div className="trace-payloads"><section><span>INPUT</span><pre>{pretty(step.input)}</pre></section><section><span>OUTPUT</span><pre>{step.error || pretty(step.output)}</pre></section></div>
                </details>
              ))}
            </div>
          </section>
        </div>
      )}
      {approvalFeedback && <div className="toast approval-toast" role="status"><span>✓</span>{approvalFeedback}</div>}
    </>
  );
}
