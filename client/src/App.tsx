import React, { useState, useEffect } from 'react'
import Auth from './Auth'
import WorkflowDashboard from './WorkflowDashboard'
import WorkflowEditor from './WorkflowEditor'

// 简化的App组件，主要负责认证和视图切换
export default function App() {
  // 认证状态
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [showAuth, setShowAuth] = useState(true)
  
  // 视图状态
  const [currentView, setCurrentView] = useState('dashboard') // 'dashboard' | 'editor'
  const [currentWorkflowId, setCurrentWorkflowId] = useState(null)

  // 检查本地存储的认证信息
  useEffect(() => {
    const savedToken = localStorage.getItem('token')
    const savedUser = localStorage.getItem('user')
    
    if (savedToken && savedUser) {
      setToken(savedToken)
      setUser(JSON.parse(savedUser))
      setShowAuth(false)
    }
  }, [])

  // 登录处理
  const handleLogin = (userData: any, userToken: string) => {
    setUser(userData)
    setToken(userToken)
    setShowAuth(false)
    setCurrentView('dashboard')
  }

  // 登出处理
  const handleLogout = () => {
    setUser(null)
    setToken(null)
    setShowAuth(true)
    setCurrentView('dashboard')
    localStorage.removeItem('token')
    localStorage.removeItem('user')
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
  const handleSaveWorkflow = async (workflowId: string, name: string, nodes: any[], edges: any[]) => {
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, nodes, edges })
      })

      if (!response.ok) {
        throw new Error('保存工作流失败')
      }

      console.log('工作流已保存:', name)
    } catch (error) {
      console.error('保存工作流失败:', error)
    }
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
