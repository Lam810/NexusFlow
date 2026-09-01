import React from 'react';

interface WorkflowCardProps {
  workflow: { id: string; name: string; created_at: string; updated_at: string };
  index?: number;
  onEdit: (workflowId: string) => void;
  onDelete: (workflowId: string) => void;
  onRun?: (workflow: WorkflowCardProps['workflow']) => void;
  onDuplicate?: (workflowId: string) => void;
}

export default function WorkflowCard({ workflow, index = 0, onEdit, onDelete, onRun, onDuplicate }: WorkflowCardProps) {
  const timestamp = workflow.updated_at || workflow.created_at;
  const updated = new Date(timestamp.includes('T') ? timestamp : `${timestamp.replace(' ', 'T')}Z`);
  const relativeTime = (() => {
    const minutes = Math.max(0, Math.round((Date.now() - updated.getTime()) / 60_000));
    if (minutes < 1) return '刚刚更新';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`;
    return updated.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  })();

  return (
    <article
      className="workflow-card"
      style={{ '--card-delay': `${Math.min(index, 8) * 45}ms` } as React.CSSProperties}
      tabIndex={0}
      onClick={() => onEdit(workflow.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEdit(workflow.id);
        }
      }}
    >
      <div className="workflow-card-topline">
        <span className="workflow-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M5 4v5h5M19 20v-5h-5M6.4 17.6A8 8 0 0 1 5 8.5M17.6 6.4A8 8 0 0 1 19 15.5" /></svg>
        </span>
        <span className="workflow-state"><i /> READY</span>
        <button className="icon-button card-open" aria-label={`打开 ${workflow.name}`} onClick={event => { event.stopPropagation(); onEdit(workflow.id); }}>↗</button>
      </div>

      <div className="workflow-card-copy">
        <h3>{workflow.name}</h3>
        <p>Assistant workflow · {relativeTime}</p>
      </div>

      <div className="workflow-card-graph" aria-hidden="true">
        <i /><span /><i /><span /><i />
      </div>

      <footer className="workflow-card-footer">
        <span><i className="pulse-dot" /> 可运行</span>
        <div>
          {onRun && <button className="run-local-button" onClick={event => { event.stopPropagation(); onRun(workflow); }}>本机运行</button>}
          {onDuplicate && <button onClick={event => { event.stopPropagation(); onDuplicate(workflow.id); }}>复制</button>}
          <button className="danger-text" onClick={event => { event.stopPropagation(); onDelete(workflow.id); }}>删除</button>
        </div>
      </footer>
    </article>
  );
}
