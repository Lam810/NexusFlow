export class RuntimeClient {
  constructor({ baseUrl, token, timeoutMs = 65_000 }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.token = String(token || '');
    this.timeoutMs = timeoutMs;
  }

  async request(path, body = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': '@nexusflow/local-runtime/0.2.0',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text || `HTTP ${response.status}` };
    }
    if (!response.ok) {
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  heartbeat(capabilities) {
    return this.request('/api/runtime/agent/heartbeat', { capabilities });
  }

  async claim() {
    return (await this.request('/api/runtime/agent/jobs/claim')).job || null;
  }

  start(runId) {
    return this.request(`/api/runtime/agent/runs/${encodeURIComponent(runId)}/start`);
  }

  trace(runId, step) {
    return this.request(`/api/runtime/agent/runs/${encodeURIComponent(runId)}/steps`, step);
  }

  complete(runId, result) {
    return this.request(`/api/runtime/agent/runs/${encodeURIComponent(runId)}/complete`, result);
  }

  requestPermission(request) {
    return this.request('/api/runtime/agent/permissions/request', request);
  }

  permissionStatus(requestId) {
    return this.request(`/api/runtime/agent/permissions/${encodeURIComponent(requestId)}/status`);
  }

  expirePermission(requestId) {
    return this.request(`/api/runtime/agent/permissions/${encodeURIComponent(requestId)}/expire`);
  }

  async ensurePermission(request, { timeoutMs = 300_000, pollMs = 1_500 } = {}) {
    const initial = await this.requestPermission(request);
    if (initial.status === 'allowed') return initial;
    if (initial.status !== 'pending') throw new Error('本地操作权限未获批准');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, pollMs));
      const current = await this.permissionStatus(initial.requestId);
      if (current.status === 'allowed') return { ...current, requestId: initial.requestId };
      if (current.status === 'denied') throw new Error('用户拒绝了本地操作权限');
      if (current.status === 'expired') throw new Error('本地操作权限申请已过期');
    }
    try {
      await this.expirePermission(initial.requestId);
    } catch {
      // The user may have resolved the request at the timeout boundary.
      const final = await this.permissionStatus(initial.requestId);
      if (final.status === 'allowed') return { ...final, requestId: initial.requestId };
      if (final.status === 'denied') throw new Error('用户拒绝了本地操作权限');
    }
    throw new Error(`等待本地操作审批超时（${Math.round(timeoutMs / 1000)} 秒）`);
  }

  modelChat(request) {
    return this.request('/api/runtime/agent/model/chat', request);
  }
}
