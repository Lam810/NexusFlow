import React, { useState, useEffect } from 'react';

interface Workflow {
  id: string;
  name: string;
  nodes: any[];
  edges: any[];
  created_at: string;
  updated_at: string;
}

interface WorkflowManagerProps {
  token: string;
  onLoadWorkflow: (nodes: any[], edges: any[]) => void;
  onSaveWorkflow: (name: string, nodes: any[], edges: any[]) => void;
  currentNodes: any[];
  currentEdges: any[];
}

export default function WorkflowManager({ 
  token, 
  onLoadWorkflow, 
  onSaveWorkflow, 
  currentNodes, 
  currentEdges 
}: WorkflowManagerProps) {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);

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

  // 保存工作流
  const handleSaveWorkflow = async () => {
    if (!workflowName.trim()) {
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
          name: workflowName,
          nodes: currentNodes,
          edges: currentEdges
        })
      });

      if (!response.ok) {
        throw new Error('保存工作流失败');
      }

      setShowSaveDialog(false);
      setWorkflowName('');
      loadWorkflows();
      onSaveWorkflow(workflowName, currentNodes, currentEdges);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 加载工作流
  const handleLoadWorkflow = async (workflowId: string) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('加载工作流失败');
      }

      const data = await response.json();
      onLoadWorkflow(data.workflow.nodes, data.workflow.edges);
      setSelectedWorkflow(workflowId);
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
      if (selectedWorkflow === workflowId) {
        setSelectedWorkflow(null);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkflows();
  }, []);

  return (
    <div style={{
      background: 'white',
      border: '1px solid #e1e5e9',
      borderRadius: '8px',
      padding: '20px',
      marginBottom: '20px'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h3 style={{ margin: 0, color: '#333' }}>工作流管理</h3>
        <button
          onClick={() => setShowSaveDialog(true)}
          style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          保存当前工作流
        </button>
      </div>

      {error && (
        <div style={{
          background: '#fee',
          color: '#c33',
          padding: '12px',
          borderRadius: '6px',
          marginBottom: '15px',
          fontSize: '14px'
        }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
          加载中...
        </div>
      )}

      {!loading && workflows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
          暂无保存的工作流
        </div>
      )}

      {!loading && workflows.length > 0 && (
        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
          {workflows.map((workflow) => (
            <div
              key={workflow.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px',
                border: '1px solid #e1e5e9',
                borderRadius: '6px',
                marginBottom: '8px',
                background: selectedWorkflow === workflow.id ? '#f0f4ff' : 'white',
                cursor: 'pointer'
              }}
              onClick={() => handleLoadWorkflow(workflow.id)}
            >
              <div>
                <div style={{ fontWeight: '500', color: '#333', marginBottom: '4px' }}>
                  {workflow.name}
                </div>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  更新于: {new Date(workflow.updated_at).toLocaleString()}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteWorkflow(workflow.id);
                }}
                style={{
                  background: '#ff4757',
                  color: 'white',
                  border: 'none',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 保存对话框 */}
      {showSaveDialog && (
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
            maxWidth: '90vw'
          }}>
            <h3 style={{ margin: '0 0 20px 0', color: '#333' }}>保存工作流</h3>
            
            <div style={{ marginBottom: '20px' }}>
              <label style={{ 
                display: 'block', 
                marginBottom: '8px', 
                color: '#333',
                fontWeight: '500'
              }}>
                工作流名称
              </label>
              <input
                type="text"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder="请输入工作流名称"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '2px solid #e1e5e9',
                  borderRadius: '8px',
                  fontSize: '16px',
                  boxSizing: 'border-box'
                }}
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowSaveDialog(false);
                  setWorkflowName('');
                }}
                style={{
                  padding: '10px 20px',
                  border: '1px solid #e1e5e9',
                  background: 'white',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                取消
              </button>
              <button
                onClick={handleSaveWorkflow}
                disabled={loading}
                style={{
                  padding: '10px 20px',
                  background: loading ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                {loading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
