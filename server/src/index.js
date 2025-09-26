import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import VectorDB from './vectorDB.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });
// 初始化向量数据库
const vectorDB = new VectorDB();


const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_API_KEY = process.env.QWEN_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!QWEN_API_KEY) console.warn('QWEN_API_KEY not set. Set it in server/.env');
if (!OPENAI_API_KEY) console.warn('OPENAI_API_KEY not set. Set it in server/.env');
if (!OPENROUTER_API_KEY) console.warn('OPENROUTER_API_KEY not set. Set it in server/.env');

async function createEmbedding(input) {
  const res = await fetch(`${QWEN_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-v3',
      input,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Embeddings failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  // OpenAI-compatible response
  return json.data[0].embedding;
}


function chunkText(text, chunkSize = 800, overlap = 100) {
  // 限制文本长度，避免内存问题
  if (text.length > 100000) { // 100KB限制
    text = text.substring(0, 100000) + '...';
  }
  
  // 按段落分段：先按 \n\n 分割，如果没有则按单个 \n 分割
  let paragraphs = text.split('\n\n').filter(p => p.trim().length > 0);
  if (paragraphs.length <= 1) {
    // 如果没有双换行符，尝试按单个换行符分割
    paragraphs = text.split('\n').filter(p => p.trim().length > 0);
  }
  const chunks = [];
  
  for (const paragraph of paragraphs) {
    if (paragraph.length <= chunkSize) {
      // 段落小于等于chunkSize，直接作为一个chunk
      chunks.push(paragraph.trim());
    } else {
      // 段落太长，按滑动窗口分块
      let start = 0;
      while (start < paragraph.length) {
        const end = Math.min(start + chunkSize, paragraph.length);
        chunks.push(paragraph.slice(start, end).trim());
        start = end - overlap;
        if (start < 0) start = 0;
        if (start >= paragraph.length) break;
      }
    }
  }
  
  // 限制chunk数量，避免过多请求
  return chunks.slice(0, 50);
}


// 向量数据库上传端点
app.post('/api/vector/upload', upload.single('file'), async (req, res) => {
  try {
    const { text, filename } = req.body; // optional
    let rawText = (typeof text === 'string') ? text : (text || '');
    let originalFilename = filename || 'unknown.txt';
    
    if (req.file) {
      // 限制文件大小
      if (req.file.size > 500000) { // 500KB限制
        return res.status(400).json({ error: 'File too large. Maximum size is 500KB.' });
      }
      const filePath = path.resolve(req.file.path);
      rawText = fs.readFileSync(filePath, 'utf-8');
      originalFilename = req.file.originalname || filename || 'unknown.txt';
      fs.unlinkSync(filePath);
    }
    
    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ error: 'No text content provided' });
    }
    
    const chunks = chunkText(rawText);
    if (chunks.length === 0) {
      return res.status(400).json({ error: 'No valid text chunks found' });
    }
    
    // 生成文件ID
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    // 插入文件信息
    vectorDB.insertFile({
      id: fileId,
      filename: originalFilename,
      original_text: rawText,
      file_size: rawText.length,
      file_type: path.extname(originalFilename).slice(1) || 'txt',
      chunk_count: chunks.length
    });
    
    const results = [];
    let successCount = 0;
    
    // 处理每个文本块
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const embedding = await createEmbedding(chunk);
        const docId = `${fileId}-chunk-${i}`;
        
        // 插入到向量数据库
        vectorDB.insertDocument({
          id: docId,
          filename: originalFilename,
          original_text: rawText,
          chunk_index: i,
          chunk_text: chunk,
          embedding: embedding,
          file_size: rawText.length,
          file_type: path.extname(originalFilename).slice(1) || 'txt'
        });
        
        
        results.push({ ok: true, chunkId: docId });
        successCount++;
      } catch (error) {
        console.error('Failed to process chunk:', error);
        results.push({ ok: false, error: error.message });
      }
    }
    
    res.json({ 
      ok: true, 
      fileId: fileId,
      filename: originalFilename,
      inserted: successCount, 
      total: chunks.length,
      results: results
    });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message });
  }
});


// 向量数据库搜索端点
app.post('/api/vector/search', async (req, res) => {
  try {
    const { query, topK = 5 } = req.body;
    const qEmbedding = await createEmbedding(query);
    const results = vectorDB.searchSimilar(qEmbedding, topK);
    res.json({ matches: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取所有文件列表
app.get('/api/vector/files', (req, res) => {
  try {
    const files = vectorDB.getAllFiles();
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取所有文档列表
app.get('/api/vector/documents', (req, res) => {
  try {
    const documents = vectorDB.getAllDocuments();
    res.json({ documents });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 根据文件名获取文档
app.get('/api/vector/files/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const documents = vectorDB.getDocumentsByFilename(filename);
    res.json({ documents });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除文件
app.delete('/api/vector/files/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const result = vectorDB.deleteFile(filename);
    res.json({ 
      ok: true, 
      filename,
      docsDeleted: result.docsDeleted,
      fileDeleted: result.fileDeleted 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取数据库统计信息
app.get('/api/vector/stats', (req, res) => {
  try {
    const stats = vectorDB.getStats();
    res.json({ stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model = 'qwen-plus', temperature = 0.7, apiKey, apiUrl, provider = 'qwen' } = req.body;

    // 根据provider确定API配置
    let key, baseUrl, endpoint;
    
    if (provider === 'local') {
      // 本地模型不需要API Key
      key = null;
      baseUrl = apiUrl || 'http://192.168.137.4:8000/v1/chat/completions';
      endpoint = `${baseUrl}`;
    } else {
      // 远程模型需要API Key
      if (provider === 'openai') key = apiKey || OPENAI_API_KEY; 
      else if (provider === 'openrouter') key = apiKey || OPENROUTER_API_KEY; 
      else key = apiKey || QWEN_API_KEY;
      baseUrl = apiUrl || (provider === 'openai' ? 'https://api.openai.com/v1' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : QWEN_BASE_URL);
      endpoint = `${baseUrl}/chat/completions`;
    }

    if (!key && provider !== 'local') {
      throw new Error('API key is required for remote models');
    }

    // 构建请求头
    const headers = {
      'Content-Type': 'application/json',
    };
    
    // 只有非本地模型才需要Authorization头
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    const r = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        model: provider === 'local' ? (model || 'local-model') : model, 
        messages, 
        temperature, 
        stream: false,
        max_tokens: provider === 'local' ? 1000 : undefined // 为本地模型添加max_tokens
      }),
    });
    
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Chat failed: ${r.status} ${text}`);
    }
    
    const json = await r.json();
    res.json(json);
  } catch (e) {
    console.error('Chat API error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/http-request', async (req, res) => {
  try {
    const { method, url, headers = {}, body, variables = {} } = req.body;
    
    // Replace variables in URL
    let formattedUrl = url;
    for (const [key, value] of Object.entries(variables)) {
      formattedUrl = formattedUrl.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    
    // Replace variables in headers
    const formattedHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
      let formattedValue = value;
      for (const [varKey, varValue] of Object.entries(variables)) {
        formattedValue = formattedValue.replace(new RegExp(`{${varKey}}`, 'g'), varValue);
      }
      formattedHeaders[key] = formattedValue;
    }
    
    // Replace variables in body
    let formattedBody = body;
    if (typeof body === 'string') {
      for (const [key, value] of Object.entries(variables)) {
        formattedBody = formattedBody.replace(new RegExp(`{${key}}`, 'g'), value);
      }
    } else if (typeof body === 'object' && body !== null) {
      formattedBody = JSON.parse(JSON.stringify(body).replace(/\{(\w+)\}/g, (match, key) => {
        return variables[key] || match;
      }));
    }

    const fetch = (await import('node-fetch')).default;
    const upperMethod = String(method || 'GET').toUpperCase();

    const options = { method: upperMethod, headers: formattedHeaders };
    if (upperMethod !== 'GET' && upperMethod !== 'HEAD' && formattedBody) {
      options.body = typeof formattedBody === 'object' ? JSON.stringify(formattedBody) : formattedBody;
      if (typeof formattedBody === 'object' && !options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(formattedUrl, options);
    
    const content = await response.text();
    let json = null;
    try {
      json = JSON.parse(content);
    } catch (e) {
      // Not JSON
    }
    
    res.json({
      status_code: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      content,
      json,
      success: response.ok
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 数据分析代理：将问题转发到任意分析服务（示例：将其发送到 LLM 做数据理解）
app.post('/api/analysis', async (req, res) => {
  try {
    const { apiUrl, apiKey, question } = req.body
    if (apiUrl) {
      const headers = { 'Content-Type': 'application/json' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      const r = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify({ question }) })
      const text = await r.text()
      let json = null
      try { json = JSON.parse(text) } catch {}
      return res.json(json || { text })
    }

    const messages = [
      { role: 'system', content: '你是一名严谨的数据分析师。请以 Markdown 输出，结构包含：\n\n**结论**；\n\n**要点**（3-5条）；\n\n**图表数据**（若需要，用表格呈现，包含 X 和 Y 两列）。' },
      { role: 'user', content: `请基于你的数据知识，对以下问题进行数据分析并给出可视化建议：${question}` }
    ]

    async function tryCall(provider) {
      try {
        let baseUrl = provider === 'openai' ? 'https://api.openai.com/v1' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : QWEN_BASE_URL
        let key = provider === 'openai' ? OPENAI_API_KEY : provider === 'openrouter' ? OPENROUTER_API_KEY : QWEN_API_KEY
        if (provider === 'local') { baseUrl = 'http://192.168.137.4:8000/v1'; key = null }
        const endpoint = `${baseUrl}/chat/completions`
        const headers = { 'Content-Type': 'application/json' }
        if (key) headers['Authorization'] = `Bearer ${key}`
        const r = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: provider === 'openai' ? 'gpt-4o' : provider === 'openrouter' ? 'x-ai/grok-4-fast:free' : provider === 'local' ? 'local-model' : 'qwen-plus',
            messages,
            temperature: 0.2
          })
        })
        if (!r.ok) throw new Error(`${provider} failed: ${r.status}`)
        const j = await r.json()
        return j?.choices?.[0]?.message?.content
      } catch { return null }
    }

    const order = ['qwen', 'openrouter', 'openai', 'local']
    for (const p of order) {
      const text = await tryCall(p)
      if (text) return res.json({ text })
    }
    return res.json({ text: `分析任务已接收：${String(question || '')}\n(未能成功调用外部服务，返回示例结果)` })
  } catch (e) {
    try { res.status(500).json({ error: e.message }) } catch {}
  }
})

// Analysis streaming via chat SSE
app.post('/api/analysis-stream', async (req, res) => {
  try {
    const { apiUrl, apiKey, question } = req.body
    if (apiUrl) {
      const headers = { 'Content-Type': 'application/json' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      const upstream = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify({ question, stream: true }) })
      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(()=> '')
        throw new Error(`Upstream failed: ${upstream.status} ${text}`)
      }
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      upstream.body.on('data', chunk => res.write(chunk))
      upstream.body.on('end', () => res.end())
      upstream.body.on('error', () => res.end())
      return
    }

    async function tryStream(provider) {
      try {
        let baseUrl = provider === 'openai' ? 'https://api.openai.com/v1' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : QWEN_BASE_URL
        let key = provider === 'openai' ? OPENAI_API_KEY : provider === 'openrouter' ? OPENROUTER_API_KEY : QWEN_API_KEY
        if (provider === 'local') { baseUrl = 'http://192.168.137.4:8000/v1'; key = null }
        const endpoint = `${baseUrl}/chat/completions`
        const headers = { 'Content-Type': 'application/json' }
        if (key) headers['Authorization'] = `Bearer ${key}`
        const r = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: provider === 'openai' ? 'gpt-4o' : provider === 'openrouter' ? 'x-ai/grok-4-fast:free' : provider === 'local' ? 'local-model' : 'qwen-plus',
            messages: [
              { role: 'system', content: '你是一名严谨的数据分析师。请以 Markdown 输出，结构包含：\\n\\n**结论**；\\n\\n**要点**（3-5条）；\\n\\n**图表数据**（若需要，用表格呈现，包含 X 和 Y 两列）。' },
              { role: 'user', content: `请基于你的数据知识，对以下问题进行数据分析并给出可视化建议：${question}` }
            ],
            temperature: 0.2,
            stream: true
          })
        })
        if (!r.ok || !r.body) throw new Error(`${provider} stream failed`)
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        r.body.on('data', chunk => res.write(chunk))
        r.body.on('end', () => res.end())
        r.body.on('error', () => res.end())
        return true
      } catch { return false }
    }

    const order = ['qwen', 'openrouter', 'openai', 'local']
    for (const p of order) {
      const ok = await tryStream(p)
      if (ok) return
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.write(`data: {"text":"分析任务已接收：${String(question || '')}"}\n\n`)
    res.end()
  } catch (e) {
    try { res.status(500).end(`data: {"error":"${String(e.message || e)}"}\n\n`) } catch {}
  }
})

