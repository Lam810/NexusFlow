import React, { useState, useEffect } from 'react';
import WorkflowCard from './WorkflowCard';

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

export default function WorkflowDashboard({ token, onEditWorkflow, onLogout, user }: WorkflowDashboardProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState('');

  // 加载工作流列表
  const loadWorkflows = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/workflows', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('加载工作流失败');
      }

      const data = await response.json();
      setWorkflows(data.workflows);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 创建工作流
  const handleCreateWorkflow = async () => {
    if (!newWorkflowName.trim()) {
      setError('请输入工作流名称');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/workflows', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: newWorkflowName,
          nodes: [
            {
              id: 'start',
              type: 'start',
              position: { x: 100, y: 100 },
              data: { label: '开始' }
            }
          ],
          edges: []
        })
      });

      if (!response.ok) {
        throw new Error('创建工作流失败');
      }

      setShowCreateDialog(false);
      setNewWorkflowName('');
      loadWorkflows();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 删除工作流
  const handleDeleteWorkflow = async (workflowId: string) => {
    if (!confirm('确定要删除这个工作流吗？')) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('删除工作流失败');
      }

      loadWorkflows();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 复制工作流
  const handleDuplicateWorkflow = async (workflowId: string) => {
    try {
      // 先获取原工作流
      const response = await fetch(`/api/workflows/${workflowId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('获取工作流失败');
      }

      const data = await response.json();
      const originalWorkflow = data.workflow;

      // 创建副本
      const duplicateResponse = await fetch('/api/workflows', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: `${originalWorkflow.name} (副本)`,
          nodes: originalWorkflow.nodes,
          edges: originalWorkflow.edges
        })
      });

      if (!duplicateResponse.ok) {
        throw new Error('复制工作流失败');
      }

      loadWorkflows();
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadWorkflows();
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px'
    }}>
      {/* 头部 */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '30px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h1 style={{
              margin: '0 0 8px 0',
              fontSize: '28px',
              fontWeight: 'bold',
              color: '#333',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              NexusFlow Assistant Studio
            </h1>
            <p style={{
              margin: '0',
              color: '#666',
              fontSize: '16px'
            }}>
              Welcome back, {user?.username}. Build and manage assistant workflows for AI PC and device-side scenarios.
            </p>
          </div>
          
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button
              onClick={() => setShowCreateDialog(true)}
              style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                transition: 'all 0.3s',
                boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.3)';
              }}
            >
              + 新建工作流
            </button>
            
            <button
              onClick={onLogout}
              style={{
                background: '#ff4757',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                transition: 'all 0.3s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#ff3742';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#ff4757';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              登出
            </button>
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={{
          background: '#fee',
          color: '#c33',
          padding: '16px',
          borderRadius: '8px',
          marginBottom: '20px',
          fontSize: '14px',
          border: '1px solid #fcc'
        }}>
          {error}
        </div>
      )}

      {/* 工作流列表 */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '30px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
      }}>
        {loading ? (
          <div style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: '#666'
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '4px solid #f3f3f3',
              borderTop: '4px solid #667eea',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 20px'
            }} />
            <p style={{ margin: 0, fontSize: '16px' }}>加载工作流中...</p>
          </div>
        ) : workflows.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: '#666'
          }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '20px'
            }}>
              📋
            </div>
            <h3 style={{
              margin: '0 0 12px 0',
              fontSize: '20px',
              color: '#333'
            }}>
              还没有工作流
            </h3>
            <p style={{
              margin: '0 0 24px 0',
              fontSize: '16px'
            }}>
              点击"新建工作流"开始创建您的第一个AI工作流
            </p>
            <button
              onClick={() => setShowCreateDialog(true)}
              style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600'
              }}
            >
              创建第一个工作流
            </button>
          </div>
        ) : (
          <div>
            <h2 style={{
              margin: '0 0 24px 0',
              fontSize: '20px',
              color: '#333',
              fontWeight: '600'
            }}>
              我的工作流 ({workflows.length})
            </h2>
            
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '20px'
            }}>
              {workflows.map((workflow) => (
                <WorkflowCard
                  key={workflow.id}
                  workflow={workflow}
                  onEdit={onEditWorkflow}
                  onDelete={handleDeleteWorkflow}
                  onDuplicate={handleDuplicateWorkflow}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 创建工作流对话框 */}
      {showCreateDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            padding: '30px',
            borderRadius: '12px',
            width: '400px',
            maxWidth: '90vw',
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
          }}>
            <h3 style={{
              margin: '0 0 20px 0',
              fontSize: '20px',
              color: '#333',
              fontWeight: '600'
            }}>
              创建新工作流
            </h3>
            
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                color: '#333',
                fontWeight: '500',
                fontSize: '14px'
              }}>
                工作流名称
              </label>
              <input
                type="text"
                value={newWorkflowName}
                onChange={(e) => setNewWorkflowName(e.target.value)}
                placeholder="请输入工作流名称"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '2px solid #e1e5e9',
                  borderRadius: '8px',
                  fontSize: '16px',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.3s'
                }}
                onFocus={(e) => e.target.style.borderColor = '#667eea'}
                onBlur={(e) => e.target.style.borderColor = '#e1e5e9'}
                autoFocus
              />
            </div>

            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => {
                  setShowCreateDialog(false);
                  setNewWorkflowName('');
                }}
                style={{
                  padding: '12px 24px',
                  border: '1px solid #e1e5e9',
                  background: 'white',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#666'
                }}
              >
                取消
              </button>
              <button
                onClick={handleCreateWorkflow}
                disabled={loading}
                style={{
                  padding: '12px 24px',
                  background: loading ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '600'
                }}
              >
                {loading ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
