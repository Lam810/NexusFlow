import React, { FormEvent, useEffect, useState } from 'react';

interface ModelSettingsProps { onClose: () => void }
interface ModelConfigResponse {
  configured: boolean; baseUrl: string; model: string; embeddingModel: string; hasApiKey: boolean; error?: string;
}

const presets = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  { id: 'custom', label: '自定义', baseUrl: '', model: '' },
];

export default function ModelSettings({ onClose }: ModelSettingsProps) {
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-4.1-mini');
  const [embeddingModel, setEmbeddingModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [activePreset, setActivePreset] = useState('openai');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearPending, setClearPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    fetch('/api/model-config', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        const data = await response.json() as ModelConfigResponse;
        if (!response.ok) throw new Error(data.error || '加载模型配置失败');
        if (data.configured) {
          setBaseUrl(data.baseUrl); setModel(data.model); setEmbeddingModel(data.embeddingModel || ''); setConfigured(true);
          const preset = presets.find(item => item.baseUrl && item.baseUrl === data.baseUrl);
          setActivePreset(preset?.id || 'custom');
        }
        setHasApiKey(data.hasApiKey);
      })
      .catch(cause => setError(cause.message))
      .finally(() => setLoading(false));
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const choosePreset = (id: string) => {
    const preset = presets.find(item => item.id === id)!;
    setActivePreset(id);
    if (preset.baseUrl) setBaseUrl(preset.baseUrl);
    if (preset.model) setModel(preset.model);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setSuccess(''); setClearPending(false);
    try {
      const response = await fetch('/api/model-config', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, model, embeddingModel, apiKey }),
      });
      const data = await response.json() as ModelConfigResponse;
      if (!response.ok) throw new Error(data.error || '保存模型配置失败');
      setConfigured(true); setHasApiKey(data.hasApiKey); setApiKey('');
      setSuccess('配置已安全保存，所有工作流将优先使用此模型。');
    } catch (cause: any) { setError(cause.message); }
    finally { setSaving(false); }
  };

  const handleClear = async () => {
    if (!clearPending) { setClearPending(true); window.setTimeout(() => setClearPending(false), 3_000); return; }
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/model-config', { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) throw new Error('清除模型配置失败');
      setConfigured(false); setHasApiKey(false); setApiKey(''); setClearPending(false); setSuccess('模型配置已清除。');
    } catch (cause: any) { setError(cause.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop model-modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="dialog-card model-dialog" onSubmit={handleSubmit} role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
        <header className="model-dialog-header">
          <div className="model-orb"><span /><i /></div>
          <div><div className="dialog-kicker">MODEL CONNECTION</div><h2 id="model-settings-title">连接模型服务</h2><p>使用 OpenAI 兼容协议为当前账号配置推理能力。</p></div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭">×</button>
        </header>

        <div className="secure-callout"><svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" /></svg><div><strong>用户自有凭证</strong><span>API Key 加密存储，不会返回浏览器，也不会写入工作流。</span></div>{configured && <b><i /> CONNECTED</b>}</div>

        <div className="preset-picker" role="group" aria-label="服务预设">
          {presets.map(preset => <button key={preset.id} type="button" className={activePreset === preset.id ? 'active' : ''} onClick={() => choosePreset(preset.id)}>{preset.label}{activePreset === preset.id && <span>✓</span>}</button>)}
        </div>

        {loading ? (
          <div className="model-loading"><i className="spinner" /><span>正在读取安全配置…</span></div>
        ) : (
          <div className="model-form-grid">
            <label className="form-field full"><span>Base URL</span><div className="input-shell protocol-input"><b>HTTPS</b><input type="url" required value={baseUrl} onChange={event => { setBaseUrl(event.target.value); setActivePreset('custom'); }} placeholder="https://api.example.com/v1" /></div><small>填写 API 版本根路径；系统自动追加 /chat/completions。</small></label>
            <label className="form-field"><span>Chat Model</span><div className="input-shell"><input required value={model} onChange={event => setModel(event.target.value)} placeholder="模型 ID" /></div><small>用于对话、分析和语义判断。</small></label>
            <label className="form-field"><span>Embedding Model <em>可选</em></span><div className="input-shell"><input value={embeddingModel} onChange={event => setEmbeddingModel(event.target.value)} placeholder="text-embedding-3-small" /></div><small>知识库检索和长期记忆需要。</small></label>
            <label className="form-field full"><span>API Key</span><div className="input-shell"><svg viewBox="0 0 24 24"><path d="M14 6a4 4 0 1 1-2.7 6.9L4 20v-4l2-2h3l2.3-2.3" /></svg><input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} required={!hasApiKey} autoComplete="new-password" placeholder={hasApiKey ? '••••••••••••  已安全保存，留空保持不变' : '输入服务商 API Key'} /></div></label>
          </div>
        )}

        {error && <div className="inline-alert" role="alert"><span>!</span>{error}</div>}
        {success && <div className="inline-alert success" role="status"><span>✓</span>{success}</div>}

        <footer className="model-dialog-footer">
          <div>{configured && <button type="button" className={`clear-model-action ${clearPending ? 'armed' : ''}`} disabled={saving} onClick={handleClear}>{clearPending ? '再次点击确认清除' : '清除当前配置'}</button>}</div>
          <div><button type="button" className="secondary-action" onClick={onClose}>取消</button><button className="primary-action" type="submit" disabled={loading || saving}>{saving ? <><i className="spinner" />保存中</> : <>保存并启用 <span>→</span></>}</button></div>
        </footer>
      </form>
    </div>
  );
}
