import React from 'react';

interface WorkflowCardProps {
  workflow: {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
  };
  onEdit: (workflowId: string) => void;
  onDelete: (workflowId: string) => void;
  onDuplicate?: (workflowId: string) => void;
}

export default function WorkflowCard({ workflow, onEdit, onDelete, onDuplicate }: WorkflowCardProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      padding: '20px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      border: '1px solid #e1e5e9',
      transition: 'all 0.3s ease',
      cursor: 'pointer',
      position: 'relative',
      overflow: 'hidden'
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'translateY(-4px)';
      e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
    }}
    onClick={() => onEdit(workflow.id)}
    >
      {/* 装饰性背景 */}
      <div style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: '60px',
        height: '60px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        borderRadius: '0 12px 0 60px',
        opacity: 0.1
      }} />
      
      {/* 工作流图标 */}
      <div style={{
        width: '48px',
        height: '48px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        borderRadius: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '16px',
        fontSize: '24px'
      }}>
        🔄
      </div>

      {/* 工作流名称 */}
      <h3 style={{
        margin: '0 0 8px 0',
        fontSize: '18px',
        fontWeight: '600',
        color: '#333',
        lineHeight: '1.3'
      }}>
        {workflow.name}
      </h3>

      {/* 创建时间 */}
      <div style={{
        fontSize: '12px',
        color: '#666',
        marginBottom: '4px'
      }}>
        创建于: {formatDate(workflow.created_at)}
      </div>

      {/* 更新时间 */}
      <div style={{
        fontSize: '12px',
        color: '#666',
        marginBottom: '16px'
      }}>
        更新于: {formatDate(workflow.updated_at)}
      </div>

      {/* 操作按钮 */}
      <div style={{
        display: 'flex',
        gap: '8px',
        justifyContent: 'flex-end'
      }}>
        {onDuplicate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(workflow.id);
            }}
            style={{
              background: '#f8f9fa',
              border: '1px solid #e1e5e9',
              color: '#666',
              padding: '6px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#e9ecef';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f8f9fa';
            }}
          >
            复制
          </button>
        )}
        
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(workflow.id);
          }}
          style={{
            background: '#ff4757',
            border: 'none',
            color: 'white',
            padding: '6px 12px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '12px',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#ff3742';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#ff4757';
          }}
        >
          删除
        </button>
      </div>
    </div>
  );
}
