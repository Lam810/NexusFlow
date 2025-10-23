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
  NodeTypes,
  Controls,
  MiniMap
} from 'reactflow';
import 'reactflow/dist/style.css';
import './styles.css';
// @ts-ignore
import * as echarts from 'echarts';

// 类型定义
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
      clientId: string
      clientSecret: string
      tokenUrl: string
      scope?: string
      grantType: 'client_credentials' | 'authorization_code' | 'password'
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

// 节点组件
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
      {showLeft && <Handle type="target" position={Position.Left} style={{ background: '#10b981', width: '12px', height: '12px', border: '2px solid #fff' }} />}
      {showRight && <Handle type="source" position={Position.Right} style={{ background: '#8b5cf6', width: '12px', height: '12px', border: '2px solid #fff' }} />}
      {/* 强制显示连接点用于调试 */}
      {id === 'start' && <Handle type="source" position={Position.Right} style={{ background: '#8b5cf6', width: '12px', height: '12px', border: '2px solid #fff' }} />}
      {showMultiple && (
        <>
          <Handle type="source" position={Position.Right} id="if" style={{ top: '30%', background: '#10b981' }} />
          <Handle type="source" position={Position.Right} id="else" style={{ top: '70%', background: '#ef4444' }} />
        </>
      )}
    </div>
  )
}

// 将nodeTypes移到组件外部，避免重新创建
const nodeTypes = { card: CardNode }

// 初始节点和边
const initialNodes: Node[] = [
  { id: 'start', type: 'card', position: { x: 50, y: 80 }, data: { label: '开始', icon: '🔵', theme: 'theme-blue', handles: ['right'], config: { } } },
  { id: 'cond', type: 'card', position: { x: 180, y: 60 }, data: { label: '条件分支', icon: '🧩', theme: 'theme-cyan', handles: ['left','multiple'], config: { if: { variable: 'query', operator: 'contains', value: '技术' }, elifs: [], elseEnabled: true } as CondConfig } },
  { id: 'kb', type: 'card', position: { x: 300, y: 30 }, data: { label: '知识检索', icon: '📚', theme: 'theme-green', handles: ['left','right'], config: { topK: 3 } as KbConfig } },
  { id: 'llm', type: 'card', position: { x: 550, y: 30 }, data: { label: 'LLM', icon: '🤖', theme: 'theme-purple', handles: ['left','right'], config: { model: 'qwen-plus', temperature: 0.7, systemPrompt: '你是一个有用的中文助手。回答时要基于提供的知识片段，若无依据要明确说明。', userPrompt: '用户问题：{{query}}\n\n知识片段：\n{{kb_text}}', apiKey: '', apiUrl: '', provider: 'qwen' } as LlmConfig } },
  { id: 'reply', type: 'card', position: { x: 800, y: 30 }, data: { label: '直接回复', icon: '🟠', theme: 'theme-orange', handles: ['left'], config: { mode: 'template', template: '{{llm_text}}' } as AnswerConfig } },
  { id: 'reply-else', type: 'card', position: { x: 300, y: 120 }, data: { label: '直接回复', icon: '🟠', theme: 'theme-orange', handles: ['left'], config: { mode: 'template', template: '这是 ELSE 分支：{{query}}' } as AnswerConfig } },
]

const initialEdges: Edge[] = [
  { id: 'e1', source: 'start', target: 'cond' },
  { id: 'e1b', source: 'cond', sourceHandle: 'if', target: 'kb' },
  { id: 'e2', source: 'kb', target: 'llm' },
  { id: 'e3', source: 'llm', target: 'reply' },
  { id: 'e4', source: 'cond', sourceHandle: 'else', target: 'reply-else' },
]

// API 函数
async function api(path: string, body?: any) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// SSE stream helper
async function sseStream(path: string, body: any, onChunk: (text: string) => void): Promise<void> {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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

// 渲染模板
function renderTemplate(template: string, variables: Record<string, any>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    // 支持带下划线的变量名，如 llm_text_节点ID
    if (path in variables) {
      return String(variables[path] || '')
    }
    
    // 支持点号分隔的嵌套属性，如 user.name
    const keys = path.split('.')
    let value = variables
    for (const key of keys) {
      value = value?.[key]
      if (value === undefined) {
        // 如果变量不存在，保持原样（不渲染为变量）
        return `{{${path}}}`
      }
    }
    return String(value || '')
  })
}

