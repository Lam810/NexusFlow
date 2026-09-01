import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Connection,
  Edge,
  Node,
  useEdgesState,
  useNodesState,
  Handle,
  Position,
  Controls
} from 'reactflow';
import 'reactflow/dist/style.css';
import './styles.css';

const ChartWidget = React.lazy(() => import('./ChartWidget'));

function LazyChartWidget(props: { headers: string[]; rows: Array<Record<string, string>> }) {
  return (
    <React.Suspense fallback={<div className="chart-widget">图表加载中…</div>}>
      <ChartWidget {...props} />
    </React.Suspense>
  )
}

// 类型定义
type KnowledgeMatch = { id: string; text: string; score?: number; similarity?: number }

type RunContext = {
  query: string
  variables: Record<string, any>
  knowledgeMatches?: KnowledgeMatch[]
  llmText?: string
}

type KbConfig = { topK: number; source?: 'static' | 'dynamic' }
type LlmConfig = {
  model: string
  temperature: number
  systemPrompt: string
  userPrompt: string
  apiKey: string
  apiUrl: string
  provider?: 'qwen' | 'openai' | 'local' | 'openrouter'
}
type AnswerConfig = { mode: 'llm' | 'template'; template: string }
type AnswerConfigEx = AnswerConfig & { stream?: boolean }
type HttpConfig = {
  method: string
  url: string
  headers: Array<{key: string, value: string}>
  bodyType: 'none' | 'text' | 'json'
  bodyText: string
  bodyJson: string
  variables: Array<{key: string, value: string}>
  // 认证配置
  auth: {
    type: 'none' | 'bearer' | 'apikey' | 'basic' | 'oauth2' | 'custom'
    // Bearer Token
    bearerToken?: string
    // API Key
    apiKey?: {
      key: string
      value: string
      location: 'header' | 'query' | 'body'
    }
    // Basic Auth
    basicAuth?: {
      username: string
      password: string
    }
    // OAuth2
    oauth2?: {
      accessToken?: string
      clientId?: string
      clientSecret?: string
      tokenUrl?: string
      scope?: string
      grantType?: 'client_credentials' | 'authorization_code' | 'password'
    }
    // 自定义认证
    customAuth?: {
      headers: Array<{key: string, value: string}>
      queryParams: Array<{key: string, value: string}>
      bodyParams: Array<{key: string, value: string}>
    }
  }
  // 高级配置
  advanced: {
    timeout: number
    retries: number
    followRedirects: boolean
    validateSSL: boolean
    customUserAgent?: string
  }
}
type AnalysisConfig = {
  apiUrl: string
  apiKey?: string
  questionTemplate: string
  provider?: 'qwen' | 'openai' | 'local' | 'openrouter'
  model?: string
  temperature?: number
  uploadedData?: any[][]
  uploadedHeaders?: string[]
  uploadedFilename?: string
}
type StartConfig = {
  mode: 'chat' | 'background'  // 聊天模式或后台模式
}
type LoopConfig = {
  enabled: boolean
  interval: number  // 间隔时间（秒）
  maxIterations?: number  // 最大迭代次数，0表示无限
}
type QueryTriggerConfig = {
  enabled: boolean  // 是否启用
  placeholder?: string  // 占位符文本
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
  // 语义匹配配置
  semanticMatch?: {
    enabled: boolean
    provider: string
    model: string
    temperature: number
    apiKey: string
    apiUrl: string
    conditions: Array<{
      description: string
      value: string
    }>
  }
}

