import React, { useCallback, useMemo, useState } from 'react'
import ReactFlow, {
  addEdge,
  Background,
  Connection,
  Controls,
  Edge,
  MiniMap,
  Node,
  useEdgesState,
  useNodesState,
  Handle,
  Position,
} from 'reactflow'

type KnowledgeMatch = { id: string; text: string; score?: number; similarity?: number }

type RunContext = {
  query: string
  variables: Record<string, any>
  knowledgeMatches?: KnowledgeMatch[]
  llmText?: string
}

type KbConfig = { topK: number }
type LlmConfig = {
  model: string
  temperature: number
  systemPrompt: string
  userPrompt: string
  apiKey: string
  apiUrl: string
  provider?: 'qwen' | 'openai' | 'local'
}
type AnswerConfig = { mode: 'llm' | 'template'; template: string }
type HttpConfig = {
  method: string
  url: string
  headers: Array<{key: string, value: string}>
  bodyType: 'none' | 'text' | 'json'
  bodyText: string
  bodyJson: string
  variables: Array<{key: string, value: string}>
}
type CondClause = {
  variable: string
  operator: 'contains' | 'not_contains' | 'start_with' | 'end_with' | 'is' | 'is_not' | 'is_empty' | 'is_not_empty'
  value?: string
}
type CondConfig = {
  if: CondClause
  elifs: CondClause[]
  elseEnabled: boolean
}

function CardNode({ data, id }: any) {
  const showLeft = data?.handles?.includes('left')
  const showRight = data?.handles?.includes('right')
  const showMultiple = data?.handles?.includes('multiple')
  
  return (
    <div className={`node-card ${data?.theme || ''} ${data?.runtimeStatus ? `status-${data.runtimeStatus}` : ''}`} id={`node-${id}`}>
      <div className="node-icon">{data?.icon || '⬢'}</div>
      <div className="node-content">
        <div className="node-title">{data?.label}</div>
        {data?.subtitle ? <div className="node-subtitle">{data.subtitle}</div> : null}
      </div>
      {showLeft && <Handle type="target" position={Position.Left} />}
      {showRight && <Handle type="source" position={Position.Right} />}
      {showMultiple && (
        <>
          <Handle type="source" position={Position.Right} id="if" style={{ top: '30%', background: '#10b981' }} />
          <Handle type="source" position={Position.Right} id="else" style={{ top: '70%', background: '#ef4444' }} />
        </>
      )}
    </div>
  )
}

const nodeTypes = { card: CardNode }

const initialNodes: Node[] = [
  { id: 'start', type: 'card', position: { x: 50, y: 80 }, data: { label: '开始', icon: '🔵', theme: 'theme-blue', handles: ['right'], config: { } } },
  { id: 'cond', type: 'card', position: { x: 180, y: 60 }, data: { label: '条件分支', icon: '🧩', theme: 'theme-cyan', handles: ['left','multiple'], config: { if: { variable: 'query', operator: 'contains', value: '技术' }, elifs: [], elseEnabled: true } as CondConfig } },
  { id: 'kb', type: 'card', position: { x: 300, y: 30 }, data: { label: '知识检索', icon: '📚', theme: 'theme-green', handles: ['left','right'], config: { topK: 3 } as KbConfig } },
  { id: 'llm', type: 'card', position: { x: 550, y: 30 }, data: { label: 'LLM', icon: '🤖', theme: 'theme-purple', handles: ['left','right'], config: { model: 'qwen-plus', temperature: 0.7, systemPrompt: '你是一个有用的中文助手。回答时要基于提供的知识片段，若无依据要明确说明。', userPrompt: '用户问题：{{query}}\n\n知识片段：\n{{kb_text}}' } as LlmConfig } },
  { id: 'reply', type: 'card', position: { x: 800, y: 30 }, data: { label: '直接回复', icon: '🟠', theme: 'theme-orange', handles: ['left'], config: { mode: 'llm', template: '{{llm_text}}' } as AnswerConfig } },
  { id: 'reply-else', type: 'card', position: { x: 300, y: 120 }, data: { label: '直接回复', icon: '🟠', theme: 'theme-orange', handles: ['left'], config: { mode: 'template', template: '这是 ELSE 分支：{{query}}' } as AnswerConfig } },
]

const initialEdges: Edge[] = [
  { id: 'e1', source: 'start', target: 'cond' },
  { id: 'e1b', source: 'cond', sourceHandle: 'if', target: 'kb' },
  { id: 'e2', source: 'kb', target: 'llm' },
  { id: 'e3', source: 'llm', target: 'reply' },
  { id: 'e4', source: 'cond', sourceHandle: 'else', target: 'reply-else' },
]