// Markdown 渲染
function renderMarkdownToHtml(md: string): string {
  return md
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

// 动态加载 ECharts
let echartsLoadingPromise: Promise<any> | null = null
function loadEcharts(): Promise<any> {
  if ((window as any).echarts) return Promise.resolve((window as any).echarts)
  if (echartsLoadingPromise) return echartsLoadingPromise
  echartsLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js'
    script.async = true
    script.onload = () => resolve((window as any).echarts)
    script.onerror = (e) => reject(e)
    document.head.appendChild(script)
  })
  return echartsLoadingPromise
}

// 图表组件
function ChartWidget({ headers, rows }: { headers: string[]; rows: Array<Record<string, string>> }) {
  const [type, setType] = React.useState('bar' as any)
  const chartRef = React.useRef(null as any)
  const chartInstanceRef = React.useRef(null as any)

  React.useEffect(() => {
    let disposed = false
    async function render() {
      const echarts = await loadEcharts()
      if (!chartRef.current || disposed) return
      const inst = echarts.init(chartRef.current)
      chartInstanceRef.current = inst
      const xKey = headers[0]
      const yKey = headers[1]
      const x = rows.map(r => r[xKey])
      const y = rows.map(r => Number(String(r[yKey]).replace(/[^\d.-]/g, '')))
      if (type === 'pie') {
        inst.setOption({
          tooltip: { trigger: 'item' },
          legend: { bottom: 0 },
          series: [{
            type: 'pie',
            radius: ['35%', '70%'],
            center: ['50%', '45%'],
            data: x.map((name, i) => ({ name, value: y[i] })),
            itemStyle: { borderColor: '#fff', borderWidth: 2 }
          }],
        })
      } else {
        inst.setOption({
          grid: { left: 30, right: 10, top: 20, bottom: 30 },
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: x },
          yAxis: { type: 'value' },
          series: [{ type: type === 'line' ? 'line' : 'bar', data: y, itemStyle: { color: '#8b5cf6' } }],
        })
      }
      const handle = () => inst.resize()
      window.addEventListener('resize', handle)
      return () => {
        window.removeEventListener('resize', handle)
        inst.dispose()
      }
    }
    const cleanupPromise = render()
    return () => { disposed = true; Promise.resolve(cleanupPromise).catch(() => {}) }
  }, [type, headers, rows])

  const exportChart = (format: 'png' | 'jpg' | 'svg') => {
    if (!chartInstanceRef.current) return
    
    const url = chartInstanceRef.current.getDataURL({
      type: format,
      pixelRatio: 2,
      backgroundColor: '#fff'
    })
    
    const link = document.createElement('a')
    link.download = `chart_${new Date().toISOString().slice(0, 10)}.${format}`
    link.href = url
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="chart-widget">
      <div className="chart-table">
        <table>
          <thead>
            <tr>{headers.map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{headers.map(h => <td key={h}>{r[h]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="chart-toolbar">
        <select value={type} onChange={(e) => setType(e.target.value as any)}>
          <option value="bar">柱状图</option>
          <option value="line">折线图</option>
          <option value="pie">饼图</option>
        </select>
        
        <div style={{ marginLeft: '12px', display: 'flex', gap: '4px' }}>
          <button 
            onClick={() => exportChart('png')}
            style={{ 
              padding: '4px 8px', 
              fontSize: '12px', 
              backgroundColor: '#10b981', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px', 
              cursor: 'pointer' 
            }}
          >
            PNG
          </button>
          <button 
            onClick={() => exportChart('jpg')}
            style={{ 
              padding: '4px 8px', 
              fontSize: '12px', 
              backgroundColor: '#3b82f6', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px', 
              cursor: 'pointer' 
            }}
          >
            JPG
          </button>
          <button 
            onClick={() => exportChart('svg')}
            style={{ 
              padding: '4px 8px', 
              fontSize: '12px', 
              backgroundColor: '#8b5cf6', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px', 
              cursor: 'pointer' 
            }}
          >
            SVG
          </button>
        </div>
      </div>
      <div ref={chartRef} style={{ width: '100%', height: 300, marginTop: 6 }} />
    </div>
  )
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
      {table && <ChartWidget headers={table.headers} rows={table.rows} />}
    </div>
  )
}

// 工作流执行函数
async function runFlow(
  query: string,
  nodes: Node[],
  edges: Edge[],
  serverConfig: any,
  onStatus?: (nodeId: string, status: 'running' | 'done') => void,
  onOutput?: (nodeId: string, output: string) => void,
): Promise<RunContext> {
  const ctx: RunContext = { 
    query, 
    variables: { 
      query,
      kb_text: '',
      http_text: ''
    } 
  }

  // 条件分支执行函数
  function executeConditionalNode(nodeId: string): string | null {
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
    
    if (evalCond(cfg.if)) return 'if'
    for (const elif of cfg.elifs) {
      if (evalCond(elif)) return 'elif'
    }
    return cfg.elseEnabled ? 'else' : null
  }

  // 执行单个节点
  async function executeNode(nodeId: string): Promise<void> {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return

    const nodeType = node.data?.label
    onStatus?.(nodeId, 'running')

    if (nodeType === '开始') {
      // 开始节点不需要执行
    } else if (nodeType === '条件分支') {
      const branch = executeConditionalNode(nodeId)
      ctx.variables.condition = { branch }
      if (onOutput) onOutput(nodeId, `条件分支执行：${branch}`)
    } else if (nodeType === '知识检索') {
      const cfg = (node.data?.config || { topK: 3 }) as KbConfig
      try {
        const matches = await api('/api/vector/search', { query: ctx.query, topK: cfg.topK })
        ctx.variables.kb_text = matches.matches.map((m: any) => m.text).join('\n\n')
        ctx.knowledgeMatches = matches.matches
        if (onOutput) onOutput(nodeId, `${ctx.variables.kb_text}`)
      } catch (error) {
        if (onOutput) onOutput(nodeId, `**知识检索失败**\n\n${(error as Error).message}`)
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
      
      const messages = [
        { role: 'system', content: renderTemplate(cfg.systemPrompt, ctx.variables) },
        { role: 'user', content: renderTemplate(cfg.userPrompt, ctx.variables) }
      ]
      
      let text = ''
      try {
        await sseStream('/api/chat-stream', { 
          messages, 
          model: cfg.model, 
          temperature: cfg.temperature,
          apiKey: cfg.apiKey,
          apiUrl: cfg.apiUrl,
          provider: cfg.provider || 'qwen'
        }, (chunk) => {
          text += chunk
          if (onOutput) onOutput(nodeId, text)
        })
        
        ctx.variables[`llm_text_${nodeId}`] = text
        ctx.llmText = text
      } catch (error) {
        if (onOutput) onOutput(nodeId, `**LLM调用失败**\n\n${(error as Error).message}`)
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
          oauth2: { clientId: '', clientSecret: '', tokenUrl: '', scope: '', grantType: 'client_credentials' },
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
          renderTemplate(cfg.bodyJson, ctx.variables) : 
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
        if (cfg.auth.type === 'oauth2' && cfg.auth.oauth2?.clientId) {
          const token = renderTemplate(cfg.auth.oauth2.clientId, ctx.variables)
          authHeaders['Authorization'] = `Bearer ${token}`
        }
        
        // 将variables数组转换为对象
        const variablesObj = cfg.variables.reduce((acc, v) => ({ ...acc, [v.key]: v.value }), {})
        
        const result = await api('/api/http-request', {
          method: cfg.method,
          url: renderedUrl,
          headers: authHeaders,
          body: renderedBody,
          variables: { ...ctx.variables, ...variablesObj },
          auth: cfg.auth,
          advanced: cfg.advanced,
          authQueryParams,
          authBodyParams
        })
        
        ctx.variables.http_data = result.json || result.content
        ctx.variables.http_text = result.content
        if (onOutput) onOutput(nodeId, `${ctx.variables.http_text}`)
      } catch (error) {
        if (onOutput) onOutput(nodeId, `**HTTP请求失败**\n\n${(error as Error).message}`)
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
          // 使用带文件数据的分析API
          const response = await fetch('/api/analysis-with-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiUrl: cfg.apiUrl,
              apiKey: cfg.apiKey,
              question,
              data: cfg.uploadedData,
              headers: cfg.uploadedHeaders,
              provider: cfg.provider,
              model: cfg.model,
              temperature: cfg.temperature
            })
          })
          
          if (!response.ok) {
            throw new Error('数据分析请求失败')
          }
          
          const result = await response.json()
          const text = result.analysis
          
          if (onOutput) onOutput(nodeId, text)
          ctx.variables[`analysis_text_${nodeId}`] = text
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
          }, (chunk) => {
            text += chunk
            if (onOutput) onOutput(nodeId, text)
          })
          
          ctx.variables[`analysis_text_${nodeId}`] = text
        }
      } catch (error) {
        if (onOutput) onOutput(nodeId, `**数据分析失败**\n\n${(error as Error).message}`)
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
      if (onOutput) onOutput(nodeId, `${ctx.variables.answer}`)
    }

    onStatus?.(nodeId, 'done')
  }

  // 从开始节点开始执行，按照边的连接顺序执行
  const startNode = nodes.find(n => n.id === 'start')
  if (!startNode) return ctx
  
  // 执行开始节点
  await executeNode('start')
  
  // 递归执行节点
  async function executeNodeChain(nodeId: string) {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    
    // 如果是条件分支节点，需要根据条件选择分支
    if (node.data?.label === '条件分支') {
      const branch = executeConditionalNode(nodeId)
      if (branch === 'if') {
        // 执行IF分支
        const ifEdges = edges.filter(e => e.source === nodeId && e.sourceHandle === 'if')
        for (const ifEdge of ifEdges) {
          await executeNode(ifEdge.target)
          await executeNodeChain(ifEdge.target)
        }
      } else if (branch === 'else') {
        // 执行ELSE分支
        const elseEdges = edges.filter(e => e.source === nodeId && e.sourceHandle === 'else')
        for (const elseEdge of elseEdges) {
          await executeNode(elseEdge.target)
          await executeNodeChain(elseEdge.target)
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
  
  // 找到从开始节点出发的边并开始执行
  const startEdges = edges.filter(e => e.source === 'start')
  for (const edge of startEdges) {
    await executeNodeChain(edge.target)
  }
  
  return ctx
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
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [activeTab, setActiveTab] = useState('input');
  const [collapsed, setCollapsed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [showNewNodeMenu, setShowNewNodeMenu] = useState(false);
  const [workflowName, setWorkflowName] = useState('未命名工作流');
  const [serverConfig, setServerConfig] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved' as 'saved' | 'saving' | 'error');

  // 加载服务器配置
  React.useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(config => setServerConfig(config))
      .catch(err => console.error('Failed to load server config:', err))
  }, []);

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

  // 从 nodes 数组和 selectedNodeId 动态获取当前选中的节点
  const selected = useMemo(() => {
    if (!selectedNodeId) return null
    return nodes.find(n => n.id === selectedNodeId) || null
  }, [nodes, selectedNodeId])

  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return null
    return edges.find(e => e.id === selectedEdgeId) || null
  }, [edges, selectedEdgeId])

  // 运行工作流
  const runWorkflow = async () => {
    if (!question.trim()) return
    setLoading(true)
    setAnswer('')
    setChatHistory([])

    try {
      // 添加用户问题到聊天历史
      const newHistory = [...chatHistory, { 
        question, 
        timestamp: Date.now() 
      }]
      setChatHistory(newHistory)
      saveChatHistory(newHistory)

      const ctx = await runFlow(question, nodes, edges, serverConfig, (nodeId, status) => {
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

      const finalAnswer = ctx.variables.answer || '工作流执行完成'
      setAnswer(finalAnswer)
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
      
      const errorMsg = '工作流执行失败: ' + (error as Error).message
      setAnswer(errorMsg)
    } finally {
      setLoading(false)
    }
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
                            return <ChartWidget headers={parsed.headers} rows={parsed.rows} />
                          }
                        }
                        return <div className="chat-text" dangerouslySetInnerHTML={{ __html: ((chat as any).meta?.label ? `<div style=\"font-size:12px;color:#64748b;margin-bottom:4px\"><strong>${(chat as any).meta.label}</strong> 输出</div>` : '') + renderMarkdownToHtml(raw) }} />
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
    </div>
  ), [question, loading, chatHistory])

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
    }
    
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
                  suggestedUrl = serverConfig?.localModelUrl || 'http://192.168.137.37:8000/v1/chat/completions'
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
            oauth2: { clientId: '', clientSecret: '', tokenUrl: '', scope: '', grantType: 'client_credentials' },
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
                    } else if (cfg.auth.type === 'oauth2' && cfg.auth.oauth2?.clientId) {
                      // 直接使用提供的Access Token
                      authHeaders['Authorization'] = `Bearer ${cfg.auth.oauth2.clientId}`
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
                    
                    const testResult = await api('/api/http-request', {
                      method: cfg.method,
                      url: cfg.url,
                      headers: authHeaders,
                      body: cfg.bodyType === 'json' ? cfg.bodyJson : cfg.bodyType === 'text' ? cfg.bodyText : '',
                      variables: variablesObj,
                      auth: cfg.auth,
                      advanced: cfg.advanced,
                      authQueryParams,
                      authBodyParams
                    })
                    
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

            {/* Bearer Token */}
            {cfg.auth.type === 'bearer' && (
              <div className="auth-fields active">
                <div className="form-group">
                  <label>Token</label>
                  <input 
                    type="text" 
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
                    type="text" 
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
                    type="text" 
                    value={cfg.auth.oauth2?.clientId || ''} 
                    onChange={(e) => setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, auth: { ...cfg.auth, oauth2: { ...cfg.auth.oauth2!, clientId: e.target.value } } } } } : n))}
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
              <label>请求体 (JSON格式)</label>
              <textarea 
                value={cfg.bodyType === 'json' ? cfg.bodyJson : cfg.bodyType === 'text' ? cfg.bodyText : ''} 
                onChange={(e) => {
                  if (cfg.bodyType === 'json') {
                    setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, bodyJson: e.target.value } } } : n))
                  } else if (cfg.bodyType === 'text') {
                    setNodes((ns) => ns.map(n => n.id === selected.id ? { ...n, data: { ...n.data, config: { ...cfg, bodyText: e.target.value } } } : n))
                  }
                }}
                placeholder='{"key": "value"}' 
              />
            </div>

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
                accept=".csv,.xlsx,.xls"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  
                  const formData = new FormData();
                  formData.append('file', file);
                  
                  try {
                    const response = await fetch('/api/upload-data', {
                      method: 'POST',
                      body: formData
                    });
                    
                    if (!response.ok) {
                      throw new Error('文件上传失败');
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
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '10px',
            padding: '10px',
            background: '#f8f9fa',
            borderRadius: '6px'
          }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '500', color: '#333' }}>
                欢迎, {user?.username}
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>
                {user?.email}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {workflowId !== 'new' && (
                <div style={{ fontSize: '12px', color: '#666' }}>
                  {saveStatus === 'saved' && '✅ 已保存'}
                  {saveStatus === 'saving' && '⏳ 保存中...'}
                  {saveStatus === 'error' && '❌ 保存失败'}
                </div>
              )}
              <button
                onClick={async () => {
                  // 在返回前自动保存工作流
                  if (workflowId !== 'new') {
                    try {
                      await handleSave();
                    } catch (error) {
                      console.error('自动保存失败:', error);
                      // 即使保存失败也继续返回
                    }
                  }
                  onBack();
                }}
                style={{
                  background: '#ff4757',
                  color: 'white',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                返回
              </button>
            </div>
          </div>
          
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
                <button onClick={() => createNewNode('analysis')}>📊 数据分析</button>
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
          {console.log('Current nodes:', nodes.map(n => ({ id: n.id, type: n.type, data: n.data })))}
          {console.log('NodeTypes:', nodeTypes)}
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
          <button 
            onClick={() => {
              if (chatHistory.length > 0 && confirm('确定要清除所有聊天记录吗？')) {
                setChatHistory([])
                saveChatHistory([])
              }
            }}
            disabled={chatHistory.length === 0}
            style={{ 
              backgroundColor: chatHistory.length === 0 ? '#f3f4f6' : '#8b5cf6',
              color: chatHistory.length === 0 ? '#9ca3af' : 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: chatHistory.length === 0 ? 'not-allowed' : 'pointer',
              marginLeft: 'auto'
            }}
          >
            清除记录
          </button>
        </div>
        <div style={{ padding: '12px', overflowY: 'auto', minHeight: 0 }}>
          {previewOpen && chatInterface}
          {configOpen && rightPanel}
        </div>
      </div>
    </div>
  )
}