// 节点组件
function CardNode({ data, id }: any) {
  const showLeft = data?.handles?.includes('left')
  const showRight = data?.handles?.includes('right')
  const showMultiple = data?.handles?.includes('multiple')
  
  // 动态条件出口（用于条件分支节点）
  const conditionHandles = data?.conditionHandles || []
  
  // 动态计算节点高度
  const getNodeHeight = () => {
    if (conditionHandles.length === 0) return 'auto'
    // 基础高度 + 每个出口的高度 + 间距
    const baseHeight = 60 // 基础高度
    const handleHeight = 24 // 每个出口占用的高度
    const spacing = 8 // 出口间距
    const totalHeight = baseHeight + (conditionHandles.length * handleHeight) + ((conditionHandles.length - 1) * spacing)
    const finalHeight = Math.max(totalHeight, 80) // 最小高度80px
    return `${finalHeight}px`
  }
  
  return (
    <div 
      className={`node-card ${data?.theme || ''} ${data?.runtimeStatus ? `status-${data.runtimeStatus}` : ''} ${conditionHandles.length > 0 ? 'condition-branch' : ''}`} 
      id={`node-${id}`}
      style={{
        minHeight: getNodeHeight(),
        position: 'relative'
      }}
    >
      <div className="node-icon">{data?.icon || '⬢'}</div>
      <div className="node-content">
        <div className="node-title">{data?.label}</div>
        {data?.subtitle ? <div className="node-subtitle">{data.subtitle}</div> : null}
      </div>
      {showLeft && <Handle type="target" position={Position.Left} style={{ background: '#10b981', width: '12px', height: '12px', border: '2px solid #fff' }} />}
      {showRight && <Handle type="source" position={Position.Right} style={{ background: '#8b5cf6', width: '12px', height: '12px', border: '2px solid #fff' }} />}
      {/* 强制显示连接点用于调试 */}
      {id === 'start' && <Handle type="source" position={Position.Right} style={{ background: '#8b5cf6', width: '12px', height: '12px', border: '2px solid #fff' }} />}
      {/* 旧的multiple handles - 仅在conditionHandles为空时显示 */}
      {showMultiple && conditionHandles.length === 0 && (
        <>
          <Handle type="source" position={Position.Right} id="if" style={{ top: '30%', background: '#10b981' }} />
          <Handle type="source" position={Position.Right} id="else" style={{ top: '70%', background: '#ef4444' }} />
        </>
      )}
      {/* 动态条件分支出口 - 平均距离布局 */}
      {conditionHandles.length > 0 && conditionHandles.map((handle: any, index: number) => {
        const totalHandles = conditionHandles.length
        
        // 平均距离布局：将节点高度平均分配给所有出口
        const nodeHeight = parseInt(getNodeHeight()) // 获取节点实际高度
        const topMargin = 30 // 顶部留白
        const bottomMargin = 30 // 底部留白
        const availableHeight = nodeHeight - topMargin - bottomMargin
        const handleSpacing = totalHandles > 1 ? availableHeight / (totalHandles - 1) : 0
        const topPercent = totalHandles === 1 ? 50 : (topMargin + (index * handleSpacing)) / nodeHeight * 100
        
        const colors = ['#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444']
        const color = colors[index % colors.length]
        
        return (
          <div key={handle.id} style={{ 
            position: 'absolute', 
            right: '-6px', 
            top: `${topPercent}%`, 
            transform: 'translateY(-50%)',
            zIndex: 10
          }}>
            <Handle 
              type="source" 
              position={Position.Right} 
              id={handle.id} 
              style={{ 
                position: 'relative',
                background: color, 
                width: '12px', 
                height: '12px', 
                border: '2px solid #fff',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                cursor: 'pointer'
              }} 
            />
            <div style={{
              position: 'absolute',
              right: '16px',
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '10px',
              whiteSpace: 'nowrap',
              background: 'rgba(255,255,255,0.95)',
              padding: '2px 4px',
              borderRadius: '3px',
              border: `1px solid ${color}`,
              color: '#333',
              fontWeight: 500,
              pointerEvents: 'none',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              {handle.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// 根据条件配置生成conditionHandles
function generateConditionHandles(config: CondConfig): Array<{ id: string; label: string }> {
  const handles: Array<{ id: string; label: string }> = []
  
  // 语义匹配模式
  if (config.semanticMatch?.enabled && config.semanticMatch.conditions?.length > 0) {
    config.semanticMatch.conditions.forEach((cond, index) => {
      handles.push({
        id: `cond_${index}`,
        label: cond.description || cond.value || `条件${index + 1}`
      })
    })
  } else {
    // 传统关键词匹配模式
    // IF 条件
    const ifLabel = config.if.operator === 'is_empty' || config.if.operator === 'is_not_empty' 
      ? `${config.if.variable || 'query'} ${config.if.operator}`
      : `${config.if.variable || 'query'} ${config.if.operator} "${config.if.value || ''}"`
    handles.push({
      id: 'cond_0',
      label: `IF: ${ifLabel.length > 20 ? ifLabel.substring(0, 20) + '...' : ifLabel}`
    })
    
    // ELIF 条件
    config.elifs?.forEach((elif, index) => {
      const elifLabel = elif.operator === 'is_empty' || elif.operator === 'is_not_empty'
        ? `${elif.variable || 'query'} ${elif.operator}`
        : `${elif.variable || 'query'} ${elif.operator} "${elif.value || ''}"`
      handles.push({
        id: `cond_${index + 1}`,
        label: `ELIF${index + 1}: ${elifLabel.length > 20 ? elifLabel.substring(0, 20) + '...' : elifLabel}`
      })
    })
  }
  
  // ELSE 条件（如果启用）
  if (config.elseEnabled) {
    handles.push({
      id: 'cond_else',
      label: 'ELSE'
    })
  }
  
  return handles
}

// 将nodeTypes移到组件外部，避免重新创建
const nodeTypes = { card: CardNode }

// 初始节点和边
const initialNodes: Node[] = [
  { id: 'start', type: 'card', position: { x: 50, y: 80 }, data: { label: '开始', icon: '🔵', theme: 'theme-blue', handles: ['right'], config: { } } },
  { 
    id: 'cond', 
    type: 'card', 
    position: { x: 180, y: 60 }, 
    data: { 
      label: '条件分支', 
      icon: '🧩', 
      theme: 'theme-cyan', 
      handles: ['left'],
      conditionHandles: generateConditionHandles({ if: { variable: 'query', operator: 'contains', value: '技术' }, elifs: [], elseEnabled: true }),
      config: { if: { variable: 'query', operator: 'contains', value: '技术' }, elifs: [], elseEnabled: true } as CondConfig 
    } 
  },
  { id: 'kb', type: 'card', position: { x: 300, y: 30 }, data: { label: '知识检索', icon: '📚', theme: 'theme-green', handles: ['left','right'], config: { topK: 3 } as KbConfig } },
  { id: 'llm', type: 'card', position: { x: 550, y: 30 }, data: { label: 'LLM', icon: '🤖', theme: 'theme-purple', handles: ['left','right'], config: { model: 'qwen-plus', temperature: 0.7, systemPrompt: '你是一个有用的中文助手。回答时要基于提供的知识片段，若无依据要明确说明。', userPrompt: '用户问题：{{query}}\n\n知识片段：\n{{kb_text}}', apiKey: '', apiUrl: '', provider: 'qwen' } as LlmConfig } },
  { id: 'reply', type: 'card', position: { x: 800, y: 30 }, data: { label: '直接回复', icon: '🟠', theme: 'theme-orange', handles: ['left'], config: { mode: 'template', template: '{{llm_text}}' } as AnswerConfig } },
  { id: 'reply-else', type: 'card', position: { x: 300, y: 120 }, data: { label: '直接回复', icon: '🟠', theme: 'theme-orange', handles: ['left'], config: { mode: 'template', template: '这是 ELSE 分支：{{query}}' } as AnswerConfig } },
]

const initialEdges: Edge[] = [
  { id: 'e1', source: 'start', target: 'cond' },
  { id: 'e1b', source: 'cond', sourceHandle: 'cond_0', target: 'kb' },
  { id: 'e2', source: 'kb', target: 'llm' },
  { id: 'e3', source: 'llm', target: 'reply' },
  { id: 'e4', source: 'cond', sourceHandle: 'cond_else', target: 'reply-else' },
]

// API 函数
async function api(path: string, body: any, authToken: string) {
  const serializedBody = body ? JSON.stringify(body) : undefined
  const r = await fetch(path, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: serializedBody,
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// SSE stream helper
async function sseStream(path: string, body: any, authToken: string, onChunk: (text: string) => void): Promise<void> {
  const r = await fetch(path, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!r.ok || !r.body) throw new Error(await r.text())
  const reader = (r.body as any).getReader?.()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      const line = part.split('\n').find(l => l.startsWith('data: '))
      if (!line) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload)
        const delta = j.choices?.[0]?.delta?.content || j.text || ''
        if (delta) onChunk(delta)
      } catch {}
    }
  }
}

function resolveTemplateValue(path: string, variables: Record<string, any>) {
  const normalizedPath = path.trim()
  if (Object.prototype.hasOwnProperty.call(variables, normalizedPath)) {
    return { found: true, value: variables[normalizedPath] }
  }

  let value: any = variables
  for (const key of normalizedPath.split('.')) {
    if (value === null || value === undefined || !Object.prototype.hasOwnProperty.call(Object(value), key)) {
      return { found: false, value: undefined }
    }
    value = value[key]
  }
  return { found: true, value }
}
type DeviceConfig = {
  action: 'system.info' | 'file.read' | 'file.write' | 'app.invoke'
  path: string
  content: string
  adapterId: string
  adapterAction: string
  adapterInput: string
}

// 普通模板用于提示词、URL和鉴权值，不注入JSON转义符。
function renderTemplate(template: string, variables: Record<string, any>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const resolved = resolveTemplateValue(path, variables)
    return resolved.found ? String(resolved.value ?? '') : match
  })
}

// JSON文本中的字符串占位符需要单独转义，避免引号或换行破坏JSON。
function renderJsonTemplate(template: string, variables: Record<string, any>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const resolved = resolveTemplateValue(path, variables)
    if (!resolved.found) return match
    return JSON.stringify(String(resolved.value ?? '')).slice(1, -1)
  })
}

// Markdown 渲染
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderMarkdownToHtml(md: string): string {
  return escapeHtml(md)
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^---$/gim, '<hr>')
    .replace(/^[\s]*[-*+] (.*$)/gim, '<li>$1</li>')
    .replace(/^[\s]*\d+\. (.*$)/gim, '<li>$1</li>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

// 解析 Markdown 表格
function parseMarkdownTable(md: string): { headers: string[]; rows: Array<Record<string, string>> } | null {
  const tableBlockMatch = md.match(/\|[^\n]+\|[\s\S]*?(?:\n\s*$|$)/)
  if (!tableBlockMatch) return null
  const lines = tableBlockMatch[0]
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('|') && l.endsWith('|'))

  if (lines.length < 2) return null
  const headerCells = lines[0]
    .slice(1, -1)
    .split('|')
    .map(s => s.trim())
  // 第二行通常是 --- 分割线，跳过
  const dataLines = lines.slice(1).filter(l => !/^\|\s*-+/.test(l))
  const rows: Array<Record<string, string>> = []
  for (const l of dataLines) {
    const cells = l.slice(1, -1).split('|').map(s => s.trim())
    if (cells.length !== headerCells.length) continue
    const row: Record<string, string> = {}
    headerCells.forEach((h, idx) => (row[h] = cells[idx]))
    rows.push(row)
  }
  if (headerCells.length === 0 || rows.length === 0) return null
  return { headers: headerCells, rows }
}

// 解析完整的分析结果
function parseAnalysisResult(md: string): { analysisText: string; table: { headers: string[]; rows: Array<Record<string, string>> } | null } {
  const tableBlockMatch = md.match(/\|[^\n]+\|[\s\S]*?(?:\n\s*$|$)/)
  let table: { headers: string[]; rows: Array<Record<string, string>> } | null = null
  if (tableBlockMatch) {
    const lines = tableBlockMatch[0]
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('|') && l.endsWith('|'))

    if (lines.length >= 2) {
      const headerCells = lines[0]
        .slice(1, -1)
        .split('|')
        .map(s => s.trim())
      const dataLines = lines.slice(1).filter(l => !/^\|\s*-+/.test(l))
      const rows: Array<Record<string, string>> = []
      for (const l of dataLines) {
        const cells = l.slice(1, -1).split('|').map(s => s.trim())
        if (cells.length !== headerCells.length) continue
        const row: Record<string, string> = {}
        headerCells.forEach((h, idx) => (row[h] = cells[idx]))
        rows.push(row)
      }
      if (headerCells.length > 0 && rows.length > 0) {
        table = { headers: headerCells, rows }
      }
    }
  }
  
  const analysisText = tableBlockMatch ? md.replace(tableBlockMatch[0], '').trim() : md
  
  return { analysisText, table }
}

// 分析结果组件
function AnalysisResult({ content }: { content: string }) {
  const { analysisText, table } = parseAnalysisResult(content)
  
  return (
    <div className="analysis-result">
      {analysisText && (
        <div className="analysis-text" style={{ 
          marginBottom: table ? '20px' : '0',
          padding: '16px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '1px solid #e9ecef'
        }}>
          <div 
            style={{ 
              lineHeight: '1.6',
              fontSize: '14px',
              color: '#333'
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(analysisText) }}
          />
        </div>
      )}
      {table && <LazyChartWidget headers={table.headers} rows={table.rows} />}
    </div>
  )
}

// 工作流执行函数
async function runFlow(
  query: string,
  nodes: Node[],
  edges: Edge[],
  serverConfig: any,
  workflowId: string,
  authToken: string,
  onStatus?: (nodeId: string, status: 'running' | 'done') => void,
  onOutput?: (nodeId: string, output: string) => void,
  options?: { isBackgroundMode?: boolean, loopConfig?: LoopConfig, shouldStop?: () => boolean }
): Promise<RunContext> {
  const ctx: RunContext = { 
    query, 
    variables: { 
      query,
      kb_text: '',
      http_text: '',
      _iteration: 0  // 当前迭代次数
    } 
  }

  // 检查是否为后台模式
  const isBackgroundMode = options?.isBackgroundMode || false

  // 如果是后台模式，不输出到聊天框
  const safeOnOutput = isBackgroundMode ? undefined : onOutput

  // 条件分支执行函数 - 返回匹配的条件handle ID
  async function executeConditionalNode(nodeId: string): Promise<string | null> {
    const cnode = nodes.find((n) => n.id === nodeId)
    if (!cnode) return null
    
    const cfg = (cnode.data?.config || { if: { variable: 'query', operator: 'contains', value: '' }, elifs: [], elseEnabled: true }) as CondConfig
    
    function getVal(path: string): any {
      const parts = String(path || '').split('.')
      let val = ctx.variables
      for (const part of parts) {
        val = val?.[part]
        if (val === undefined) return ''
      }
      return val
    }
    
    function evalCond(cond: CondClause): boolean {
      const val = getVal(cond.variable)
      const target = cond.value || ''
      
      switch (cond.operator) {
        case 'contains': return String(val).includes(target)
        case 'not_contains': return !String(val).includes(target)
        case 'start_with': return String(val).startsWith(target)
        case 'end_with': return String(val).endsWith(target)
        case 'is': return String(val) === target
        case 'is_not': return String(val) !== target
        case 'is_empty': return !val || String(val).trim() === ''
        case 'is_not_empty': return val && String(val).trim() !== ''
        default: return false
      }
    }
    
    // 如果启用了语义匹配
    if (cfg.semanticMatch?.enabled && cfg.semanticMatch.conditions?.length > 0) {
      try {
        const query = getVal('query') || ctx.query
        const conditions = cfg.semanticMatch.conditions.map(cond => ({
          description: cond.description,
          value: cond.value
        }))
        
        const response = await api('/api/semantic-match', {
          query,
          conditions,
          provider: cfg.semanticMatch.provider,
          model: cfg.semanticMatch.model,
          temperature: cfg.semanticMatch.temperature,
          apiKey: cfg.semanticMatch.apiKey,
          apiUrl: cfg.semanticMatch.apiUrl
        }, authToken)
        
        if (response.success && response.matchedIndex > 0) {
          // 返回具体匹配的条件索引
          const matchedIndex = response.matchedIndex - 1
          return `cond_${matchedIndex}`
        }
        
        // 语义匹配失败或无匹配，回退到传统匹配
        console.warn('语义匹配失败，回退到传统匹配:', response.error)
      } catch (error) {
        console.error('语义匹配错误:', error)
        // 出错时回退到传统匹配
      }
    }
    
    // 传统关键词匹配
    if (evalCond(cfg.if)) return 'cond_0' // IF条件对应cond_0
    
    // 检查所有ELIF条件
    for (let i = 0; i < (cfg.elifs?.length || 0); i++) {
      if (evalCond(cfg.elifs[i])) {
        return `cond_${i + 1}` // ELIF条件对应cond_1, cond_2, ...
      }
    }
    
    // ELSE条件
    return cfg.elseEnabled ? 'cond_else' : null
  }

  // 执行单个节点
  async function executeNode(nodeId: string): Promise<void> {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return

    const nodeType = node.data?.label
    onStatus?.(nodeId, 'running')

    if (nodeType === '开始' || nodeType === '开始（聊天）' || nodeType === '开始（后台）') {
      // 开始节点不需要执行，只是设置模式
      // 模式信息已在外层设置
    } else if (nodeType === 'Query触发器') {
      // Query触发器节点，只有当有query时才继续执行
      if (!ctx.query || !ctx.query.trim()) {
        // 如果没有query，停止执行后续节点
        if (safeOnOutput) safeOnOutput(nodeId, '⏸️ 等待Query输入...')
        throw new Error('QUERY_REQUIRED') // 特殊错误，用于停止执行但不显示错误
      }
      if (safeOnOutput) safeOnOutput(nodeId, `✓ Query接收: ${ctx.query}`)
    } else if (nodeType === '循环定时器') {
      const cfg = (node.data?.config || { enabled: true, interval: 60, maxIterations: 0 }) as LoopConfig
      // 循环定时器节点不在这里执行，而是在外层控制
      if (safeOnOutput) safeOnOutput(nodeId, `⏱️ 循环定时器：间隔${cfg.interval}秒${cfg.maxIterations ? `，最多${cfg.maxIterations}次` : '，无限循环'}`)
    } else if (nodeType === '设备能力') {
      if (safeOnOutput) safeOnOutput(nodeId, '此节点只能通过 Dashboard 的“本机运行”交给 Local Runtime 执行。')
      throw new Error('DEVICE_RUNTIME_REQUIRED')
    } else if (nodeType === '条件分支') {
      const branch = await executeConditionalNode(nodeId)
      ctx.variables.condition = { branch }
      if (safeOnOutput) safeOnOutput(nodeId, `条件分支执行：${branch}`)
    } else if (nodeType === '知识检索') {
      const cfg = (node.data?.config || { topK: 3, source: 'static' }) as KbConfig
      try {
        let matches
        // 根据数据源调用不同的 API
        if (cfg.source === 'dynamic') {
          // 调用动态知识库
          const response = await api('/api/knowledge/search', { 
            query: ctx.query, 
            top_k: cfg.topK 
          }, authToken)
          matches = {
            matches: (response.results || []).map((r: any) => ({
              text: r.content || r.text,
              title: r.title,
              score: r.similarity
            }))
          }
        } else {
          // 调用静态向量数据库
          matches = await api('/api/vector/search', { 
            query: ctx.query, 
            topK: cfg.topK 
          }, authToken)
        }
        
        ctx.variables.kb_text = matches.matches.map((m: any) => m.text).join('\n\n')
        ctx.knowledgeMatches = matches.matches
        if (safeOnOutput) safeOnOutput(nodeId, `${ctx.variables.kb_text}`)
      } catch (error) {
        if (safeOnOutput) safeOnOutput(nodeId, `**知识检索失败**\n\n${(error as Error).message}`)
      }
    } else if (nodeType === 'LLM') {
      const cfg = (node.data?.config || { 
        model: 'qwen-plus', 
        temperature: 0.7, 
        systemPrompt: '你是一个有用的中文助手。', 
        userPrompt: '{{query}}',
        apiKey: '',
        apiUrl: '',
        provider: 'qwen'
      }) as LlmConfig
      
      // 先搜索聊天历史作为上下文
      let chatContext = ''
      try {
        const searchResponse = await api('/api/chat/search-context', {
          query: ctx.query,
          workflowId: workflowId,
          topK: 3
        }, authToken)
        
        console.log('🔍 搜索聊天历史结果:', searchResponse)
        
        if (searchResponse.success && searchResponse.results && searchResponse.results.length > 0) {
          const contextParts = searchResponse.results.map((r: any, i: number) => 
            `[历史对话${i + 1}]\n问题: ${r.question}\n回答: ${r.answer}`
          ).join('\n\n')
          chatContext = `\n\n以下是相关的历史对话记录，请参考这些上下文来回答用户问题：\n\n${contextParts}\n\n`
          console.log('✅ 已添加聊天历史上下文:', chatContext)
        } else {
          console.log('ℹ️ 未找到相关历史对话')
        }
      } catch (contextError) {
        console.warn('❌ 搜索聊天历史失败:', contextError)
      }
      
      // 将聊天历史上下文添加到用户提示中
      const userPromptWithContext = chatContext + renderTemplate(cfg.userPrompt, ctx.variables)
      
      const messages = [
        { role: 'system', content: renderTemplate(cfg.systemPrompt, ctx.variables) },
        { role: 'user', content: userPromptWithContext }
      ]
      
      let text = ''
      try {
        await sseStream('/api/chat-stream', { 
          messages, 
          model: cfg.model, 
          temperature: cfg.temperature,
          apiKey: cfg.apiKey,
          apiUrl: cfg.apiUrl,
          provider: cfg.provider || 'qwen',
          workflowId: workflowId
        }, authToken, (chunk) => {
          text += chunk
          if (safeOnOutput) safeOnOutput(nodeId, text)
        })
        
        ctx.variables[`llm_text_${nodeId}`] = text
        ctx.llmText = text
      } catch (error) {
        if (safeOnOutput) safeOnOutput(nodeId, `**LLM调用失败**\n\n${(error as Error).message}`)
      }
    } else if (nodeType === 'HTTP请求') {
      const defaultConfig: HttpConfig = { 
        method: 'GET', 
        url: 'https://api.example.com', 
        headers: [],
        bodyType: 'none',
        bodyText: '',
        bodyJson: '{}',
        variables: [],
        auth: {
          type: 'none',
          bearerToken: '',
          apiKey: { key: '', value: '', location: 'header' },
          basicAuth: { username: '', password: '' },
          oauth2: { accessToken: '', clientId: '', clientSecret: '', tokenUrl: '', scope: '', grantType: 'client_credentials' },
          customAuth: { headers: [], queryParams: [], bodyParams: [] }
        },
        advanced: {
          timeout: 30000,
          retries: 0,
          followRedirects: true,
          validateSSL: true,
          customUserAgent: ''
        }
      }
      
      const cfg: HttpConfig = {
        ...defaultConfig,
        ...node.data?.config,
        auth: {
          ...defaultConfig.auth,
          ...node.data?.config?.auth
        },
        advanced: {
          ...defaultConfig.advanced,
          ...node.data?.config?.advanced
        }
      }
      
      try {
        const renderedUrl = renderTemplate(cfg.url, ctx.variables)
        const renderedHeaders = Object.fromEntries(
          cfg.headers.map(h => [h.key, renderTemplate(h.value, ctx.variables)])
        )
        const renderedBody = cfg.bodyType === 'json' ? 
          renderJsonTemplate(cfg.bodyJson, ctx.variables) :
          renderTemplate(cfg.bodyText, ctx.variables)
        
        // 处理认证信息
        const authHeaders = { ...renderedHeaders }
        const authQueryParams: Array<{key: string, value: string}> = []
        const authBodyParams: Array<{key: string, value: string}> = []
        
        // 根据认证类型添加相应的认证信息
        if (cfg.auth.type === 'bearer' && cfg.auth.bearerToken) {
          const token = renderTemplate(cfg.auth.bearerToken, ctx.variables)
          authHeaders['Authorization'] = `Bearer ${token}`
        } else if (cfg.auth.type === 'apikey' && cfg.auth.apiKey) {
          const key = renderTemplate(cfg.auth.apiKey.key, ctx.variables)
          const value = renderTemplate(cfg.auth.apiKey.value, ctx.variables)
          if (cfg.auth.apiKey.location === 'header') {
            authHeaders[key] = value
          } else if (cfg.auth.apiKey.location === 'query') {
            authQueryParams.push({ key, value })
          } else if (cfg.auth.apiKey.location === 'body') {
            authBodyParams.push({ key, value })
          }
        } else if (cfg.auth.type === 'basic' && cfg.auth.basicAuth) {
          const username = renderTemplate(cfg.auth.basicAuth.username, ctx.variables)
          const password = renderTemplate(cfg.auth.basicAuth.password, ctx.variables)
          const credentials = btoa(`${username}:${password}`)
          authHeaders['Authorization'] = `Basic ${credentials}`
        } else if (cfg.auth.type === 'custom' && cfg.auth.customAuth) {
          // 处理自定义认证的headers
          cfg.auth.customAuth.headers.forEach(h => {
            const key = renderTemplate(h.key, ctx.variables)
            const value = renderTemplate(h.value, ctx.variables)
            authHeaders[key] = value
          })
          // 处理自定义认证的query参数
          cfg.auth.customAuth.queryParams.forEach(p => {
            const key = renderTemplate(p.key, ctx.variables)
            const value = renderTemplate(p.value, ctx.variables)
            authQueryParams.push({ key, value })
          })
          // 处理自定义认证的body参数
          cfg.auth.customAuth.bodyParams.forEach(p => {
            const key = renderTemplate(p.key, ctx.variables)
            const value = renderTemplate(p.value, ctx.variables)
            authBodyParams.push({ key, value })
          })
        }
        
        // 处理OAuth2认证（直接使用提供的token）
        if (cfg.auth.type === 'oauth2' && cfg.auth.oauth2?.accessToken) {
          const accessToken = renderTemplate(cfg.auth.oauth2.accessToken, ctx.variables)
          authHeaders['Authorization'] = `Bearer ${accessToken}`
        }
        
        // 将variables数组转换为对象
        const variablesObj = cfg.variables.reduce((acc, v) => ({ ...acc, [v.key]: v.value }), {})
        
        // 对于JSON类型的body，直接发送字符串，让后端的/api/http-request处理
        const bodyToSend = renderedBody
        
        const result = await api('/api/http-request', {
          method: cfg.method,
          url: renderedUrl,
          headers: authHeaders,
          body: bodyToSend,
          variables: { ...ctx.variables, ...variablesObj },
          auth: cfg.auth,
          advanced: cfg.advanced,
          authQueryParams,
          authBodyParams
        }, authToken)
        
        ctx.variables.http_data = result.json || result.content
        ctx.variables.http_text = result.content
        ctx.variables[`http_data_${nodeId}`] = result.json || result.content
        ctx.variables[`http_text_${nodeId}`] = result.content
        
        // 为了支持点号访问，直接使用 nodeId 作为变量名
        if (result.json) {
          ctx.variables[nodeId] = result.json
        }
        if (safeOnOutput) safeOnOutput(nodeId, `${ctx.variables.http_text}`)
      } catch (error) {
        if (safeOnOutput) safeOnOutput(nodeId, `**HTTP请求失败**\n\n${(error as Error).message}`)
      }
    } else if (nodeType === '数据分析') {
      const cfg = (node.data?.config || { 
        apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', 
        apiKey: '', 
        questionTemplate: '请对以下数据进行分析：{{query}}',
        provider: 'qwen',
        model: 'qwen-plus',
        temperature: 0.2
      }) as AnalysisConfig
      
      try {
        const question = renderTemplate(cfg.questionTemplate || '{{query}}', ctx.variables)
        
        // 检查是否有上传的文件数据
        if (cfg.uploadedData && cfg.uploadedHeaders) {
          // 使用带文件数据的流式分析API
          let text = ''
          await sseStream('/api/analysis-with-data', { 
            apiUrl: cfg.apiUrl,
            apiKey: cfg.apiKey,
            question,
            data: cfg.uploadedData,
            headers: cfg.uploadedHeaders,
            provider: cfg.provider,
            model: cfg.model,
            temperature: cfg.temperature
          }, authToken, (chunk) => {
            text += chunk
            if (safeOnOutput) safeOnOutput(nodeId, text)
          })
          
          ctx.variables[`analysis_text_${nodeId}`] = text
          // 设置最终答案
          ctx.variables.answer = text
        } else {
          // 使用原有的流式分析API
          let text = ''
          await sseStream('/api/analysis-stream', { 
            apiUrl: cfg.apiUrl, 
            apiKey: cfg.apiKey, 
            question, 
            provider: cfg.provider,
            model: cfg.model,
            temperature: cfg.temperature
          }, authToken, (chunk) => {
            text += chunk
            if (safeOnOutput) safeOnOutput(nodeId, text)
          })
          
          ctx.variables[`analysis_text_${nodeId}`] = text
          // 设置最终答案
          ctx.variables.answer = text
        }
      } catch (error) {
        if (safeOnOutput) safeOnOutput(nodeId, `**数据分析失败**\n\n${(error as Error).message}`)
      }
    } else if (nodeType === '直接回复') {
      const cfg = (node.data?.config || { mode: 'template', template: '{{query}}' }) as AnswerConfigEx
      if (cfg.mode === 'llm') {
        ctx.variables.answer = ctx.llmText || ctx.query
      } else {
        // 确保模板变量被正确解析
        console.log('直接回复模板解析:', {
          template: cfg.template,
          variables: ctx.variables,
          nodeId,
          allVariables: Object.keys(ctx.variables),
          analysisVariables: Object.keys(ctx.variables).filter(key => key.includes('analysis_text')),
          allVariablesWithValues: Object.entries(ctx.variables).map(([key, value]) => ({ key, value: String(value).substring(0, 100) }))
        })
        
        // 单独输出每个变量
        console.log('所有变量详情:')
        Object.entries(ctx.variables).forEach(([key, value]) => {
          console.log(`  ${key}:`, value)
        })
        
        // 检查模板中引用的变量是否存在
        const templateVar = 'analysis_text_1758953254017'
        console.log(`模板变量 ${templateVar} 是否存在:`, templateVar in ctx.variables)
        console.log(`模板变量 ${templateVar} 的值:`, ctx.variables[templateVar])
        const renderedTemplate = renderTemplate(cfg.template, ctx.variables)
        console.log('渲染结果:', renderedTemplate)
        ctx.variables.answer = renderedTemplate
      }
      if (safeOnOutput) safeOnOutput(nodeId, `${ctx.variables.answer}`)
    }

    onStatus?.(nodeId, 'done')
  }

  // 查找所有开始节点（支持多个开始节点）
  const startNodes = nodes.filter(n => 
    n.data?.label === '开始' || 
    n.data?.label === '开始（聊天）' || 
    n.data?.label === '开始（后台）' ||
    n.id === 'start'
  )
  
  // 根据模式过滤开始节点
  const relevantStartNodes = startNodes.filter(n => {
    const cfg = (n.data?.config || { mode: 'chat' }) as StartConfig
    return cfg.mode === (isBackgroundMode ? 'background' : 'chat')
  })
  
  if (relevantStartNodes.length === 0) {
    console.log(`没有找到${isBackgroundMode ? '后台' : '聊天'}模式的开始节点`)
    return ctx
  }
  
  // 递归执行节点
  async function executeNodeChain(nodeId: string) {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    
    // 如果是条件分支节点，需要根据条件选择分支
    if (node.data?.label === '条件分支') {
      const branchHandle = await executeConditionalNode(nodeId)
      if (branchHandle) {
        // 根据返回的handle ID查找对应的边
        const branchEdges = edges.filter(e => e.source === nodeId && e.sourceHandle === branchHandle)
        
        // 兼容旧的边配置（如果没有找到新格式的边，尝试旧格式）
        if (branchEdges.length === 0) {
          // 兼容旧的'if', 'elif', 'else'格式
          if (branchHandle === 'cond_0') {
            const oldIfEdges = edges.filter(e => e.source === nodeId && e.sourceHandle === 'if')
            branchEdges.push(...oldIfEdges)
          } else if (branchHandle === 'cond_else') {
            const oldElseEdges = edges.filter(e => e.source === nodeId && e.sourceHandle === 'else')
            branchEdges.push(...oldElseEdges)
          } else if (branchHandle.startsWith('cond_')) {
            const oldElifEdges = edges.filter(e => e.source === nodeId && e.sourceHandle === 'elif')
            branchEdges.push(...oldElifEdges)
          }
        }
        
        for (const branchEdge of branchEdges) {
          await executeNode(branchEdge.target)
          await executeNodeChain(branchEdge.target)
        }
      }
    } else {
      // 普通节点直接执行
      await executeNode(nodeId)
      
      // 继续执行后续节点
      const nextEdges = edges.filter(e => e.source === nodeId)
      for (const nextEdge of nextEdges) {
        await executeNodeChain(nextEdge.target)
      }
    }
  }
  
  // 执行所有相关的开始节点
  for (const startNode of relevantStartNodes) {
    try {
      await executeNode(startNode.id)
      
      // 找到从该开始节点出发的边并开始执行
      const startEdges = edges.filter(e => e.source === startNode.id)
      for (const edge of startEdges) {
        await executeNodeChain(edge.target)
      }
    } catch (error) {
      if ((error as Error).message === 'QUERY_REQUIRED') {
        // Query触发器节点要求输入，跳过此工作流
        console.log(`工作流 ${startNode.id} 需要Query输入，已跳过`)
        continue
      }
      throw error
    }
  }
  
  return ctx
}

// 循环执行工作流（后台模式）
async function runFlowLoop(
  query: string,
  nodes: Node[],
  edges: Edge[],
  serverConfig: any,
  workflowId: string,
  authToken: string,
  onStatus?: (nodeId: string, status: 'running' | 'done') => void,
  onOutput?: (nodeId: string, output: string) => void,
  onLog?: (message: string) => void,
  stopSignal?: () => boolean
): Promise<void> {
  // 查找所有后台模式的开始节点
  const backgroundStartNodes = nodes.filter(n => {
    const isStartNode = n.data?.label === '开始' || 
                       n.data?.label === '开始（聊天）' || 
                       n.data?.label === '开始（后台）' ||
                       n.id === 'start'
    if (!isStartNode) return false
    
    const cfg = (n.data?.config || { mode: 'chat' }) as StartConfig
    return cfg.mode === 'background'
  })
  
  if (backgroundStartNodes.length === 0) {
    if (onLog) onLog('⚠️ 没有找到后台模式的开始节点')
    return
  }
  
  if (onLog) onLog(`✓ 找到 ${backgroundStartNodes.length} 个后台工作流`)
  
  // 查找循环定时器节点
  const loopNode = nodes.find(n => n.data?.label === '循环定时器')
  const loopConfig: LoopConfig = loopNode?.data?.config || { enabled: false, interval: 60, maxIterations: 0 }
  
  if (!loopConfig.enabled) {
    if (onLog) onLog('ℹ️ 循环定时器未启用，执行一次后退出')
    // 不循环，执行一次
    await runFlow(query, nodes, edges, serverConfig, workflowId, authToken, onStatus, onOutput, {
      isBackgroundMode: true, 
      shouldStop: stopSignal 
    })
    return
  }
  
  if (onLog) onLog(`⏱️ 循环定时器已启用：间隔${loopConfig.interval}秒，${loopConfig.maxIterations || 0 > 0 ? `最多${loopConfig.maxIterations}次` : '无限循环'}`)
  
  // 循环执行
  let iteration = 0
  const maxIterations = loopConfig.maxIterations || 0
  
  while (true) {
    // 检查停止信号
    if (stopSignal && stopSignal()) {
      if (onLog) onLog(`⏹️ 循环执行已停止（第${iteration}次迭代）`)
      break
    }
    
    // 检查最大迭代次数
    if (maxIterations > 0 && iteration >= maxIterations) {
      if (onLog) onLog(`✅ 循环执行已完成（共${iteration}次迭代）`)
      break
    }
    
    iteration++
    const timestamp = new Date().toLocaleString('zh-CN')
    
    if (onLog) onLog(`🔄 [${timestamp}] 开始第${iteration}次执行...`)
    
    try {
      await runFlow(query, nodes, edges, serverConfig, workflowId, authToken, onStatus, onOutput, {
        isBackgroundMode: true, 
        loopConfig,
        shouldStop: stopSignal 
      })
      
      if (onLog) onLog(`✓ [${timestamp}] 第${iteration}次执行完成`)
    } catch (error) {
      const errorMsg = (error as Error).message
      if (errorMsg !== 'QUERY_REQUIRED') {
        if (onLog) onLog(`✗ [${timestamp}] 第${iteration}次执行失败: ${errorMsg}`)
      }
    }
    
    // 等待间隔时间
    if (loopConfig.interval > 0) {
      if (onLog) onLog(`⏳ 等待${loopConfig.interval}秒后继续...`)
      
      // 分段等待，以便及时响应停止信号
      const waitSteps = Math.max(1, loopConfig.interval)
      for (let i = 0; i < waitSteps; i++) {
        if (stopSignal && stopSignal()) {
          if (onLog) onLog(`⏹️ 循环执行已停止（等待期间）`)
          return
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  }
}

// 主组件
interface WorkflowEditorProps {
  workflowId: string;
  token: string;
  user: any;
  onBack: () => void;
  onSave: (workflowId: string, name: string, nodes: any[], edges: any[]) => void;
}

export default function WorkflowEditor({ workflowId, token, user, onBack, onSave }: WorkflowEditorProps) {
  // 根据workflowId决定初始节点：新建工作流只包含开始节点，现有工作流加载完整数据
  const [nodes, setNodes, onNodesChange] = useNodesState(
    workflowId === 'new' ? [{ 
      id: 'start', 
      type: 'card', 
      position: { x: 50, y: 80 }, 
      data: { 
        label: '开始', 
        icon: '🔵', 
        theme: 'theme-blue', 
        handles: ['right'], 
        config: { } 
      } 
    }] : initialNodes
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    workflowId === 'new' ? [] : initialEdges
  );
  const onConnect = useCallback((connection: Connection) => setEdges((eds) => addEdge(connection, eds)), []);
  const [question, setQuestion] = useState('什么是混合检索?');
  const [loading, setLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [showNewNodeMenu, setShowNewNodeMenu] = useState(false);
  const [workflowName, setWorkflowName] = useState('未命名工作流');
  const [serverConfig, setServerConfig] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved' as 'saved' | 'saving' | 'error');
  
  // 后台任务状态
  const [isBackgroundRunning, setIsBackgroundRunning] = useState(false);
  const [backgroundLogs, setBackgroundLogs] = useState([]);
  const stopSignalRef = useRef(false);

  // 加载服务器配置
  React.useEffect(() => {
    fetch('/api/config', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(config => setServerConfig(config))
      .catch(err => console.error('Failed to load server config:', err))
  }, [token]);

  // 确保开始节点始终有正确的配置
  React.useEffect(() => {
    setNodes(currentNodes => 
      currentNodes.map(node => 
        node.id === 'start' 
          ? { 
              ...node, 
              type: 'card',
              data: {
                ...node.data,
                handles: ['right'],
                theme: 'theme-blue',
                icon: '🔵',
                label: '开始'
              }
            }
          : node
      )
    );
  }, []);

  // 自动保存功能 - 当节点或边发生变化时自动保存
  React.useEffect(() => {
    if (workflowId !== 'new' && nodes.length > 0) {
      const timeoutId = setTimeout(() => {
        handleSave().catch(error => {
          console.error('自动保存失败:', error);
        });
      }, 2000); // 2秒后自动保存

      return () => clearTimeout(timeoutId);
    }
  }, [nodes, edges, workflowName, workflowId]);

  // 加载工作流数据
  useEffect(() => {
    if (workflowId && workflowId !== 'new') {
      loadWorkflow();
    }
  }, [workflowId]);

  const loadWorkflow = async () => {
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
      const workflow = data.workflow;
      
      setWorkflowName(workflow.name);
      // 确保所有节点都有正确的type
      const nodesWithCorrectType = workflow.nodes.map((node: any) => ({
        ...node,
        type: 'card' // 确保所有节点都使用card类型
      }));
      setNodes(nodesWithCorrectType);
      setEdges(workflow.edges);
      
      // 加载聊天记录
      loadChatHistory();
    } catch (err: any) {
      console.error('加载工作流失败:', err);
    }
  };

  // 加载聊天记录
  const loadChatHistory = () => {
    try {
      const savedHistory = localStorage.getItem(`chatHistory_${workflowId}`)
      if (savedHistory) {
        const history = JSON.parse(savedHistory)
        setChatHistory(history)
      }
    } catch (error) {
      console.error('加载聊天记录失败:', error)
    }
  }

  // 保存聊天记录
  const saveChatHistory = (history: any[]) => {
    try {
      localStorage.setItem(`chatHistory_${workflowId}`, JSON.stringify(history))
    } catch (error) {
      console.error('保存聊天记录失败:', error)
    }
  }

  // 保存聊天记录到知识库
  const saveChatToKnowledgeBase = async (question: string, answer: string) => {
    try {
      const response = await fetch('/api/chat/add-context', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workflowId: workflowId,
          question: question,
          answer: answer,
          timestamp: Date.now()
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('聊天记录已保存到知识库:', data);
      } else {
        console.warn('保存聊天记录到知识库失败');
      }
    } catch (error) {
      console.error('保存聊天记录到知识库失败:', error);
    }
  };

  // 清除聊天记录（包括知识库）
  const clearChatHistory = async () => {
    try {
      // 清除知识库中的聊天记录
      const response = await fetch('/api/chat/clear-context', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workflowId: workflowId
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('知识库聊天记录已清除:', data);
      } else {
        console.warn('清除知识库聊天记录失败');
      }
    } catch (error) {
      console.error('清除知识库聊天记录失败:', error);
    }
    
    // 清除本地聊天记录
    setChatHistory([]);
    saveChatHistory([]);
  };

  // 从 nodes 数组和 selectedNodeId 动态获取当前选中的节点
  const selected = useMemo(() => {
    if (!selectedNodeId) return null
    return nodes.find(n => n.id === selectedNodeId) || null
  }, [nodes, selectedNodeId])

  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return null
    return edges.find(e => e.id === selectedEdgeId) || null
  }, [edges, selectedEdgeId])

  // 运行工作流（聊天模式）
  const runWorkflow = async () => {
    if (!question.trim()) return
    setLoading(true)
    setChatHistory([])

    try {
      // 添加用户问题到聊天历史
      const newHistory = [...chatHistory, { 
        question, 
        timestamp: Date.now() 
      }]
      setChatHistory(newHistory)
      saveChatHistory(newHistory)

      // 只执行聊天模式的工作流（isBackgroundMode = false）
      const ctx = await runFlow(question, nodes, edges, serverConfig, workflowId, token, (nodeId, status) => {
        setNodes((ns) => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, runtimeStatus: status } } : n))
      }, (nodeId, output) => {
        // 获取节点信息
        const node = nodes.find(n => n.id === nodeId)
        const nodeLabel = node?.data?.label || '未知节点'
        const nodeIcon = node?.data?.icon || '🔧'
        
        // 检查是否已经存在该节点的输出记录
        setChatHistory(prev => {
          const existingIndex = prev.findIndex(chat => 
            chat.meta?.nodeId === nodeId &&
            chat.isStreaming
          )
          
          let updated
          if (existingIndex >= 0) {
            // 更新现有的流式输出记录
            updated = [...prev]
            updated[existingIndex] = {
              ...updated[existingIndex],
              answer: output,
              timestamp: Date.now()
            }
          } else {
            // 创建新的输出记录
            updated = [...prev, { 
              answer: output,
              meta: {
                nodeId: nodeId,
                label: nodeLabel,
                avatar: nodeIcon
              },
              isStreaming: true,
              timestamp: Date.now()
            }]
          }
          
          // 保存到本地存储
          saveChatHistory(updated)
          return updated
        })
      })

      // 标记所有流式输出为完成
      setChatHistory(prev => {
        const updated = prev.map(chat => 
          chat.isStreaming ? { ...chat, isStreaming: false } : chat
        )
        saveChatHistory(updated)
        return updated
      })

      // 优先使用LLM的输出，其次是answer变量
      const finalAnswer = ctx.llmText || ctx.variables.answer || '工作流执行完成'
      
      console.log('💾 准备保存聊天记录 - 问题:', question, '回答:', finalAnswer)
      
      // 保存聊天记录到知识库（只保存有实际内容的回答）
      if (finalAnswer && question.trim() && finalAnswer !== '工作流执行完成') {
        await saveChatToKnowledgeBase(question, finalAnswer);
      } else {
        console.log('⚠️ 跳过保存（回答无效）')
      }
      
      setQuestion('')
    } catch (error) {
      console.error('工作流执行失败:', error)
      
      // 标记所有流式输出为完成
      setChatHistory(prev => {
        const updated = prev.map(chat => 
          chat.isStreaming ? { ...chat, isStreaming: false } : chat
        )
        saveChatHistory(updated)
        return updated
      })
      
      console.error('工作流执行失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // 启动后台任务
  const startBackgroundTask = async () => {
    stopSignalRef.current = false
    setIsBackgroundRunning(true)
    setBackgroundLogs([])
    
    try {
      await runFlowLoop(
        '', // 后台任务默认查询为空
        nodes,
        edges,
        serverConfig,
        workflowId,
        token,
        (nodeId, status) => {
          // 更新节点运行状态，但不显示在聊天框
          setNodes((ns) => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, runtimeStatus: status } } : n))
        },
        undefined, // 后台模式不输出到聊天框
        (message) => {
          // 添加日志
          setBackgroundLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`])
        },
        () => stopSignalRef.current
      )
    } catch (error) {
      setBackgroundLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 错误: ${(error as Error).message}`])
    } finally {
      setIsBackgroundRunning(false)
    }
  }
  
  // 停止后台任务
  const stopBackgroundTask = () => {
    stopSignalRef.current = true
    setBackgroundLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏹️ 正在停止后台任务...`])
  }

  // 创建新节点
  const createNewNode = (nodeType: string) => {
    const id = `${nodeType}_${Date.now()}`
    const baseX = 100 + Math.random() * 200
    const baseY = 100 + Math.random() * 200
    let newNode: Node

    switch (nodeType) {
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
            config: { topK: 3, source: 'static' } as KbConfig
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
              systemPrompt: '你是一个有用的中文助手。', 
              userPrompt: '{{query}}',
              apiKey: '',
              apiUrl: '',
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
            config: { mode: 'template', template: '{{query}}' } as AnswerConfig
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
      case 'analysis':
        newNode = {
          id,
          type: 'card',
          position: { x: baseX, y: baseY },
          data: {
            label: '数据分析',
            icon: '📊',
            theme: 'theme-blue',
            handles: ['left', 'right'],
            config: { 
              apiUrl: serverConfig?.providers?.qwen?.defaultUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1', 
              apiKey: '', 
              questionTemplate: '请对以下问题进行数据分析：{{query}}',
              provider: 'qwen',
              model: serverConfig?.providers?.qwen?.defaultModel || 'qwen-plus',
              temperature: 0.2
            } as AnalysisConfig
          }
        }
        break
      case 'cond': {
        const defaultCondConfig: CondConfig = { 
          if: { variable: 'query', operator: 'contains', value: '技术' }, 
          elifs: [], 
          elseEnabled: true 
        }
        newNode = {
          id,
          type: 'card',
          position: { x: baseX, y: baseY },
          data: {
            label: '条件分支',
            icon: '🧩',
            theme: 'theme-cyan',
            handles: ['left'],
            conditionHandles: generateConditionHandles(defaultCondConfig),
            config: defaultCondConfig
          }
        }
        break
      }
      case 'device':
        newNode = {
          id,
          type: 'card',
          position: { x: baseX, y: baseY },
          data: {
            label: '设备能力',
            subtitle: 'Local Runtime only',
            runtimeType: 'device',
            icon: 'PC',
            theme: 'theme-cyan',
            handles: ['left', 'right'],
            config: {
              action: 'system.info',
              path: '{{query}}',
              content: '{{query}}',
              adapterId: '',
              adapterAction: '',
              adapterInput: '{\n  "path": "{{query}}"\n}'
            } as DeviceConfig
          }
        }
        break
      case 'start_chat':
        newNode = {
          id,  // 使用动态ID，允许多个开始节点
          type: 'card',
          position: { x: baseX, y: baseY },
          data: {
            label: '开始（聊天）',
            icon: '💬',
            theme: 'theme-blue',
            handles: ['right'],
            config: { mode: 'chat' } as StartConfig
          }
        }
        break
      case 'start_background':
        newNode = {
          id,  // 使用动态ID，允许多个开始节点
          type: 'card',
          position: { x: baseX, y: baseY },
          data: {
            label: '开始（后台）',
            icon: '⚙️',
            theme: 'theme-gray',
            handles: ['right'],
            config: { mode: 'background' } as StartConfig
          }
        }
        break
      case 'query':
        newNode = {
          id,
          type: 'card',
          position: { x: baseX, y: baseY },
          data: {
            label: 'Query触发器',
            icon: '🎯',
            theme: 'theme-green',
            handles: ['left', 'right'],
            config: { enabled: true } as QueryTriggerConfig
          }
        }
        break
      case 'loop':
        newNode = {
          id,
          type: 'card',
          position: { x: baseX, y: baseY },
          data: {
            label: '循环定时器',
            icon: '⏱️',
            theme: 'theme-indigo',
            handles: ['left', 'right'],
            config: { enabled: true, interval: 60, maxIterations: 0 } as LoopConfig
          }
        }
        break
    }
    
    // 所有节点都直接添加，不再替换
    setNodes(nds => [...nds, newNode])
    setSelectedNodeId(id)
    setShowNewNodeMenu(false)
  }

  // 删除选中的节点或边
  const deleteSelectedNode = () => {
    if (selected && selected.id !== 'start') {
      setEdges((eds) => eds.filter(e => e.source !== selected.id && e.target !== selected.id))
      setNodes((nds) => nds.filter(n => n.id !== selected.id))
      setSelectedNodeId(null)
    }
  }

  const deleteSelectedEdge = () => {
    if (selectedEdge) {
      setEdges((eds) => eds.filter(e => e.id !== selectedEdge.id))
      setSelectedEdgeId(null)
    }
  }

  // 保存工作流
  const handleSave = async () => {
    if (workflowId === 'new') return;
    
    setSaveStatus('saving');
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: workflowName,
          nodes: nodes,
          edges: edges
        })
      });

      if (!response.ok) {
        throw new Error('保存工作流失败');
      }

      onSave(workflowId, workflowName, nodes, edges);
      setSaveStatus('saved');
    } catch (err: any) {
      console.error('保存工作流失败:', err);
      setSaveStatus('error');
    }
  };

  // 键盘事件处理
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const isEditable = target.tagName === 'INPUT' || 
                        target.tagName === 'TEXTAREA' || 
                        target.contentEditable === 'true' ||
                        target.closest('input, textarea, [contenteditable]')
      
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

  // 聊天界面
  const chatInterface = useMemo(() => (
    <div className="chat-container">
      <div className="chat-messages">
        {chatHistory.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">💬</div>
            <div className="chat-empty-text">开始对话吧！</div>
          </div>
        ) : (
          <>
            {chatHistory.map((chat, index) => (
              <div key={index} className="chat-item">
                {chat.question ? (
                  <div className="chat-question">
                    <div className="chat-avatar">👤</div>
                    <div className="chat-content">
                      <div className="chat-text">{chat.question}</div>
                      <div className="chat-time">{new Date(chat.timestamp).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ) : null}
                {String(chat.answer || '').trim().length > 0 ? (
                  <div className="chat-answer">
                    <div className="chat-avatar">{(chat as any).meta?.avatar || '🤖'}</div>
                    <div className="chat-content">
                      {(() => {
                        const raw = String(chat.answer || '')
                        const parsed = parseMarkdownTable(raw)
                        if (parsed) {
                          // 检查是否包含分析文本（除了表格外的内容）
                          const { analysisText } = parseAnalysisResult(raw)
                          if (analysisText) {
                            // 如果有分析文本，使用新的AnalysisResult组件
                            return <AnalysisResult content={raw} />
                          } else {
                            // 如果只有表格，使用原来的ChartWidget
                            return <LazyChartWidget headers={parsed.headers} rows={parsed.rows} />
                          }
                        }
                        const safeLabel = (chat as any).meta?.label
                          ? escapeHtml(String((chat as any).meta.label))
                          : ''
                        return <div className="chat-text" dangerouslySetInnerHTML={{ __html: (safeLabel ? `<div style="font-size:12px;color:#64748b;margin-bottom:4px"><strong>${safeLabel}</strong> 输出</div>` : '') + renderMarkdownToHtml(raw) }} />
                      })()}
                      <div className="chat-time">{new Date(chat.timestamp).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </>
        )}
      </div>
      
      <div className="chat-input">
        <input 
          value={question} 
          onChange={(e) => setQuestion(e.target.value)} 
          placeholder="输入你的问题..." 
          onKeyPress={(e) => e.key === 'Enter' && runWorkflow()}
          disabled={loading}
        />
        <button onClick={runWorkflow} disabled={loading || !question.trim()}>
          {loading ? '发送中...' : '发送'}
        </button>
      </div>
      
      {/* 后台任务状态和日志 */}
      {isBackgroundRunning && (
        <div style={{
          borderTop: '2px solid #3b82f6',
          backgroundColor: '#eff6ff',
          padding: '8px 12px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px'
          }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: '#1e40af' }}>
              🔄 后台任务运行中...
            </span>
            <button
              onClick={() => setBackgroundLogs([])}
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                background: '#e5e7eb',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              清空日志
            </button>
          </div>
          {backgroundLogs.length > 0 && (
            <div style={{
              maxHeight: '120px',
              overflowY: 'auto',
              backgroundColor: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: '4px',
              padding: '6px 8px',
              fontSize: '11px',
              fontFamily: 'monospace',
              color: '#374151'
            }}>
              {backgroundLogs.slice(-15).map((log, idx) => (
                <div key={idx} style={{ marginBottom: '2px' }}>{log}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  ), [question, loading, chatHistory, isBackgroundRunning, backgroundLogs])

  // 右侧配置面板
  const rightPanel = useMemo(() => {
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
    // 修复节点类型识别逻辑
    let nodeType = id.split('_')[0] // 使用下划线分割
    // 如果节点ID以数字开头，说明是新建的节点，需要从data.label获取类型
    if (nodeType.match(/^\d/)) {
      const label = selected.data?.label || ''
      if (label.includes('知识检索')) nodeType = 'kb'
      else if (label.includes('LLM')) nodeType = 'llm'
      else if (label.includes('直接回复')) nodeType = 'reply'
      else if (label.includes('HTTP')) nodeType = 'http'
      else if (label.includes('数据分析')) nodeType = 'analysis'
      else if (label.includes('条件分支')) nodeType = 'cond'
      else if (label.includes('循环定时器')) nodeType = 'loop'
      else if (label.includes('开始')) nodeType = 'start'
      else if (label.includes('Query触发器')) nodeType = 'query'
    }
    
    if (nodeType === 'device') {
      const cfg: DeviceConfig = selected.data?.config || {
        action: 'system.info', path: '{{query}}', content: '{{query}}', adapterId: '', adapterAction: '', adapterInput: '{}'
      }
      const updateDeviceConfig = (patch: Partial<DeviceConfig>) => setNodes(ns => ns.map(node => node.id === selected.id ? {
        ...node,
        data: { ...node.data, config: { ...cfg, ...patch } }
      } : node))
      return (
        <div className="panel">
          <div className="panel-title">设备能力配置</div>
          <div className="runtime-node-callout">仅由已配对的 Local Runtime 执行。无任意 Shell，文件路径必须位于 Runtime 配置的授权目录内。</div>
          <label>本机动作</label>
          <select value={cfg.action} onChange={event => updateDeviceConfig({ action: event.target.value as DeviceConfig['action'] })}>
            <option value="system.info">读取系统信息（只读）</option>
            <option value="file.read">读取文本文件（只读）</option>
            <option value="file.write">写入文本文件（需显式开启）</option>
            <option value="app.invoke">调用本地应用适配器（需审批）</option>
          </select>
          {(cfg.action === 'file.read' || cfg.action === 'file.write') && <>
            <label>文件路径</label>
            <input value={cfg.path} onChange={event => updateDeviceConfig({ path: event.target.value })} placeholder="D:\\NexusFlowData\\note.txt" />
            <div className="field-hint">支持变量，例如 {'{{query}}'}。最终路径仍会经过目录白名单与符号链接检查。</div>
          </>}
          {cfg.action === 'file.write' && <>
            <label>写入内容</label>
            <textarea value={cfg.content} onChange={event => updateDeviceConfig({ content: event.target.value })} placeholder="支持 {{query}} 和上游节点变量" />
            <div className="field-hint">Runtime 必须设置 NEXUSFLOW_ALLOW_WRITES=true，否则节点会安全失败并记录轨迹。</div>
          </>}
          {cfg.action === 'app.invoke' && <>
            <label>适配器 ID</label>
            <input value={cfg.adapterId || ''} onChange={event => updateDeviceConfig({ adapterId: event.target.value.toLowerCase() })} placeholder="例如：photos" />
            <label>动作 ID</label>
            <input value={cfg.adapterAction || ''} onChange={event => updateDeviceConfig({ adapterAction: event.target.value.toLowerCase() })} placeholder="例如：open" />
            <label>动作输入（JSON）</label>
            <textarea value={cfg.adapterInput || '{}'} onChange={event => updateDeviceConfig({ adapterInput: event.target.value })} placeholder={'{\n  "path": "{{query}}"\n}'} />
            <div className="field-hint">适配器和动作必须预先写入 AI PC 的本地清单。工作流只能提供 JSON 输入，无法修改 executable 或启用 Shell。</div>
            <div className="runtime-node-approval-note"><i />执行时会暂停并等待权限中心批准；持续授权也只能作用于当前设备和该精确动作。</div>
          </>}
          <div className="runtime-node-outputs"><span>输出变量</span><code>{`{{device_${selected.id}}}`}</code></div>
        </div>
      )
    }

    // 处理Query触发器配置
    if (nodeType === 'query') {
      const cfg: QueryTriggerConfig = selected.data?.config || { enabled: true }
      return (
        <div className="panel">
          <div className="panel-title">Query触发器配置</div>
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
          <label style={{display:'flex', alignItems:'center', marginBottom:16}}>
            <input 
              type="checkbox" 
              checked={cfg.enabled}
              onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                ...n, 
                data: { 
                  ...n.data, 
                  config: { ...cfg, enabled: e.target.checked } 
                } 
              } : n))}
              style={{marginRight:8}}
            />
            <strong>启用Query触发</strong>
          </label>
          <div style={{marginTop:8, fontSize:12, color:'#64748b'}}>
            💡 当用户在聊天框发送消息时才执行工作流<br/>
            💡 <strong>用于聊天模式</strong>：连接到"开始（聊天）"节点后<br/>
            💡 如果没有Query输入，工作流将暂停在此节点
          </div>
          <div style={{marginTop:12, padding:12, border:'1px solid #10b981', borderRadius:6, backgroundColor:'#d1fae5'}}>
            <div style={{fontSize:13, fontWeight:500, color:'#065f46', marginBottom:4}}>🎯 使用场景</div>
            <div style={{fontSize:12, color:'#047857'}}>
              <strong>聊天交互工作流</strong>：<br/>
              开始（聊天） → Query触发器 → 知识检索 → LLM → 回复<br/>
              <br/>
              只有当用户发送消息时，才会触发后续节点执行
            </div>
          </div>
        </div>
      )
    }
    
    // 处理开始节点配置
    if (nodeType === 'start' || id === 'start') {
      const cfg: StartConfig = selected.data?.config || { mode: 'chat' }
      return (
        <div className="panel">
          <div className="panel-title">{selected.data?.label || '开始节点'}配置</div>
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
          <label>运行模式：
            <select 
              value={cfg.mode}
              onChange={(e) => {
                const newMode = e.target.value as 'chat' | 'background'
                const newLabel = newMode === 'chat' ? '开始（聊天）' : '开始（后台）'
                const newIcon = newMode === 'chat' ? '💬' : '⚙️'
                setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                  ...n, 
                  data: { 
                    ...n.data, 
                    label: newLabel,
                    icon: newIcon,
                    config: { ...cfg, mode: newMode } 
                  } 
                } : n))
              }}
            >
              <option value="chat">聊天模式（显示输出）</option>
              <option value="background">后台模式（静默运行）</option>
            </select>
          </label>
          <div style={{marginTop:8, fontSize:12, color:'#64748b'}}>
            💡 <strong>聊天模式</strong>：所有节点输出显示在聊天框中<br/>
            💡 <strong>后台模式</strong>：工作流后台运行，不显示输出（适合持续监听）
          </div>
          {cfg.mode === 'background' && (
            <div style={{marginTop:12, padding:12, border:'1px solid #fbbf24', borderRadius:6, backgroundColor:'#fef3c7'}}>
              <div style={{fontSize:13, fontWeight:500, color:'#92400e', marginBottom:4}}>⚠️ 后台模式提示</div>
              <div style={{fontSize:12, color:'#78350f'}}>
                • 建议配合"循环定时器"节点使用<br/>
                • 工作流将持续在后台运行<br/>
                • 不会在聊天框显示任何输出<br/>
                • 适合API监听、数据采集等场景
              </div>
            </div>
          )}
        </div>
      )
    }
    
    // 处理循环定时器节点配置
    if (nodeType === 'loop') {
      const cfg: LoopConfig = selected.data?.config || { enabled: true, interval: 60, maxIterations: 0 }
      return (
        <div className="panel">
          <div className="panel-title">循环定时器配置</div>
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
          <label style={{display:'flex', alignItems:'center', marginBottom:16}}>
            <input 
              type="checkbox" 
              checked={cfg.enabled}
              onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                ...n, 
                data: { 
                  ...n.data, 
                  config: { ...cfg, enabled: e.target.checked } 
                } 
              } : n))}
              style={{marginRight:8}}
            />
            <strong>启用循环执行</strong>
          </label>
          {cfg.enabled && (
            <>
              <label>循环间隔（秒）：
                <input 
                  type="number" 
                  min="1" 
                  value={cfg.interval}
                  onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                    ...n, 
                    data: { 
                      ...n.data, 
                      config: { ...cfg, interval: parseInt(e.target.value) || 60 } 
                    } 
                  } : n))}
                />
              </label>
              <label>最大迭代次数（0=无限）：
                <input 
                  type="number" 
                  min="0" 
                  value={cfg.maxIterations || 0}
                  onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                    ...n, 
                    data: { 
                      ...n.data, 
                      config: { ...cfg, maxIterations: parseInt(e.target.value) || 0 } 
                    } 
                  } : n))}
                />
              </label>
              <div style={{marginTop:8, fontSize:12, color:'#64748b'}}>
                💡 每隔 <strong>{cfg.interval}秒</strong> 执行一次工作流<br/>
                {(cfg.maxIterations || 0) > 0 ? 
                  `💡 最多执行 ${cfg.maxIterations || 0} 次后自动停止` : 
                  '💡 将无限循环执行，直到手动停止'
                }
              </div>
              <div style={{marginTop:12, padding:12, border:'1px solid #3b82f6', borderRadius:6, backgroundColor:'#eff6ff'}}>
                <div style={{fontSize:13, fontWeight:500, color:'#1e40af', marginBottom:4}}>📊 使用示例</div>
                <div style={{fontSize:12, color:'#1e3a8a'}}>
                  • <strong>API监听</strong>：每60秒检查一次API数据变化<br/>
                  • <strong>数据采集</strong>：定期获取并存储数据<br/>
                  • <strong>状态检查</strong>：持续监控系统状态<br/>
                  • <strong>定时任务</strong>：按固定间隔执行操作
                </div>
              </div>
            </>
          )}
        </div>
      )
    }
    
    if (nodeType === 'cond') {
        const cfg: CondConfig = selected.data?.config || { 
          if: { variable: 'query', operator: 'contains', value: '' }, 
          elifs: [], 
          elseEnabled: true,
          semanticMatch: {
            enabled: false,
            provider: 'qwen',
            model: 'qwen-plus',
            temperature: 0.1,
            apiKey: '',
            apiUrl: '',
            conditions: []
          }
        }
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
            
            {/* 语义匹配开关 */}
            <div style={{ marginBottom: '16px', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                <input 
                  type="checkbox" 
                  checked={cfg.semanticMatch?.enabled || false}
                  onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                    ...n, 
                    data: { 
                      ...n.data, 
                      config: { 
                        ...cfg, 
                        semanticMatch: { 
                          ...cfg.semanticMatch, 
                          enabled: e.target.checked 
                        } 
                      } 
                    } 
                  } : n))}
                  style={{ marginRight: '8px' }}
                />
                <strong>启用语义匹配</strong>
              </label>
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                使用AI模型进行语义理解，支持更灵活的条件判断
              </div>
            </div>
            
            {/* 语义匹配配置 */}
            {cfg.semanticMatch?.enabled && (
              <div style={{ marginBottom: '16px', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', backgroundColor: '#f9fafb' }}>
                <div className="panel-subtitle">语义匹配配置</div>
                
                <label>模型提供商：
                  <select 
                    value={cfg.semanticMatch.provider}
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                      ...n, 
                      data: { 
                        ...n.data, 
                        config: { 
                          ...cfg, 
                          semanticMatch: { 
                            ...cfg.semanticMatch, 
                            provider: e.target.value 
                          } 
                        } 
                      } 
                    } : n))}
                  >
                    <option value="qwen">通义千问</option>
                    <option value="openai">OpenAI</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="local">本地模型</option>
                  </select>
                </label>
                
                <label>模型名称：
                  <input 
                    value={cfg.semanticMatch.model}
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                      ...n, 
                      data: { 
                        ...n.data, 
                        config: { 
                          ...cfg, 
                          semanticMatch: { 
                            ...cfg.semanticMatch, 
                            model: e.target.value 
                          } 
                        } 
                      } 
                    } : n))}
                    placeholder="qwen-plus"
                  />
                </label>
                
                <label>温度参数：
                  <input 
                    type="number" 
                    min="0" 
                    max="2" 
                    step="0.1"
                    value={cfg.semanticMatch.temperature}
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                      ...n, 
                      data: { 
                        ...n.data, 
                        config: { 
                          ...cfg, 
                          semanticMatch: { 
                            ...cfg.semanticMatch, 
                            temperature: parseFloat(e.target.value) 
                          } 
                        } 
                      } 
                    } : n))}
                  />
                </label>
                
                {cfg.semanticMatch.provider !== 'local' && (
                  <label>API Key：
                    <input 
                      type="password"
                      value={cfg.semanticMatch.apiKey}
                      onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                        ...n, 
                        data: { 
                          ...n.data, 
                          config: { 
                            ...cfg, 
                            semanticMatch: { 
                              ...cfg.semanticMatch, 
                              apiKey: e.target.value 
                            } 
                          } 
                        } 
                      } : n))}
                      placeholder="输入API密钥"
                    />
                  </label>
                )}
                
                <label>API URL：
                  <input 
                    value={cfg.semanticMatch.apiUrl}
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                      ...n, 
                      data: { 
                        ...n.data, 
                        config: { 
                          ...cfg, 
                          semanticMatch: { 
                            ...cfg.semanticMatch, 
                            apiUrl: e.target.value 
                          } 
                        } 
                      } 
                    } : n))}
                    placeholder="API地址（可选）"
                  />
                </label>
                
                <div className="panel-subtitle">语义条件配置</div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                  定义语义匹配的条件，AI会根据用户查询的语义意图进行匹配
                </div>
                
                <button 
                  onClick={() => setNodes((ns) => ns.map(n => {
                    if (n.id === selected.id) {
                      const newConfig = { 
                        ...cfg, 
                        semanticMatch: { 
                          enabled: cfg.semanticMatch?.enabled || false,
                          provider: cfg.semanticMatch?.provider || 'qwen',
                          model: cfg.semanticMatch?.model || 'qwen-plus',
                          temperature: cfg.semanticMatch?.temperature || 0.1,
                          apiKey: cfg.semanticMatch?.apiKey || '',
                          apiUrl: cfg.semanticMatch?.apiUrl || '',
                          ...cfg.semanticMatch, 
                          conditions: [...(cfg.semanticMatch?.conditions || []), { description: '', value: '' }] 
                        } 
                      }
                      return {
                        ...n, 
                        data: { 
                          ...n.data, 
                          config: newConfig,
                          conditionHandles: generateConditionHandles(newConfig)
                        } 
                      }
                    }
                    return n
                  }))}
                  style={{ marginBottom: '8px' }}
                >
                  + 添加语义条件
                </button>
                
                {(cfg.semanticMatch.conditions || []).map((condition, idx) => (
                  <div key={idx} style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '6px', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <strong>条件 {idx + 1}</strong>
                      <button
                        onClick={() => setNodes((ns) => ns.map(n => {
                          if (n.id === selected.id) {
                            const newConfig = { 
                              ...cfg, 
                              semanticMatch: { 
                                enabled: cfg.semanticMatch?.enabled || false,
                                provider: cfg.semanticMatch?.provider || 'qwen',
                                model: cfg.semanticMatch?.model || 'qwen-plus',
                                temperature: cfg.semanticMatch?.temperature || 0.1,
                                apiKey: cfg.semanticMatch?.apiKey || '',
                                apiUrl: cfg.semanticMatch?.apiUrl || '',
                                ...cfg.semanticMatch, 
                                conditions: (cfg.semanticMatch?.conditions || []).filter((_, i) => i !== idx) 
                              } 
                            }
                            return {
                              ...n, 
                              data: { 
                                ...n.data, 
                                config: newConfig,
                                conditionHandles: generateConditionHandles(newConfig)
                              } 
                            }
                          }
                          return n
                        }))}
                        style={{ border: '1px solid #fecaca', background: '#fff5f5', color: '#b91c1c', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}
                      >
                        删除
                      </button>
                    </div>
                    <label>条件描述：
                      <input 
                        value={condition.description}
                        onChange={(e) => setNodes((ns) => ns.map(n => {
                          if (n.id === selected.id) {
                            const newConfig = { 
                              ...cfg, 
                              semanticMatch: { 
                                enabled: cfg.semanticMatch?.enabled || false,
                                provider: cfg.semanticMatch?.provider || 'qwen',
                                model: cfg.semanticMatch?.model || 'qwen-plus',
                                temperature: cfg.semanticMatch?.temperature || 0.1,
                                apiKey: cfg.semanticMatch?.apiKey || '',
                                apiUrl: cfg.semanticMatch?.apiUrl || '',
                                ...cfg.semanticMatch, 
                                conditions: (cfg.semanticMatch?.conditions || []).map((c, i) => 
                                  i === idx ? { ...c, description: e.target.value } : c
                                ) 
                              } 
                            }
                            return {
                              ...n, 
                              data: { 
                                ...n.data, 
                                config: newConfig,
                                conditionHandles: generateConditionHandles(newConfig)
                              } 
                            }
                          }
                          return n
                        }))}
                        placeholder="例如：查询割接列表"
                      />
                    </label>
                    <label>条件值：
                      <input 
                        value={condition.value}
                        onChange={(e) => setNodes((ns) => ns.map(n => {
                          if (n.id === selected.id) {
                            const newConfig = { 
                              ...cfg, 
                              semanticMatch: { 
                                enabled: cfg.semanticMatch?.enabled || false,
                                provider: cfg.semanticMatch?.provider || 'qwen',
                                model: cfg.semanticMatch?.model || 'qwen-plus',
                                temperature: cfg.semanticMatch?.temperature || 0.1,
                                apiKey: cfg.semanticMatch?.apiKey || '',
                                apiUrl: cfg.semanticMatch?.apiUrl || '',
                                ...cfg.semanticMatch, 
                                conditions: (cfg.semanticMatch?.conditions || []).map((c, i) => 
                                  i === idx ? { ...c, value: e.target.value } : c
                                ) 
                              } 
                            }
                            return {
                              ...n, 
                              data: { 
                                ...n.data, 
                                config: newConfig,
                                conditionHandles: generateConditionHandles(newConfig)
                              } 
                            }
                          }
                          return n
                        }))}
                        placeholder="例如：list"
                      />
                    </label>
                  </div>
                ))}
              </div>
            )}
            
            <div className="panel-subtitle">传统关键词匹配</div>
            <label>IF 变量路径：
              <input value={cfg.if.variable}
                onChange={(e) => setNodes((ns) => ns.map(n => {
                  if (n.id === selected.id) {
                    const newConfig = { ...cfg, if: { ...cfg.if, variable: e.target.value } }
                    return {
                      ...n, 
                      data: { 
                        ...n.data, 
                        config: newConfig,
                        conditionHandles: generateConditionHandles(newConfig)
                      } 
                    }
                  }
                  return n
                }))} />
            </label>
            <label>IF 条件：
              <select value={cfg.if.operator}
                onChange={(e) => setNodes((ns) => ns.map(n => {
                  if (n.id === selected.id) {
                    const newConfig = { ...cfg, if: { ...cfg.if, operator: e.target.value as any } }
                    return {
                      ...n, 
                      data: { 
                        ...n.data, 
                        config: newConfig,
                        conditionHandles: generateConditionHandles(newConfig)
                      } 
                    }
                  }
                  return n
                }))}>
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
                  onChange={(e) => setNodes((ns) => ns.map(n => {
                    if (n.id === selected.id) {
                      const newConfig = { ...cfg, if: { ...cfg.if, value: e.target.value } }
                      return {
                        ...n, 
                        data: { 
                          ...n.data, 
                          config: newConfig,
                          conditionHandles: generateConditionHandles(newConfig)
                        } 
                      }
                    }
                    return n
                  }))} />
              </label>
            )}
            <div className="panel-subtitle">ELIF 条件（可选）</div>
            <button onClick={() => setNodes((ns) => ns.map(n => {
              if (n.id === selected.id) {
                const newConfig = { ...cfg, elifs: [...cfg.elifs, { variable: 'query', operator: 'contains' as const, value: '' }] }
                return {
                  ...n, 
                  data: { 
                    ...n.data, 
                    config: newConfig,
                    conditionHandles: generateConditionHandles(newConfig)
                  } 
                }
              }
              return n
            }))}>+ 添加 ELIF</button>
            {cfg.elifs.map((c, idx) => (
              <div key={idx} style={{padding:'40px 8px 8px 8px', border:'1px solid #eee', borderRadius:8, marginTop:8, position:'relative'}}>
                <button
                  onClick={() => setNodes((ns) => ns.map(n => {
                    if (n.id === selected.id) {
                      const newConfig = { 
                        ...cfg, 
                        elifs: cfg.elifs.filter((_, i) => i !== idx) 
                      }
                      return {
                        ...n, 
                        data: { 
                          ...n.data, 
                          config: newConfig,
                          conditionHandles: generateConditionHandles(newConfig)
                        } 
                      }
                    }
                    return n
                  }))}
                  style={{position:'absolute', right:8, top:8, border:'1px solid #fecaca', background:'#fff5f5', color:'#b91c1c', borderRadius:6, padding:'4px 8px', cursor:'pointer', zIndex:1}}
                >删除</button>
                <label>变量：
                  <input value={c.variable}
                    onChange={(e) => setNodes((ns) => ns.map(n => {
                      if (n.id === selected.id) {
                        const newConfig = { ...cfg, elifs: cfg.elifs.map((it,i)=> i===idx?{...it, variable:e.target.value}:it) }
                        return {
                          ...n, 
                          data: { 
                            ...n.data, 
                            config: newConfig,
                            conditionHandles: generateConditionHandles(newConfig)
                          } 
                        }
                      }
                      return n
                    }))} />
                </label>
                <label>条件：
                  <select value={c.operator}
                    onChange={(e) => setNodes((ns) => ns.map(n => {
                      if (n.id === selected.id) {
                        const newConfig = { ...cfg, elifs: cfg.elifs.map((it,i)=> i===idx?{...it, operator:e.target.value as any}:it) }
                        return {
                          ...n, 
                          data: { 
                            ...n.data, 
                            config: newConfig,
                            conditionHandles: generateConditionHandles(newConfig)
                          } 
                        }
                      }
                      return n
                    }))}>
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
                      onChange={(e) => setNodes((ns) => ns.map(n => {
                        if (n.id === selected.id) {
                          const newConfig = { ...cfg, elifs: cfg.elifs.map((it,i)=> i===idx?{...it, value:e.target.value}:it) }
                          return {
                            ...n, 
                            data: { 
                              ...n.data, 
                              config: newConfig,
                              conditionHandles: generateConditionHandles(newConfig)
                            } 
                          }
                        }
                        return n
                      }))} />
                  </label>
                )}
              </div>
            ))}
            <label style={{marginTop:8}}>启用 ELSE：
              <input type="checkbox" checked={cfg.elseEnabled} onChange={(e) => setNodes((ns) => ns.map(n => {
                if (n.id === selected.id) {
                  const newConfig = { ...cfg, elseEnabled: e.target.checked }
                  return {
                    ...n, 
                    data: { 
                      ...n.data, 
                      config: newConfig,
                      conditionHandles: generateConditionHandles(newConfig)
                    } 
                  }
                }
                return n
              }))} />
            </label>
            <div style={{marginTop:8, fontSize:12, color:'#64748b'}}>当前分支：未执行</div>
          </div>
        )
      }
      if (nodeType === 'kb') {
        const cfg: KbConfig = selected.data?.config || { topK: 3, source: 'static' }
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
              <strong>节点 ID:</strong> {selected.id}<br/>
              <strong>可用变量:</strong> <code style={{backgroundColor: '#e5e7eb', padding: '2px 4px', borderRadius: '2px'}}>{"{{kb_text}}"}</code> (检索结果)
            </div>
            <label>数据源：
              <select 
                value={cfg.source || 'static'}
                onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, source: e.target.value } } } : n))}
              >
                <option value="static">📄 静态向量库（上传的文档）</option>
                <option value="dynamic">🔄 动态知识库（实时数据）</option>
              </select>
            </label>
            
            {/* 上传数据按钮 */}
            {cfg.source === 'static' && (
              <div style={{ 
                marginTop: '12px', 
                padding: '12px', 
                backgroundColor: '#f0f9ff', 
                border: '1px solid #0ea5e9', 
                borderRadius: '8px' 
              }}>
                <div style={{ 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#0369a1', 
                  marginBottom: '8px' 
                }}>
                  📁 文档管理
                </div>
                <div style={{ 
                  fontSize: '12px', 
                  color: '#64748b', 
                  marginBottom: '10px' 
                }}>
                  上传文档到静态向量库，支持 PDF、Word、TXT 等格式
                </div>
                <label
                  style={{
                    backgroundColor: '#0ea5e9',
                    color: 'white',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  📤 上传文档
                  <input
                    type="file"
                    hidden
                    accept=".txt,.md,.docx,.pdf,.xlsx,.csv,.json,.xml,.html,.htm"
                    onChange={async event => {
                      const file = event.target.files?.[0]
                      if (!file) return
                      const formData = new FormData()
                      formData.append('file', file)
                      try {
                        const response = await fetch('/api/vector/upload', {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${token}` },
                          body: formData
                        })
                        const result = await response.json()
                        if (!response.ok) throw new Error(result.error || '上传失败')
                        window.alert(`上传成功：${result.inserted}/${result.total} 个文档块`)
                      } catch (error) {
                        window.alert(`上传失败：${(error as Error).message}`)
                      } finally {
                        event.target.value = ''
                      }
                    }}
                  />
                </label>
              </div>
            )}
            <label>TopK：
              <input type="number" value={cfg.topK} min="1" max="10"
                onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, topK: Number(e.target.value) } } } : n))} />
            </label>
            <div style={{marginTop:8, fontSize:12, color:'#64748b'}}>
              💡 静态向量库：已上传的文档文件<br/>
              💡 动态知识库：实时更新的业务数据（需启动 Python API）
            </div>
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
                const provider = e.target.value as 'qwen' | 'openai' | 'local' | 'openrouter'
                let suggestedUrl = ''
                if (provider === 'qwen') {
                  suggestedUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
                } else if (provider === 'openai') {
                  suggestedUrl = 'https://api.openai.com/v1'
                } else if (provider === 'local') {
                  suggestedUrl = serverConfig?.localModelUrl || 'http://localhost:8000/v1/chat/completions'
                } else if (provider === 'openrouter') {
                  suggestedUrl = 'https://openrouter.ai/api/v1'
                }
                // 根据 provider 设置推荐模型
                const model = (
                  provider === 'qwen' ? 'qwen-plus' :
                  provider === 'openai' ? 'gpt-4o' :
                  provider === 'openrouter' ? 'x-ai/grok-4-fast:free' :
                  'local-model'
                )
                setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, provider, apiUrl: suggestedUrl, model } } } : n))
              }}>
                <option value="qwen">Qwen</option>
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
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
            <p className="field-hint">密钥仅保留在当前编辑会话；保存时会被清除。也可在服务端环境变量中配置。</p>
            {cfg.provider === 'openrouter' ? (
              <label>模型：
                <select value={cfg.model || 'x-ai/grok-4-fast:free'} onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, model: e.target.value } } } : n))}>
                  <option value="x-ai/grok-4-fast:free">x-ai/grok-4-fast:free</option>
                  <option value="deepseek/deepseek-chat-v3.1:free">deepseek/deepseek-chat-v3.1:free</option>
                  <option value="tencent/hunyuan-a13b-instruct:free">tencent/hunyuan-a13b-instruct:free</option>
                  <option value="qwen/qwen3-235b-a22b:free">qwen/qwen3-235b-a22b:free</option>
                  <option value="microsoft/mai-ds-r1:free">microsoft/mai-ds-r1:free</option>
                </select>
              </label>
            ) : cfg.provider === 'local' ? (
              <label>模型：
                <input 
                  value={cfg.model || 'local-model'}
                  disabled
                />
              </label>
            ) : (
              <label>模型：
                <input 
                  value={cfg.model || (cfg.provider === 'qwen' ? 'qwen-plus' : 'gpt-4o')}
                  placeholder={cfg.provider === 'qwen' ? 'qwen-plus 等模型' : 'gpt-4o 等模型'}
                  onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, model: e.target.value } } } : n))}
                />
              </label>
            )}
            <label>温度：
              <input type="number" step="0.1" value={cfg.temperature}
                onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, temperature: Number(e.target.value) } } } : n))} />
            </label>
            <label>System Prompt：</label>
            <textarea value={cfg.systemPrompt}
              onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, systemPrompt: e.target.value } } } : n))} />
            <label>User Prompt（可用变量：{'{{query}}'}、{'{{kb_text}}'}、{'{{http_text}}'}、{'{{llm_text_节点ID}}'}、{'{{analysis_text_节点ID}}'}）：</label>
            <textarea value={cfg.userPrompt}
              onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, userPrompt: e.target.value } } } : n))} />
          </div>
        )
      }
      if (nodeType === 'reply') {
        const cfg: AnswerConfigEx = selected.data?.config || { mode: 'template', template: '{{query}}', stream: false }
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
            <label>模板（可用变量：{'{{llm_text_节点ID}}'}、{'{{kb_text}}'}、{'{{query}}'}、{'{{http_text}}'}、{'{{analysis_text_节点ID}}'}）：</label>
            <textarea value={cfg.template}
              onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, template: e.target.value } } } : n))} />
            <label style={{marginTop:8}}>流式输出：
              <input type="checkbox" checked={(cfg as any).stream || false} onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...(cfg as any), stream: e.target.checked } } } : n))} />
            </label>
          </div>
        )
      }
      if (nodeType === 'http') {
        const defaultConfig: HttpConfig = { 
          method: 'GET', 
          url: '', 
          headers: [], 
          bodyType: 'none', 
          bodyText: '', 
          bodyJson: '{}', 
          variables: [],
          auth: {
            type: 'none',
            bearerToken: '',
            apiKey: { key: '', value: '', location: 'header' },
            basicAuth: { username: '', password: '' },
            oauth2: { accessToken: '', clientId: '', clientSecret: '', tokenUrl: '', scope: '', grantType: 'client_credentials' },
            customAuth: { headers: [], queryParams: [], bodyParams: [] }
          },
          advanced: {
            timeout: 30000,
            retries: 0,
            followRedirects: true,
            validateSSL: true,
            customUserAgent: ''
          }
        }
        
        const cfg: HttpConfig = {
          ...defaultConfig,
          ...selected.data?.config,
          auth: {
            ...defaultConfig.auth,
            ...selected.data?.config?.auth
          },
          advanced: {
            ...defaultConfig.advanced,
            ...selected.data?.config?.advanced
          }
        }
        return (
          <div className="panel">
            <div className="panel-title">HTTP请求配置</div>
            
            {/* 响应结果 */}
            <div className="response-section">
              <div className="response-header">
                <span className="response-title">响应内容</span>
                <span id="statusIndicator" className="status-indicator hidden"></span>
              </div>
              <div id="responseContent" className="response-content">
                {selected.data?.lastOutput || '点击"发送请求"查看响应结果...'}
              </div>
            </div>
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
            
            <div className="button-group">
              <button 
                id="sendBtn" 
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    // 将variables数组转换为对象
                    const variablesObj = cfg.variables.reduce((acc, v) => ({ ...acc, [v.key]: v.value }), {})
                    
                    // 处理认证信息（与runFlow中的逻辑保持一致）
                    const authHeaders = { ...cfg.headers.reduce((acc, h) => ({ ...acc, [h.key]: h.value }), {}) }
                    const authQueryParams: Array<{key: string, value: string}> = []
                    const authBodyParams: Array<{key: string, value: string}> = []
                    
                    // 根据认证类型添加相应的认证信息
                    if (cfg.auth.type === 'bearer' && cfg.auth.bearerToken) {
                      authHeaders['Authorization'] = `Bearer ${cfg.auth.bearerToken}`
                    } else if (cfg.auth.type === 'apikey' && cfg.auth.apiKey) {
                      if (cfg.auth.apiKey.location === 'header') {
                        authHeaders[cfg.auth.apiKey.key] = cfg.auth.apiKey.value
                      } else if (cfg.auth.apiKey.location === 'query') {
                        authQueryParams.push({ key: cfg.auth.apiKey.key, value: cfg.auth.apiKey.value })
                      } else if (cfg.auth.apiKey.location === 'body') {
                        authBodyParams.push({ key: cfg.auth.apiKey.key, value: cfg.auth.apiKey.value })
                      }
                    } else if (cfg.auth.type === 'basic' && cfg.auth.basicAuth) {
                      const credentials = btoa(`${cfg.auth.basicAuth.username}:${cfg.auth.basicAuth.password}`)
                      authHeaders['Authorization'] = `Basic ${credentials}`
                    } else if (cfg.auth.type === 'oauth2' && cfg.auth.oauth2?.accessToken) {
                      // 直接使用提供的Access Token
                      authHeaders['Authorization'] = `Bearer ${cfg.auth.oauth2.accessToken}`
                    } else if (cfg.auth.type === 'custom' && cfg.auth.customAuth) {
                      // 处理自定义认证的headers
                      cfg.auth.customAuth.headers.forEach(h => {
                        authHeaders[h.key] = h.value
                      })
                      // 处理自定义认证的query参数
                      cfg.auth.customAuth.queryParams.forEach(p => {
                        authQueryParams.push({ key: p.key, value: p.value })
                      })
                      // 处理自定义认证的body参数
                      cfg.auth.customAuth.bodyParams.forEach(p => {
                        authBodyParams.push({ key: p.key, value: p.value })
                      })
                    }
                    
                    // 渲染URL和Body（与runFlow中的逻辑保持一致）
                    const renderedUrl = renderTemplate(cfg.url, variablesObj)
                    const renderedBody = cfg.bodyType === 'json' ? 
                      renderJsonTemplate(cfg.bodyJson, variablesObj) :
                      cfg.bodyType === 'text' ? 
                      renderTemplate(cfg.bodyText, variablesObj) : ''
                    
                    // 直接发送渲染后的body
                    const bodyToSend = renderedBody
                    
                    const testResult = await api('/api/http-request', {
                      method: cfg.method,
                      url: renderedUrl,
                      headers: authHeaders,
                      body: bodyToSend,
                      variables: variablesObj,
                      auth: cfg.auth,
                      advanced: cfg.advanced,
                      authQueryParams,
                      authBodyParams
                    }, token)
                    
                    // 显示测试结果
                    const resultText = `测试结果：
状态码: ${testResult.status_code}
成功: ${testResult.success ? '是' : '否'}
响应内容: ${testResult.content?.substring(0, 500)}${testResult.content?.length > 500 ? '...' : ''}`
                    
                    setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                      ...n, 
                      data: { 
                        ...n.data, 
                        lastOutput: resultText 
                      } 
                    } : n))
                  } catch (error) {
                    setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                      ...n, 
                      data: { 
                        ...n.data, 
                        lastOutput: `测试失败: ${(error as Error).message}` 
                      } 
                    } : n))
                  }
                }}
              >
                发送请求
              </button>
              <button 
                id="clearBtn" 
                className="btn btn-secondary"
                onClick={() => {
                  setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                    ...n, 
                    data: { 
                      ...n.data, 
                      lastOutput: '' 
                    } 
                  } : n))
                }}
              >
                清空结果
              </button>
            </div>
            
            {/* 请求配置 */}
            <div className="form-group">
              <label>HTTP方法</label>
              <select value={cfg.method} onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, method: e.target.value } } } : n))}>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
                <option value="PATCH">PATCH</option>
                <option value="HEAD">HEAD</option>
                <option value="OPTIONS">OPTIONS</option>
              </select>
            </div>

            <div className="form-group">
              <label>URL</label>
              <input 
                type="url" 
                value={cfg.url} 
                onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, url: e.target.value } } } : n))} 
                placeholder="https://api.example.com/endpoint" 
              />
            </div>

            <div className="form-group">
              <label>鉴权方式</label>
              <select value={cfg.auth.type} onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, auth: { ...cfg.auth, type: e.target.value as any } } } } : n))}>
                <option value="none">无鉴权</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
                <option value="apikey">API Key</option>
                <option value="oauth2">OAuth 2.0</option>
                <option value="custom">自定义鉴权</option>
              </select>
            </div>
            <p className="field-hint">鉴权值不会随工作流持久化；形如 {'{{runtime_secret}}'} 的运行时变量引用可以保存。</p>

            {/* Bearer Token */}
            {cfg.auth.type === 'bearer' && (
              <div className="auth-fields active">
                <div className="form-group">
                  <label>Token</label>
                  <input 
                    type="password"
                    value={cfg.auth.bearerToken || ''} 
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, auth: { ...cfg.auth, bearerToken: e.target.value } } } } : n))}
                    placeholder="输入Bearer Token" 
                  />
                </div>
              </div>
            )}

            {/* Basic Auth */}
            {cfg.auth.type === 'basic' && (
              <div className="auth-fields active">
                <div className="form-group">
                  <label>用户名</label>
                  <input 
                    type="text" 
                    value={cfg.auth.basicAuth?.username || ''} 
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, auth: { ...cfg.auth, basicAuth: { ...cfg.auth.basicAuth!, username: e.target.value } } } } } : n))}
                    placeholder="用户名" 
                  />
                </div>
                <div className="form-group">
                  <label>密码</label>
                  <input 
                    type="password" 
                    value={cfg.auth.basicAuth?.password || ''} 
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, auth: { ...cfg.auth, basicAuth: { ...cfg.auth.basicAuth!, password: e.target.value } } } } } : n))}
                    placeholder="密码" 
                  />
                </div>
              </div>
            )}

            {/* API Key */}
            {cfg.auth.type === 'apikey' && (
              <div className="auth-fields active">
                <div className="form-group">
                  <label>API Key</label>
                  <input 
                    type="password"
                    value={cfg.auth.apiKey?.value || ''} 
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, auth: { ...cfg.auth, apiKey: { ...cfg.auth.apiKey!, value: e.target.value } } } } } : n))}
                    placeholder="输入API Key" 
                  />
                </div>
                <div className="form-group">
                  <label>Key位置</label>
                  <select 
                    value={cfg.auth.apiKey?.location || 'header'} 
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, auth: { ...cfg.auth, apiKey: { ...cfg.auth.apiKey!, location: e.target.value as any } } } } } : n))}
                  >
                    <option value="header">Header</option>
                    <option value="query">Query Parameter</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Key名称</label>
                  <input 
                    type="text" 
                    value={cfg.auth.apiKey?.key || ''} 
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, auth: { ...cfg.auth, apiKey: { ...cfg.auth.apiKey!, key: e.target.value } } } } } : n))}
                    placeholder="例如: api_key, X-API-Key" 
                  />
                </div>
              </div>
            )}

            {/* OAuth 2.0 */}
            {cfg.auth.type === 'oauth2' && (
              <div className="auth-fields active">
                <div className="form-group">
                  <label>Access Token</label>
                  <input 
                    type="password"
                    value={cfg.auth.oauth2?.accessToken || ''}
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, auth: { ...cfg.auth, oauth2: { ...cfg.auth.oauth2!, accessToken: e.target.value } } } } } : n))}
                    placeholder="输入Access Token" 
                  />
                </div>
              </div>
            )}

            {/* Custom Auth */}
            {cfg.auth.type === 'custom' && (
              <div className="auth-fields active">
                <div className="form-group">
                  <label>自定义Header</label>
                  <div id="customAuthContainer">
                    {cfg.auth.customAuth?.headers?.map((header, index) => (
                      <div key={index} className="custom-auth-row" style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                        <input
                          type="text"
                          className="custom-auth-input"
                          placeholder="Header名称"
                          value={header.key}
                          onChange={(e) => {
                            const newHeaders = [...(cfg.auth.customAuth?.headers || [])]
                            newHeaders[index] = { ...newHeaders[index], key: e.target.value }
                            setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                              ...n, 
                              data: { 
                                ...n.data, 
                                config: { 
                                  ...cfg, 
                                  auth: { 
                                    ...cfg.auth, 
                                    customAuth: { 
                                      ...cfg.auth.customAuth!, 
                                      headers: newHeaders 
                                    } 
                                  } 
                                } 
                              } 
                            } : n))
                          }}
                          style={{ flex: 1, padding: '8px', border: '1px solid #e2e8f0', borderRadius: '4px' }}
                        />
                        <input
                          type="text"
                          className="custom-auth-input"
                          placeholder="Header值"
                          value={header.value}
                          onChange={(e) => {
                            const newHeaders = [...(cfg.auth.customAuth?.headers || [])]
                            newHeaders[index] = { ...newHeaders[index], value: e.target.value }
                            setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                              ...n, 
                              data: { 
                                ...n.data, 
                                config: { 
                                  ...cfg, 
                                  auth: { 
                                    ...cfg.auth, 
                                    customAuth: { 
                                      ...cfg.auth.customAuth!, 
                                      headers: newHeaders 
                                    } 
                                  } 
                                } 
                              } 
                            } : n))
                          }}
                          style={{ flex: 1, padding: '8px', border: '1px solid #e2e8f0', borderRadius: '4px' }}
                        />
                        <button
                          type="button"
                          className="custom-auth-remove"
                          onClick={() => {
                            const newHeaders = (cfg.auth.customAuth?.headers || []).filter((_, i) => i !== index)
                            setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                              ...n, 
                              data: { 
                                ...n.data, 
                                config: { 
                                  ...cfg, 
                                  auth: { 
                                    ...cfg.auth, 
                                    customAuth: { 
                                      ...cfg.auth.customAuth!, 
                                      headers: newHeaders 
                                    } 
                                  } 
                                } 
                              } 
                            } : n))
                          }}
                          style={{ 
                            background: '#fed7d7', 
                            color: '#822727', 
                            border: 'none', 
                            borderRadius: '4px', 
                            padding: '8px 12px', 
                            cursor: 'pointer', 
                            fontSize: '12px' 
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ width: 'auto', padding: '8px 16px', fontSize: '12px' }}
                    onClick={() => {
                      const newHeaders = [...(cfg.auth.customAuth?.headers || []), { key: '', value: '' }]
                      setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                        ...n, 
                        data: { 
                          ...n.data, 
                          config: { 
                            ...cfg, 
                            auth: { 
                              ...cfg.auth, 
                              customAuth: { 
                                ...cfg.auth.customAuth!, 
                                headers: newHeaders 
                              } 
                            } 
                          } 
                        } 
                      } : n))
                    }}
                  >
                    添加Header
                  </button>
                </div>
              </div>
            )}

            <div className="form-group">
              <label>自定义Headers (JSON格式)</label>
              <textarea 
                value={JSON.stringify(cfg.headers, null, 2)} 
                onChange={(e) => {
                  try {
                    const headers = JSON.parse(e.target.value)
                    setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, headers: headers } } } : n))
                  } catch {}
                }}
                placeholder='{"Content-Type": "application/json"}' 
              />
            </div>

            <div className="form-group">
              <label>请求体类型</label>
              <select 
                value={cfg.bodyType} 
                onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, bodyType: e.target.value as any } } } : n))}
              >
                <option value="none">无请求体</option>
                <option value="text">文本</option>
                <option value="json">JSON</option>
              </select>
            </div>

            {cfg.bodyType !== 'none' && (
              <div className="form-group">
                <label>请求体 ({cfg.bodyType === 'json' ? 'JSON格式' : '文本格式'})</label>
                <textarea 
                  value={cfg.bodyType === 'json' ? cfg.bodyJson : cfg.bodyText} 
                  onChange={(e) => {
                    if (cfg.bodyType === 'json') {
                      setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, bodyJson: e.target.value } } } : n))
                    } else if (cfg.bodyType === 'text') {
                      setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, bodyText: e.target.value } } } : n))
                    }
                  }}
                  placeholder={cfg.bodyType === 'json' ? '{"key": "value"}' : '输入文本内容'} 
                />
              </div>
            )}

          </div>
        )
      }
      if (nodeType === 'analysis') {
        const cfg: AnalysisConfig = selected.data?.config || { 
          apiUrl: serverConfig?.providers?.qwen?.defaultUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1', 
          apiKey: '', 
          questionTemplate: '请对以下问题进行数据分析：{{query}}',
          provider: 'qwen',
          model: serverConfig?.providers?.qwen?.defaultModel || 'qwen-plus',
          temperature: 0.2
        }
        return (
          <div className="panel">
            <div className="panel-title">数据分析配置</div>
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
            
            <label>API 提供商：
              <select value={cfg.provider || 'qwen'} 
                onChange={(e) => {
                  const provider = e.target.value as any;
                  const providerConfig = serverConfig?.providers?.[provider];
                  setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                    ...n, 
                    data: { 
                      ...n.data, 
                      config: { 
                        ...(selected.data?.config || {}), 
                        provider,
                        model: providerConfig?.defaultModel || 'qwen-plus',
                        apiUrl: providerConfig?.defaultUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
                      } 
                    } 
                  } : n))
                }}>
                <option value="qwen">通义千问</option>
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
                <option value="local">本地模型</option>
              </select>
            </label>
            
            {cfg.provider === 'openrouter' ? (
              <label>模型：
                <select value={cfg.model || 'x-ai/grok-4-fast:free'} onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...(selected.data?.config || {}), model: e.target.value } } } : n))}>
                  <option value="x-ai/grok-4-fast:free">x-ai/grok-4-fast:free</option>
                  <option value="deepseek/deepseek-chat-v3.1:free">deepseek/deepseek-chat-v3.1:free</option>
                  <option value="tencent/hunyuan-a13b-instruct:free">tencent/hunyuan-a13b-instruct:free</option>
                  <option value="qwen/qwen3-235b-a22b:free">qwen/qwen3-235b-a22b:free</option>
                  <option value="microsoft/mai-ds-r1:free">microsoft/mai-ds-r1:free</option>
                </select>
              </label>
            ) : cfg.provider === 'local' ? (
              <label>模型：
                <input 
                  value={cfg.model || 'local-model'}
                  disabled
                />
              </label>
            ) : (
              <label>模型名称：
                <input value={cfg.model || (cfg.provider === 'openai' ? 'gpt-4o' : 'qwen-plus')}
                  onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...(selected.data?.config || {}), model: e.target.value } } } : n))} 
                  placeholder={cfg.provider === 'openai' ? 'gpt-4o' : 'qwen-plus'} />
              </label>
            )}
            
            <label>温度 (0-1)：
              <input type="number" min="0" max="1" step="0.1" value={cfg.temperature || 0.2}
                onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...(selected.data?.config || {}), temperature: parseFloat(e.target.value) } } } : n))} />
            </label>
            
            <label>API URL：
              <input value={cfg.apiUrl}
                onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...(selected.data?.config || {}), apiUrl: e.target.value } } } : n))} />
            </label>
            
            <label>API Key（{cfg.provider === 'local' ? '不需要' : '需要'}）：
              <input type="password" value={cfg.apiKey || ''}
                onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...(selected.data?.config || {}), apiKey: e.target.value } } } : n))} 
                disabled={cfg.provider === 'local'} />
            </label>
            
            {/* 文件上传功能 */}
            <div style={{ marginBottom: '16px', padding: '12px', border: '1px dashed #d1d5db', borderRadius: '6px' }}>
              <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>数据文件上传</div>
              
              <input 
                type="file" 
                id={`file-upload-${selected.id}`}
                accept=".csv,.xlsx"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  
                  const formData = new FormData();
                  formData.append('file', file);
                  
                  try {
                    const response = await fetch('/api/upload-data', {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${token}` },
                      body: formData
                    });
                    
                    if (!response.ok) {
                      const errorText = await response.text();
                      throw new Error(`文件上传失败: ${errorText}`);
                    }
                    
                    const result = await response.json();
                    
                    // 保存文件数据到节点配置
                    setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                      ...n, 
                      data: { 
                        ...n.data, 
                        config: { 
                          ...(selected.data?.config || {}), 
                          uploadedData: result.data,
                          uploadedHeaders: result.headers,
                          uploadedFilename: result.filename
                        } 
                      } 
                    } : n));
                    
                    alert(`文件上传成功！\n文件名：${result.filename}\n行数：${result.rowCount}\n列数：${result.columnCount}`);
                  } catch (error) {
                    alert(`文件上传失败：${error.message}`);
                  }
                }}
                style={{ display: 'none' }}
              />
              
              <label 
                htmlFor={`file-upload-${selected.id}`}
                style={{ 
                  display: 'inline-block',
                  padding: '8px 16px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                选择文件 (CSV/Excel)
              </label>
              
              {selected.data?.config?.uploadedFilename && (
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#059669' }}>
                  ✓ 已上传：{selected.data.config.uploadedFilename}
                  <button 
                    onClick={() => {
                      setNodes((ns) => ns.map(n => n.id === selected.id ? { 
                        ...n, 
                        data: { 
                          ...n.data, 
                          config: { 
                            ...(selected.data?.config || {}), 
                            uploadedData: undefined,
                            uploadedHeaders: undefined,
                            uploadedFilename: undefined
                          } 
                        } 
                      } : n));
                    }}
                    style={{ 
                      marginLeft: '8px',
                      padding: '2px 6px',
                      backgroundColor: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontSize: '10px'
                    }}
                  >
                    清除
                  </button>
                </div>
              )}
              
              <div style={{ marginTop: '8px', fontSize: '11px', color: '#6b7280' }}>
                支持格式：CSV (.csv)、Excel (.xlsx, .xls)
              </div>
            </div>
            
            <label>问题模板：
              <textarea value={cfg.questionTemplate}
                onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...(selected.data?.config || {}), questionTemplate: e.target.value } } } : n))} />
            </label>
            <div style={{marginTop:8, fontSize:12, color:'#64748b'}}>可用变量：{'{{query}}'}、{'{{kb_text}}'}、{'{{http_text}}'}、{'{{llm_text_节点ID}}'}、{'{{analysis_text_节点ID}}'}</div>
            
            {/* 图表导出功能 */}
            {selected.data?.lastOutput && (
              <div style={{ marginTop: '16px', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>图表导出</div>
                <button 
                  onClick={() => {
                    // 导出分析结果为Markdown文件
                    const content = selected.data.lastOutput;
                    const blob = new Blob([content], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `analysis_${new Date().toISOString().slice(0, 10)}.md`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                  style={{ 
                    padding: '6px 12px',
                    backgroundColor: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    marginRight: '8px'
                  }}
                >
                  导出分析报告 (MD)
                </button>
                
                <button 
                  onClick={() => {
                    // 导出为JSON格式（包含数据和配置）
                    const exportData = {
                      timestamp: new Date().toISOString(),
                      filename: selected.data?.config?.uploadedFilename || 'manual_data',
                      analysis: selected.data.lastOutput,
                      config: selected.data?.config,
                      dataSummary: selected.data?.config?.uploadedData ? {
                        rowCount: selected.data.config.uploadedData.length,
                        columnCount: selected.data.config.uploadedHeaders?.length || 0,
                        headers: selected.data.config.uploadedHeaders,
                        sampleData: selected.data.config.uploadedData.slice(0, 5)
                      } : null
                    };
                    
                    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `analysis_${new Date().toISOString().slice(0, 10)}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                  style={{ 
                    padding: '6px 12px',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  导出完整数据 (JSON)
                </button>
                
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#6b7280' }}>
                  支持导出分析报告和完整数据
                </div>
              </div>
            )}
          </div>
        )
    }
    
    // 如果没有匹配到任何配置，显示默认信息
    return (
      <div className="panel">
        <div className="panel-title">未知节点类型</div>
        <div style={{ 
          backgroundColor: '#f3f4f6', 
          padding: '8px', 
          borderRadius: '4px', 
          marginBottom: '16px',
          fontSize: '12px',
          color: '#6b7280'
        }}>
          <strong>节点 ID:</strong> {selected.id}<br/>
          <strong>节点类型:</strong> {nodeType}<br/>
          <strong>节点标签:</strong> {selected.data?.label}
        </div>
        <p>此节点类型暂不支持配置。</p>
      </div>
    )
  }, [selected, setNodes])
  
  // 返回完整的编辑器界面
  return (
    <div className="app">
      <div className="left">
        <div className="canvas-header">
          <div className="editor-topbar">
            <div className="editor-context">
              <button
                className="editor-back-button"
                onClick={async () => {
                  if (workflowId !== 'new') {
                    try { await handleSave(); } catch (error) { console.error('自动保存失败:', error); }
                  }
                  onBack();
                }}
                aria-label="返回工作流列表"
              >
                ←
              </button>
              <span className="nexus-mark compact" aria-hidden="true"><span /><span /><span /></span>
              <div>
                <div className="editor-workflow-label">WORKFLOW CANVAS</div>
                <div className="editor-workflow-title">{workflowId === 'new' ? '未命名工作流' : `工作流 · ${user?.username || ''}`}</div>
              </div>
            </div>
            <div className="editor-actions">
              {workflowId !== 'new' && (
                <div className={`save-indicator ${saveStatus}`}>
                  <i />
                  {saveStatus === 'saved' && '已保存'}
                  {saveStatus === 'saving' && '保存中'}
                  {saveStatus === 'error' && '保存失败'}
                </div>
              )}
              {!isBackgroundRunning ? (
                <button className="runtime-action" onClick={startBackgroundTask}><i />启动运行</button>
              ) : (
                <button className="runtime-action stop" onClick={stopBackgroundTask}><i />停止运行</button>
              )}
            </div>
          </div>
          
          <div className="editor-toolbar">
            <div className="new-node-container">
              <button className={`new-node-btn ${showNewNodeMenu ? 'open' : ''}`} onClick={() => setShowNewNodeMenu(!showNewNodeMenu)}>
                <span>＋</span> 添加能力 <b>⌄</b>
              </button>
              {showNewNodeMenu && (
                <div className="new-node-menu">
                  <div className="node-menu-label">INTELLIGENCE</div>
                  <button onClick={() => createNewNode('llm')}><i className="node-menu-icon">AI</i><span><strong>模型推理</strong><small>OpenAI-compatible LLM</small></span></button>
                  <button onClick={() => createNewNode('kb')}><i className="node-menu-icon">KB</i><span><strong>知识检索</strong><small>Vector knowledge search</small></span></button>
                  <button onClick={() => createNewNode('cond')}><i className="node-menu-icon">IF</i><span><strong>条件分支</strong><small>Intent routing</small></span></button>
                  <div className="node-menu-label">TOOLS & OUTPUT</div>
                  <button onClick={() => createNewNode('http')}><i className="node-menu-icon">↗</i><span><strong>HTTP 请求</strong><small>External tool call</small></span></button>
                  <button onClick={() => createNewNode('device')}><i className="node-menu-icon">PC</i><span><strong>设备能力</strong><small>Safe local action</small></span></button>
                  <button onClick={() => createNewNode('analysis')}><i className="node-menu-icon">▥</i><span><strong>数据分析</strong><small>Structured analysis</small></span></button>
                  <button onClick={() => createNewNode('reply')}><i className="node-menu-icon">↵</i><span><strong>直接回复</strong><small>Response output</small></span></button>
                  <div className="node-menu-label">TRIGGERS</div>
                  <button onClick={() => createNewNode('query')}><i className="node-menu-icon">◎</i><span><strong>Query 触发器</strong><small>User request</small></span></button>
                  <button onClick={() => createNewNode('loop')}><i className="node-menu-icon">↻</i><span><strong>循环定时器</strong><small>Scheduled loop</small></span></button>
                  <button onClick={() => createNewNode('start_chat')}><i className="node-menu-icon">◇</i><span><strong>聊天开始</strong><small>Foreground session</small></span></button>
                  <button onClick={() => createNewNode('start_background')}><i className="node-menu-icon">◉</i><span><strong>后台开始</strong><small>Background agent</small></span></button>
                </div>
              )}
            </div>
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
            <div className="editor-toolbar-spacer" />
            <span className="canvas-hint"><kbd>⌫</kbd> 删除 · <kbd>拖拽</kbd> 连接节点</span>
          </div>
        </div>
        
        <div className="canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => {
              setSelectedNodeId(n.id)
              setSelectedEdgeId(null)
              // 打开配置面板
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
            defaultEdgeOptions={{ 
              type: 'smoothstep', 
              animated: false, 
              style: { 
                stroke: '#38bdf8',
                strokeWidth: 2 
              }
            }}
            fitView
          >
            <Background gap={22} size={1} color="#26364a" />
            <Controls />
          </ReactFlow>
        </div>
      </div>
      <div className="right">
        <div className="right-header">
          <div className="inspector-heading"><span>INSPECTOR</span><strong>{previewOpen ? '运行预览' : '节点配置'}</strong></div>
          <div className="tabs fixed-tabs" role="tablist">
            <button
              className={previewOpen ? 'tab active' : 'tab'}
              onClick={() => {
                setPreviewOpen(v => !v)
                if (configOpen) setConfigOpen(false)
              }}
            >预览</button>
            <button
              className={configOpen ? 'tab active' : 'tab'}
              onClick={() => {
                setConfigOpen(v => !v)
                if (previewOpen) setPreviewOpen(false)
              }}
            >配置</button>
          </div>
          <button 
            onClick={() => {
              if (chatHistory.length > 0 && confirm('确定要清除所有聊天记录吗？')) {
                clearChatHistory();
              }
            }}
            disabled={chatHistory.length === 0}
            className="clear-history-button"
          >
            清除
          </button>
        </div>
        <div className="inspector-body">
          {previewOpen && chatInterface}
          {configOpen && rightPanel}
        </div>
      </div>
    </div>
  )
}
