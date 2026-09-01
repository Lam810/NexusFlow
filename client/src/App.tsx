import React, { useState, useEffect } from 'react'
import Auth from './Auth'
import WorkflowDashboard from './WorkflowDashboard'
import WorkflowEditor from './WorkflowEditor'

// App组件，主要负责认证和视图切换
export default function App() {
  // 认证状态
  const [user, setUser] = useState(null)
  const [token] = useState('')
  const [showAuth, setShowAuth] = useState(true)
  const [checkingSession, setCheckingSession] = useState(true)
  
  // 视图状态
  const [currentView, setCurrentView] = useState('dashboard') // 'dashboard' | 'editor'
  const [currentWorkflowId, setCurrentWorkflowId] = useState(null)

  // 通过HttpOnly会话Cookie恢复登录状态
  useEffect(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) return
        const data = await response.json()
        setUser(data.user)
        setShowAuth(false)
      })
      .catch(() => {})
      .finally(() => setCheckingSession(false))
  }, [])

  // 登录处理
  const handleLogin = (userData: any) => {
    setUser(userData)
    setShowAuth(false)
    setCurrentView('dashboard')
  }

  // 登出处理
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {}
    setUser(null)
    setShowAuth(true)
    setCurrentView('dashboard')
  }

  // 编辑工作流
  const handleEditWorkflow = (workflowId: string) => {
    setCurrentWorkflowId(workflowId)
    setCurrentView('editor')
  }

  // 返回仪表板
  const handleBackToDashboard = () => {
    setCurrentView('dashboard')
    setCurrentWorkflowId(null)
  }

  // 保存工作流
  const handleSaveWorkflow = (workflowId: string, name: string) => {
    console.log('工作流已保存:', workflowId, name)
  }

  if (checkingSession) {
    return <div className="session-loading">正在检查登录状态…</div>
  }

  // 如果未认证，显示登录界面
  if (showAuth) {
    return <Auth onLogin={handleLogin} />
  }

  // 根据当前视图显示不同界面
  if (currentView === 'dashboard') {
                          return (
      <WorkflowDashboard
        token={token}
        onEditWorkflow={handleEditWorkflow}
        onLogout={handleLogout}
        user={user}
      />
    )
  }

  if (currentView === 'editor') {
      return (
      <WorkflowEditor
        workflowId={currentWorkflowId || 'new'}
        token={token}
        user={user}
        onBack={handleBackToDashboard}
        onSave={handleSaveWorkflow}
      />
    )
  }

  // 默认返回仪表板
  return (
    <WorkflowDashboard
      token={token}
      onEditWorkflow={handleEditWorkflow}
      onLogout={handleLogout}
      user={user}
    />
  )
}