// Chat streaming (SSE passthrough)
app.post('/api/chat-stream', async (req, res) => {
  try {
    const { messages, model = 'qwen-plus', temperature = 0.7, apiKey, apiUrl, provider = 'qwen' } = req.body;

    let key, baseUrl, endpoint;
    if (provider === 'local') {
      key = null;
      baseUrl = apiUrl || 'http://192.168.137.4:8000/v1/chat/completions';
      endpoint = `${baseUrl}`;
    } else {
      if (provider === 'openai') key = apiKey || OPENAI_API_KEY; 
      else if (provider === 'openrouter') key = apiKey || OPENROUTER_API_KEY; 
      else key = apiKey || QWEN_API_KEY;
      baseUrl = apiUrl || (provider === 'openai' ? 'https://api.openai.com/v1' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : QWEN_BASE_URL);
      endpoint = `${baseUrl}/chat/completions`;
    }
    if (!key && provider !== 'local') {
      throw new Error('API key is required for remote models');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider === 'local' ? (model || 'local-model') : model,
        messages,
        temperature,
        stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      throw new Error(`Upstream failed: ${upstream.status} ${text}`);
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    upstream.body.on('data', chunk => res.write(chunk));
    upstream.body.on('end', () => res.end());
    upstream.body.on('error', () => res.end());
  } catch (e) {
    try {
      res.status(500).end(`data: {"error":"${String(e.message || e)}"}\n\n`);
    } catch {}
  }
});

app.get('/api/health', (_, res) => res.json({ ok: true }));

// 根路径服务主页
app.get('/', (_, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

const PORT = process.env.PORT || 5757;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));