async function api(path: string, body?: any) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

function renderTemplate(tpl: string, vars: Record<string, any>): string {
  return tpl.replace(/\{\{\s*([\w_.]+)\s*\}\}/g, (_m, key) => {
    const parts = String(key).split('.')
    let val: any = vars
    for (const p of parts) {
      if (val == null) return ''
      val = val[p]
    }
    if (Array.isArray(val)) return val.join('\n')
    return val == null ? '' : String(val)
  })
}

async function runFlow(
  query: string,
  nodes: Node[],
  edges: Edge[],
  onStatus?: (nodeId: string, status: 'running' | 'done') => void,
  onOutput?: (nodeId: string, output: string) => void,
): Promise<RunContext> {
  const ctx: RunContext = { query, variables: { query } }

  // 条件分支执行函数
  function executeConditionalNode(nodeId: string): string | null {
    const cnode = nodes.find((n) => n.id === nodeId)
    if (!cnode) return null
    
    const cfg = (cnode.data?.config || { if: { variable: 'query', operator: 'contains', value: '' }, elifs: [], elseEnabled: true }) as CondConfig
    
    function getVal(path: string): any {
      const parts = String(path || '').split('.')
      let v: any = ctx.variables
      for (const p of parts) { if (v == null) return undefined; v = v[p] }
      return v
    }
    
    function test(clause: CondClause): boolean {
      const v = getVal(clause.variable)
      const s = v == null ? '' : String(v)
      const t = clause.value ?? ''
      switch (clause.operator) {
        case 'contains': return s.includes(t)
        case 'not_contains': return !s.includes(t)
        case 'start_with': return s.startsWith(t)
        case 'end_with': return s.endsWith(t)
        case 'is': return s === t
        case 'is_not': return s !== t
        case 'is_empty': return s.length === 0
        case 'is_not_empty': return s.length > 0
      }
      return false
    }
    
    // 判断条件并返回对应的分支
    if (test(cfg.if)) return 'if'
    for (let i = 0; i < (cfg.elifs || []).length; i++) {
      if (test(cfg.elifs[i])) return `elif_${i+1}`
    }
    return cfg.elseEnabled ? 'else' : null
  }

  // 递归执行节点
  async function executeNode(nodeId: string) {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return

    const nodeType = nodeId.split('-')[0]
    if (onStatus) onStatus(nodeId, 'running')
    
    if (nodeType === 'cond') {
      const branch = executeConditionalNode(nodeId)
      ctx.variables.condition = { branch }
      
      // 根据分支结果找到对应的边并执行后续节点
      const outgoingEdges = edges.filter(e => e.source === nodeId)
      for (const edge of outgoingEdges) {
        const sourceHandle = edge.sourceHandle
        if (sourceHandle === branch || (branch === 'else' && sourceHandle === 'else')) {
          await executeNode(edge.target)
        }
      }
      if (onStatus) onStatus(nodeId, 'done')
      return
    }
    if (nodeType === 'kb') {
      const cfg = (node.data?.config || { topK: 3 }) as KbConfig
      const search = await api('/api/vector/search', { query, topK: cfg.topK })
      ctx.knowledgeMatches = search.matches
      ctx.variables.kb = { result: search.matches }
      ctx.variables.kb_text = (search.matches as KnowledgeMatch[]).map((m) => `【得分${(m.score || m.similarity || 0).toFixed(2)}】${m.text}`).join('\n')
      if (onOutput) onOutput(nodeId, ctx.variables.kb_text)
    }
    
    if (nodeType === 'http') {
      const cfg = node.data?.config as HttpConfig
      if (cfg) {
        const httpResult = await api('/api/http-request', {
          method: cfg.method,
          url: cfg.url,
          headers: cfg.headers.reduce((acc, h) => {
            if (h.key && h.value) acc[h.key] = h.value
            return acc
          }, {} as Record<string, string>),
          body: cfg.bodyType === 'text' ? cfg.bodyText : 
                cfg.bodyType === 'json' ? JSON.parse(cfg.bodyJson) : null,
          variables: cfg.variables.reduce((acc, v) => {
            if (v.key && v.value) acc[v.key] = v.value
            return acc
          }, {} as Record<string, string>)
        })
        ctx.variables.http_data = httpResult.json || httpResult.content
        ctx.variables.http_text = JSON.stringify(httpResult.json || httpResult.content, null, 2)
        if (onOutput) onOutput(nodeId, ctx.variables.http_text)
      }
    }
    
    if (nodeType === 'llm') {
      const cfg = (node.data?.config || {}) as LlmConfig
      const user = renderTemplate(cfg.userPrompt || '{{query}}', ctx.variables)
      const sys = renderTemplate(cfg.systemPrompt || '', ctx.variables)
      const messages = [
        ...(sys ? [{ role: 'system', content: sys }] : []),
        { role: 'user', content: user },
      ]
      const chat = await api('/api/chat', { 
        model: cfg.model || 'qwen-plus', 
        temperature: cfg.temperature ?? 0.7, 
        messages,
        apiKey: cfg.apiKey,
        apiUrl: cfg.apiUrl,
        provider: cfg.provider || 'qwen'
      })
      const llmOutput = chat.choices?.[0]?.message?.content ?? ''
      
      // 为每个 LLM 节点创建唯一且安全的变量名（将连字符等替换为下划线）
      const safeId = String(nodeId).replace(/[^a-zA-Z0-9_]/g, '_')
      const llmVarName = `llm_text_${safeId}`
      ctx.variables[llmVarName] = llmOutput
      
      // 保持向后兼容：最后一个 LLM 的输出仍然设置为 llm_text
      ctx.llmText = llmOutput
      ctx.variables.llm_text = llmOutput
      if (onOutput) onOutput(nodeId, llmOutput)
    }
    
    if (nodeType === 'reply') {
      const cfg = (node.data?.config || { mode: 'llm', template: '{{llm_text}}' }) as AnswerConfig
      if (cfg.mode === 'template') {
        ctx.variables.answer = renderTemplate(cfg.template, ctx.variables)
      } else {
        ctx.variables.answer = ctx.llmText || ''
      }
      if (onOutput) onOutput(nodeId, String(ctx.variables.answer || ''))
    }
    
    // 执行后续连接的节点
    const outgoingEdges = edges.filter(e => e.source === nodeId)
    for (const edge of outgoingEdges) {
      await executeNode(edge.target)
    }
    if (onStatus) onStatus(nodeId, 'done')
  }

  // 从开始节点开始执行
  await executeNode('start')
  return ctx
}

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const onConnect = useCallback((connection: Connection) => setEdges((eds) => addEdge(connection, eds)), [])
  const [question, setQuestion] = useState('什么是混合检索?')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [chatHistory, setChatHistory] = useState([])
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState(null)
  const [activeTab, setActiveTab] = useState('input')
  const [collapsed, setCollapsed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(true)
  const [configOpen, setConfigOpen] = useState(false)
  const [showNewNodeMenu, setShowNewNodeMenu] = useState(false)

  // 从 nodes 数组和 selectedNodeId 动态获取当前选中的节点
  const selected = useMemo(() => {
    if (!selectedNodeId) return null
    return nodes.find(n => n.id === selectedNodeId) || null
  }, [nodes, selectedNodeId])

  // 从 edges 数组和 selectedEdgeId 动态获取当前选中的连线
  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return null
    return edges.find(e => e.id === selectedEdgeId) || null
  }, [edges, selectedEdgeId])

  const handleRun = async () => {
    if (!question.trim()) return
    
    try {
      setLoading(true)
      // 清理上一次的进度边样式
      setEdges((eds) => eds.map(e => ({ ...e, animated: false, style: { ...(e.style || {}), strokeDasharray: '0' } })))
      const ctx = await runFlow(question, nodes, edges, (nodeId, status) => {
        // 标记节点状态
        setNodes((ns) => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, runtimeStatus: status } } : n))
        // 以“进度=虚线动画边”显示：高亮指向该节点的所有入边
        setEdges((eds) => eds.map(e => {
          if (e.target === nodeId) {
            if (status === 'running') {
              return { ...e, animated: true, style: { ...(e.style || {}), strokeDasharray: '6 4', stroke: '#8b5cf6', strokeWidth: 2 } }
            }
            if (status === 'done') {
              return { ...e, animated: false, style: { ...(e.style || {}), strokeDasharray: '0', stroke: '#8b5cf6', strokeWidth: 2 } }
            }
          }
          return e
        }))
      }, (nodeId, output) => {
        setNodes((ns) => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, lastOutput: output } } : n))
      })
      const result = (ctx as any).variables?.answer ?? ctx.llmText ?? ''
      
      // 添加到聊天记录
      const newChat = {
        id: Date.now().toString(),
        question: question.trim(),
        answer: result,
        timestamp: Date.now()
      }
      setChatHistory(prev => [...prev, newChat])
      
      // 清空输入框
      setQuestion('')
    } catch (e: any) {
      const errorMsg = `出错：${e.message}`
      const newChat = {
        id: Date.now().toString(),
        question: question.trim(),
        answer: errorMsg,
        timestamp: Date.now()
      }
      setChatHistory(prev => [...prev, newChat])
      setQuestion('')
    } finally {
      setLoading(false)
      setTimeout(() => {
        setNodes((ns) => ns.map(n => ({ ...n, data: { ...n.data, runtimeStatus: undefined } })))
        setEdges((eds) => eds.map(e => ({ ...e, animated: false, style: { ...(e.style || {}), strokeDasharray: '0' } })))
      }, 800)
    }
  }

  const createNewNode = (type: 'kb' | 'llm' | 'reply' | 'http' | 'cond') => {
    const id = `${type}-${Date.now()}`
    const baseX = 200 + (nodes.length * 150)
    const baseY = 100 + (Math.random() * 100)
    
    let newNode: Node
    switch (type) {
      case 'kb':
        newNode = {
          id,
          type: 'card',
          position: { x: baseX, y: baseY },
          data: {
            label: '知识检索',
            icon: '📚',
            theme: 'theme-green',
            handles: ['left', 'right'],
            config: { topK: 3 } as KbConfig
          }
        }
        break
      case 'llm':
        newNode = {
          id,
          type: 'card',
          position: { x: baseX, y: baseY },
          data: {
            label: 'LLM',
            icon: '🤖',
            theme: 'theme-purple',
            handles: ['left', 'right'],
            config: {
              model: 'qwen-plus',
              temperature: 0.7,
              systemPrompt: '你是一个有用的中文助手。回答时要基于提供的知识片段，若无依据要明确说明。',
              userPrompt: '用户问题：{{query}}\n\n知识片段：\n{{kb_text}}',
              apiKey: 'sk-a14dcee56184459d9d5eab7a65af3f3f',
              apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
              provider: 'qwen'
            } as LlmConfig
          }
        }
        break
      case 'reply':
        newNode = {
          id,
          type: 'card',
          position: { x: baseX, y: baseY },
          data: {
            label: '直接回复',
            icon: '🟠',
            theme: 'theme-orange',
            handles: ['left'],
            config: { mode: 'llm', template: '{{llm_text}}' } as AnswerConfig
          }
        }
        break
      case 'http':
        newNode = {
          id,
          type: 'card',
          position: { x: baseX, y: baseY },
          data: {
            label: 'HTTP请求',
            icon: '🌐',
            theme: 'theme-blue',
            handles: ['left', 'right'],
            config: {
              method: 'GET',
              url: 'https://api.example.com/data',
              headers: [{key: 'Content-Type', value: 'application/json'}],
              bodyType: 'none',
              bodyText: '',
              bodyJson: '{\n  "key": "value"\n}',
              variables: [{key: 'user_id', value: '123'}]
            } as HttpConfig
          }
        }
        break
      case 'cond':
        newNode = {
          id,
          type: 'card',
          position: { x: baseX, y: baseY },
          data: {
            label: '条件分支',
            icon: '🧩',
            theme: 'theme-cyan',
            handles: ['left', 'multiple'],
            config: { if: { variable: 'query', operator: 'contains', value: '技术' }, elifs: [], elseEnabled: true } as CondConfig
          }
        }
        break
    }
    
    setNodes(nds => [...nds, newNode])
    setSelectedNodeId(id)
    setShowNewNodeMenu(false)
  }

  function deleteSelectedNode() {
    if (!selected) return
    // 禁止删除起始示例节点，可按需放开
    if (selected.id === 'start') return
    setEdges((eds) => eds.filter(e => e.source !== selected.id && e.target !== selected.id))
    setNodes((nds) => nds.filter(n => n.id !== selected.id))
    setSelectedNodeId(null)
  }

  function deleteSelectedEdge() {
    if (!selectedEdge) return
    setEdges((eds) => eds.filter(e => e.id !== selectedEdge.id))
    setSelectedEdgeId(null)
  }

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // 检查是否在输入框、文本区域或其他可编辑元素中
      const target = e.target as HTMLElement
      const isEditable = target.tagName === 'INPUT' || 
                        target.tagName === 'TEXTAREA' || 
                        target.contentEditable === 'true' ||
                        target.closest('input, textarea, [contenteditable]')
      
      // 只有在非编辑状态下才允许删除节点或连线
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditable) {
        if (selectedEdge) {
          e.preventDefault()
          deleteSelectedEdge()
        } else if (selected) {
          e.preventDefault()
          deleteSelectedNode()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, selectedEdge])

  const chatInterface = useMemo(() => (
    <div className="chat-container">
      <div className="chat-header">
        <button onClick={async () => {
          // seed some sample docs
          await api('/api/knowledge/upsert', {
            documents: [
              { text: '混合检索通常指将稀疏检索与向量检索结合使用，以获得更好的召回与精度。' },
              { text: 'RAG（检索增强生成）通过在生成前检索相关知识，为回答提供事实依据。' }
            ]
          })
          alert('示例知识已导入')
        }}>导入示例知识</button>
        <button 
          onClick={() => {
            if (chatHistory.length > 0 && confirm('确定要清除所有聊天记录吗？')) {
              setChatHistory([])
            }
          }}
          disabled={chatHistory.length === 0}
          style={{ 
            marginLeft: '8px',
            backgroundColor: chatHistory.length === 0 ? '#f3f4f6' : '#ef4444',
            color: chatHistory.length === 0 ? '#9ca3af' : 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '6px',
            cursor: chatHistory.length === 0 ? 'not-allowed' : 'pointer'
          }}
        >
          清除记录
        </button>
      </div>
      
      <div className="chat-messages">
        {chatHistory.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">💬</div>
            <div className="chat-empty-text">开始对话吧！</div>
          </div>
        ) : (
          chatHistory.map((chat) => (
            <div key={chat.id} className="chat-item">
              <div className="chat-question">
                <div className="chat-avatar">👤</div>
                <div className="chat-content">
                  <div className="chat-text">{chat.question}</div>
                  <div className="chat-time">{new Date(chat.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>
              <div className="chat-answer">
                <div className="chat-avatar">🤖</div>
                <div className="chat-content">
                  <div className="chat-text">{chat.answer}</div>
                  <div className="chat-time">{new Date(chat.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="chat-loading">
            <div className="chat-avatar">🤖</div>
            <div className="chat-content">
              <div className="chat-text">正在思考中...</div>
            </div>
          </div>
        )}
      </div>
      
      <div className="chat-input">
        <input 
          value={question} 
          onChange={(e) => setQuestion(e.target.value)} 
          placeholder="输入你的问题..." 
          onKeyPress={(e) => e.key === 'Enter' && handleRun()}
          disabled={loading}
        />
        <button onClick={handleRun} disabled={loading || !question.trim()}>
          {loading ? '发送中...' : '发送'}
        </button>
      </div>
    </div>
  ), [question, loading, chatHistory])

  const rightPanel = useMemo(() => {
    // 如果选中了连线，显示连线信息
    if (selectedEdge) {
      const sourceNode = nodes.find(n => n.id === selectedEdge.source)
      const targetNode = nodes.find(n => n.id === selectedEdge.target)
      return (
        <div className="panel">
          <div className="panel-title">连线信息</div>
          <div style={{ 
            backgroundColor: '#f3f4f6', 
            padding: '8px', 
            borderRadius: '4px', 
            marginBottom: '16px',
            fontSize: '12px',
            color: '#6b7280'
          }}>
            <strong>连线 ID:</strong> {selectedEdge.id}<br/>
            <strong>源节点:</strong> {sourceNode?.data?.label || selectedEdge.source}<br/>
            <strong>目标节点:</strong> {targetNode?.data?.label || selectedEdge.target}<br/>
            {selectedEdge.sourceHandle && <><strong>源句柄:</strong> {selectedEdge.sourceHandle}<br/></>}
          </div>
          <div style={{ fontSize: '14px', color: '#6b7280' }}>
            点击"删除连线"按钮或按 Delete/Backspace 键删除此连线
          </div>
        </div>
      )
    }
    
    if (!selected) return null
    const id = selected.id
    const nodeType = id.split('-')[0] // 获取节点类型前缀
    if (nodeType === 'cond') {
      const cfg: CondConfig = selected.data?.config || { if: { variable: 'query', operator: 'contains', value: '' }, elifs: [], elseEnabled: true }
      return (
        <div className="panel">
          <div className="panel-title">条件分支配置</div>
          <div style={{ 
            backgroundColor: '#f3f4f6', 
            padding: '8px', 
            borderRadius: '4px', 
            marginBottom: '16px',
            fontSize: '12px',
            color: '#6b7280'
          }}>
            <strong>节点 ID:</strong> {selected.id}
          </div>
          <label>IF 变量路径：
            <input value={cfg.if.variable}
              onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, if: { ...cfg.if, variable: e.target.value } } } } : n))} />
          </label>
          <label>IF 条件：
            <select value={cfg.if.operator}
              onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, if: { ...cfg.if, operator: e.target.value as any } } } } : n))}>
              <option value="contains">包含</option>
              <option value="not_contains">不包含</option>
              <option value="start_with">开始是</option>
              <option value="end_with">结束是</option>
              <option value="is">是</option>
              <option value="is_not">不是</option>
              <option value="is_empty">为空</option>
              <option value="is_not_empty">不为空</option>
            </select>
          </label>
          {!(cfg.if.operator === 'is_empty' || cfg.if.operator === 'is_not_empty') && (
            <label>IF 值：
              <input value={cfg.if.value || ''}
                onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, if: { ...cfg.if, value: e.target.value } } } } : n))} />
            </label>
          )}
          <div className="panel-subtitle">ELIF 条件（可选）</div>
          <button onClick={() => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, elifs: [...cfg.elifs, { variable: 'query', operator: 'contains', value: '' }] } } } : n))}>+ 添加 ELIF</button>
          {cfg.elifs.map((c, idx) => (
            <div key={idx} style={{padding:'40px 8px 8px 8px', border:'1px solid #eee', borderRadius:8, marginTop:8, position:'relative'}}>
              <button
                onClick={() => setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                  ...n, 
                  data: { 
                    ...n.data, 
                    config: { 
                      ...cfg, 
                      elifs: cfg.elifs.filter((_, i) => i !== idx) 
                    } 
                  } 
                } : n))}
                style={{position:'absolute', right:8, top:8, border:'1px solid #fecaca', background:'#fff5f5', color:'#b91c1c', borderRadius:6, padding:'4px 8px', cursor:'pointer', zIndex:1}}
              >删除</button>
              <label>变量：
                <input value={c.variable}
                  onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, elifs: cfg.elifs.map((it,i)=> i===idx?{...it, variable:e.target.value}:it) } } } : n))} />
              </label>
              <label>条件：
                <select value={c.operator}
                  onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, elifs: cfg.elifs.map((it,i)=> i===idx?{...it, operator:e.target.value as any}:it) } } } : n))}>
                  <option value="contains">包含</option>
                  <option value="not_contains">不包含</option>
                  <option value="start_with">开始是</option>
                  <option value="end_with">结束是</option>
                  <option value="is">是</option>
                  <option value="is_not">不是</option>
                  <option value="is_empty">为空</option>
                  <option value="is_not_empty">不为空</option>
                </select>
              </label>
              {!(c.operator === 'is_empty' || c.operator === 'is_not_empty') && (
                <label>值：
                  <input value={c.value || ''}
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, elifs: cfg.elifs.map((it,i)=> i===idx?{...it, value:e.target.value}:it) } } } : n))} />
                </label>
              )}
            </div>
          ))}
          <label style={{marginTop:8}}>启用 ELSE：
            <input type="checkbox" checked={cfg.elseEnabled} onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, elseEnabled: e.target.checked } } } : n))} />
          </label>
          <div style={{marginTop:8, fontSize:12, color:'#64748b'}}>当前分支：未执行</div>
        </div>
      )
    }
    if (nodeType === 'kb') {
      const cfg: KbConfig = selected.data?.config || { topK: 3 }
      return (
        <div className="panel">
          <div className="panel-title">知识检索配置</div>
          {selected.data?.lastOutput && (
            <label>上次输出：
              <textarea readOnly value={selected.data.lastOutput} />
            </label>
          )}
          <div style={{ 
            backgroundColor: '#f3f4f6', 
            padding: '8px', 
            borderRadius: '4px', 
            marginBottom: '16px',
            fontSize: '12px',
            color: '#6b7280'
          }}>
            <strong>节点 ID:</strong> {selected.id}
          </div>
          <label>TopK：
            <input type="number" value={cfg.topK}
              onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, topK: Number(e.target.value) } } } : n))} />
          </label>
          <label>上传文本（自动分块并向量化）：
            <textarea placeholder="在此粘贴文本..." onBlur={async (e) => {
              const content = e.target.value.trim()
              if (!content) return
              await fetch('/api/vector/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: content }) })
              alert('文本已导入知识库')
              e.target.value = ''
            }} />
          </label>
          <label>上传文件（.txt）：
            <div className="file-upload">
              <input id="kb-file" className="file-input" type="file" accept=".txt" onChange={async (e) => {
                if (!e.target.files || !e.target.files[0]) return
                const file = e.target.files[0]
                const form = new FormData()
                form.append('file', file)
                await fetch('/api/vector/upload', { method: 'POST', body: form })
                const nameEl = document.getElementById('kb-file-name')
                if (nameEl) nameEl.textContent = file.name + ' 已导入'
                alert('文件已导入知识库')
                e.target.value = ''
              }} />
              <label htmlFor="kb-file" className="file-btn">选择文件</label>
              <span id="kb-file-name" className="file-name">未选择文件</span>
            </div>
          </label>
        </div>
      )
    }
    if (nodeType === 'llm') {
      const cfg: LlmConfig = selected.data?.config || { model: 'qwen-plus', temperature: 0.7, systemPrompt: '', userPrompt: '{{query}}', apiKey: '', apiUrl: '', provider: 'qwen' }
      return (
        <div className="panel">
          <div className="panel-title">LLM 配置</div>
          {selected.data?.lastOutput && (
            <label>上次输出：
              <textarea readOnly value={selected.data.lastOutput} />
            </label>
          )}
          <div style={{ 
            backgroundColor: '#f3f4f6', 
            padding: '8px', 
            borderRadius: '4px', 
            marginBottom: '16px',
            fontSize: '12px',
            color: '#6b7280'
          }}>
            <strong>节点 ID:</strong> {selected.id}<br/>
            <strong>LLM 输出变量:</strong> <code style={{backgroundColor: '#e5e7eb', padding: '2px 4px', borderRadius: '2px'}}>{`{{llm_text_${String(selected.id).replace(/[^a-zA-Z0-9_]/g, '_')}}}`}</code>
          </div>
          <label>API 类型：
            <select value={cfg.provider || 'qwen'} onChange={(e) => {
              const provider = e.target.value as 'qwen' | 'openai' | 'local'
              let suggestedUrl = ''
              if (provider === 'qwen') {
                suggestedUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
              } else if (provider === 'openai') {
                suggestedUrl = 'https://api.openai.com/v1'
              } else if (provider === 'local') {
                suggestedUrl = 'http://192.168.137.4:8000/v1/chat/completions'
              }
              setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, provider, apiUrl: suggestedUrl } } } : n))
            }}>
              <option value="qwen">Qwen (OpenAI兼容)</option>
              <option value="openai">OpenAI</option>
              <option value="local">本地模型</option>
            </select>
          </label>
          <label>API URL：
            <input value={cfg.apiUrl || ''}
              onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, apiUrl: e.target.value } } } : n))} />
          </label>
          <label>API Key：
            <input 
              type="password" 
              value={cfg.apiKey || ''}
              placeholder={cfg.provider === 'local' ? '本地模型不需要API Key' : '请输入API Key'}
              disabled={cfg.provider === 'local'}
              onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, apiKey: e.target.value } } } : n))} 
            />
          </label>
          <label>模型：
            <input 
              value={cfg.model}
              placeholder={cfg.provider === 'local' ? 'local-model' : '请输入模型名称'}
              onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, model: e.target.value } } } : n))} 
            />
          </label>
          <label>温度：
            <input type="number" step="0.1" value={cfg.temperature}
              onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, temperature: Number(e.target.value) } } } : n))} />
          </label>
          <label>System Prompt：</label>
          <textarea value={cfg.systemPrompt}
            onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, systemPrompt: e.target.value } } } : n))} />
          <label>User Prompt（可用变量：{'{{query}}'}、{'{{kb_text}}'}、{'{{http_text}}'}、{'{{llm_text_其他节点ID}}'}）：</label>
          <textarea value={cfg.userPrompt}
            onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, userPrompt: e.target.value } } } : n))} />
        </div>
      )
    }
    if (nodeType === 'reply') {
      const cfg: AnswerConfig = selected.data?.config || { mode: 'llm', template: '{{llm_text}}' }
      return (
        <div className="panel">
          <div className="panel-title">直接回复配置</div>
          {selected.data?.lastOutput && (
            <label>上次输出：
              <textarea readOnly value={selected.data.lastOutput} />
            </label>
          )}
          <div style={{ 
            backgroundColor: '#f3f4f6', 
            padding: '8px', 
            borderRadius: '4px', 
            marginBottom: '16px',
            fontSize: '12px',
            color: '#6b7280'
          }}>
            <strong>节点 ID:</strong> {selected.id}
          </div>
          <label>模式：
            <select value={cfg.mode} onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, mode: e.target.value as any } } } : n))}>
              <option value="llm">使用 LLM 输出</option>
              <option value="template">模板渲染</option>
            </select>
          </label>
          <label>模板（可用变量：{'{{llm_text}}'}、{'{{llm_text_节点ID}}'}、{'{{kb_text}}'}、{'{{query}}'}、{'{{http_text}}'}）：</label>
          <textarea value={cfg.template}
            onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, template: e.target.value } } } : n))} />
        </div>
      )
    }
    if (nodeType === 'http') {
      const cfg: HttpConfig = selected.data?.config || { method: 'GET', url: '', headers: [], bodyType: 'none', bodyText: '', bodyJson: '{}', variables: [] }
      return (
        <div className="panel">
          <div className="panel-title">HTTP请求配置</div>
          {selected.data?.lastOutput && (
            <label>上次输出：
              <textarea readOnly value={selected.data.lastOutput} />
            </label>
          )}
          <div style={{ 
            backgroundColor: '#f3f4f6', 
            padding: '8px', 
            borderRadius: '4px', 
            marginBottom: '16px',
            fontSize: '12px',
            color: '#6b7280'
          }}>
            <strong>节点 ID:</strong> {selected.id}
          </div>
          <label>方法：
            <select value={cfg.method} onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, method: e.target.value } } } : n))}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
          </label>
          <label>URL：
            <input value={cfg.url} onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, url: e.target.value } } } : n))} />
          </label>
          <label>请求体类型：
            <select value={cfg.bodyType} onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, bodyType: e.target.value as any } } } : n))}>
              <option value="none">无</option>
              <option value="text">文本</option>
              <option value="json">JSON</option>
            </select>
          </label>
          {cfg.bodyType === 'text' && (
            <label>请求体文本：
              <textarea value={cfg.bodyText} onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, bodyText: e.target.value } } } : n))} />
            </label>
          )}
          {cfg.bodyType === 'json' && (
            <label>请求体JSON：
              <textarea value={cfg.bodyJson} onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, bodyJson: e.target.value } } } : n))} />
            </label>
          )}
          <label>变量（用于URL和Body中的{'{变量名}'}替换）：
            <textarea value={JSON.stringify(cfg.variables, null, 2)} onChange={(e) => {
              try {
                const vars = JSON.parse(e.target.value)
                setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, variables: vars } } } : n))
              } catch {}
            }} />
          </label>
        </div>
      )
    }
    return null
  }, [selected, setNodes])

  return (
    <div className="app">
      <div className="left">
        <div className="canvas-header">
          <div className="new-node-container">
            <button 
              className="new-node-btn" 
              onClick={() => setShowNewNodeMenu(!showNewNodeMenu)}
            >
              + 新建插件
            </button>
            {showNewNodeMenu && (
              <div className="new-node-menu">
                <button onClick={() => createNewNode('kb')}>📚 知识检索</button>
                <button onClick={() => createNewNode('cond')}>🧩 条件分支</button>
                <button onClick={() => createNewNode('llm')}>🤖 LLM</button>
                <button onClick={() => createNewNode('http')}>🌐 HTTP请求</button>
                <button onClick={() => createNewNode('reply')}>🟠 直接回复</button>
              </div>
            )}
            <button 
              className="delete-node-btn" 
              onClick={() => {
                if (selectedEdge) {
                  deleteSelectedEdge()
                } else if (selected) {
                  deleteSelectedNode()
                }
              }} 
              disabled={!selected && !selectedEdge || (selected && selected.id === 'start')}
            >
              {selectedEdge ? '删除连线' : '删除节点'}
            </button>
          </div>
        </div>
        <div className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => {
            setSelectedNodeId(n.id)
            setSelectedEdgeId(null)
            // 打开配置面板
            setActiveTab('config')
            setConfigOpen(true)
            setPreviewOpen(false)
          }}
          onEdgeClick={(_, e) => {
            setSelectedEdgeId(e.id)
            setSelectedNodeId(null)
          }}
          onPaneClick={() => {
            setSelectedNodeId(null)
            setSelectedEdgeId(null)
          }}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{ 
            type: 'smoothstep', 
            animated: false, 
            style: { 
              stroke: '#8b5cf6', 
              strokeWidth: 2 
            }
          }}
          fitView
        >
          <Background gap={18} size={1} color="#e5e7eb" />
          <MiniMap />
          <Controls />
        </ReactFlow>
        </div>
      </div>
      <div className={`right ${collapsed ? 'right-collapsed' : ''}`}>
        <div className="right-header">
          <div className="tabs fixed-tabs">
            <button
              className={previewOpen ? 'tab active' : 'tab'}
              onClick={() => {
                setActiveTab('input')
                setPreviewOpen(v => !v)
                if (configOpen) setConfigOpen(false)
              }}
            >预览</button>
            <button
              className={configOpen ? 'tab active' : 'tab'}
              onClick={() => {
                setActiveTab('config')
                setConfigOpen(v => !v)
                if (previewOpen) setPreviewOpen(false)
              }}
            >配置</button>
          </div>
        </div>
        <div style={{padding: '12px'}}>
          {previewOpen && chatInterface}
          {configOpen && rightPanel}
        </div>
      </div>
    </div>
  )
}


