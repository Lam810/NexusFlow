import React, { FormEvent, useEffect, useState } from 'react';

interface AuthProps {
  onLogin: (user: any) => void;
}

function NexusMark() {
  return (
    <span className="nexus-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export default function Auth({ onLogin }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [registrationEnabled, setRegistrationEnabled] = useState(false);

  useEffect(() => {
    fetch('/api/auth/config', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setRegistrationEnabled(Boolean(data.registrationEnabled)))
      .catch(() => setRegistrationEnabled(false));
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setFormData(previous => ({ ...previous, [name]: value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (!isLogin && formData.password !== formData.confirmPassword) {
        throw new Error('两次输入的密码不一致');
      }
      const response = await fetch(isLogin ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isLogin
          ? { username: formData.username, password: formData.password }
          : { username: formData.username, email: formData.email, password: formData.password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (isLogin ? '登录失败' : '注册失败'));
      onLogin(data.user);
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setIsLogin(value => !value);
    setError('');
    setFormData({ username: '', email: '', password: '', confirmPassword: '' });
  };

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="NexusFlow 产品介绍">
        <div className="auth-atmosphere auth-atmosphere-one" />
        <div className="auth-atmosphere auth-atmosphere-two" />
        <div className="brand-lockup">
          <NexusMark />
          <div><strong>NexusFlow</strong><span>ASSISTANT STUDIO</span></div>
        </div>

        <div className="auth-story-copy">
          <span className="eyebrow"><i /> AI PC ORCHESTRATION LAYER</span>
          <h1>让设备理解意图，<br />让智能真正流动。</h1>
          <p>在一个可视化工作区中连接模型、知识、工具与设备能力，构建可观察、可迭代的个人智能体。</p>
        </div>

        <div className="auth-flow-preview" aria-hidden="true">
          <div className="flow-line flow-line-one" />
          <div className="flow-line flow-line-two" />
          <div className="mini-node mini-node-trigger"><i>01</i><strong>Intent</strong><span>用户意图</span></div>
          <div className="mini-node mini-node-reason"><i>02</i><strong>Reason</strong><span>模型推理</span></div>
          <div className="mini-node mini-node-act"><i>03</i><strong>Act</strong><span>设备执行</span></div>
          <span className="signal-dot signal-dot-one" />
          <span className="signal-dot signal-dot-two" />
        </div>

        <div className="auth-proof">
          <div><strong>LOCAL + CLOUD</strong><span>混合模型路由</span></div>
          <div><strong>VISUAL GRAPH</strong><span>可视化编排</span></div>
          <div><strong>USER-OWNED</strong><span>用户自有密钥</span></div>
        </div>
      </section>

      <section className="auth-access">
        <div className="auth-mobile-brand brand-lockup">
          <NexusMark />
          <div><strong>NexusFlow</strong><span>ASSISTANT STUDIO</span></div>
        </div>
        <div className={`auth-card ${error ? 'has-error' : ''}`}>
          <div className="auth-status"><i /> PRIVATE WORKSPACE</div>
          <h2>{isLogin ? '欢迎回来' : '创建工作区'}</h2>
          <p className="auth-subtitle">{isLogin ? '登录并继续构建你的 AI PC 助手' : '创建属于你的智能体编排空间'}</p>

          <form onSubmit={handleSubmit}>
            <label className="form-field">
              <span>用户名</span>
              <div className="input-shell">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" /></svg>
                <input name="username" value={formData.username} onChange={handleInputChange} autoComplete="username" placeholder="输入用户名" required autoFocus />
              </div>
            </label>

            {!isLogin && (
              <label className="form-field">
                <span>邮箱</span>
                <div className="input-shell">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 9 7 9-7M4 5h16a1 1 0 0 1 1 1v12H3V6a1 1 0 0 1 1-1Z" /></svg>
                  <input type="email" name="email" value={formData.email} onChange={handleInputChange} autoComplete="email" placeholder="name@example.com" required />
                </div>
              </label>
            )}

            <label className="form-field">
              <span>密码</span>
              <div className="input-shell">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10V8a6 6 0 0 1 12 0v2M5 10h14v11H5V10Z" /></svg>
                <input
                  type={showPassword ? 'text' : 'password'} name="password" value={formData.password}
                  onChange={handleInputChange} minLength={isLogin ? undefined : 12} maxLength={128}
                  autoComplete={isLogin ? 'current-password' : 'new-password'} placeholder="输入密码" required
                />
                <button type="button" className="input-action" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
                  {showPassword ? '隐藏' : '显示'}
                </button>
              </div>
            </label>

            {!isLogin && (
              <label className="form-field">
                <span>确认密码</span>
                <div className="input-shell">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10V8a6 6 0 0 1 12 0v2M5 10h14v11H5V10Z" /></svg>
                  <input type="password" name="confirmPassword" value={formData.confirmPassword} onChange={handleInputChange} minLength={12} maxLength={128} autoComplete="new-password" placeholder="再次输入密码" required />
                </div>
              </label>
            )}

            {error && <div className="inline-alert" role="alert"><span>!</span>{error}</div>}

            <button className="primary-action auth-submit" type="submit" disabled={loading}>
              {loading ? <><i className="spinner" />正在连接工作区</> : <>{isLogin ? '进入工作区' : '创建并进入'}<span>→</span></>}
            </button>

            {(registrationEnabled || !isLogin) && (
              <button type="button" className="text-action" onClick={switchMode}>
                {isLogin ? '还没有账户？创建工作区' : '已有账户？返回登录'}
              </button>
            )}
          </form>

          <div className="auth-footnote"><span>端到端会话保护</span><span>用户数据隔离</span></div>
        </div>
      </section>
    </main>
  );
}
