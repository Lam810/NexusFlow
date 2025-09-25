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

if (!QWEN_API_KEY) {
  console.warn('QWEN_API_KEY not set. Set it in server/.env');
}

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


// 新的向量数据库上传端点
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
      key = apiKey || QWEN_API_KEY;
      baseUrl = apiUrl || (provider === 'openai' ? 'https://api.openai.com/v1' : QWEN_BASE_URL);
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

// 简易数据分析代理：将问题转发到任意分析服务（示例：将其发送到 LLM 做数据理解）
app.post('/api/analysis', async (req, res) => {
  try {
    const { apiUrl, apiKey, question } = req.body
    if (!apiUrl) {
      // 退化为使用 chat 端点做一次简单分析
      if (!QWEN_API_KEY) {
        // 无可用 API，直接返回演示结果，避免外部请求导致连接中断
        return res.json({ text: `分析任务已接收：${String(question || '')}\n(未配置外部分析服务，返回示例结果)` })
      }
      const r = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${QWEN_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'qwen-plus',
          messages: [{ role: 'user', content: `请基于你的数据知识，对以下问题进行数据分析与可视化建议：${question}` }],
          temperature: 0.4
        })
      })
      let j
      try { j = await r.json() } catch { j = null }
      const text = j?.choices?.[0]?.message?.content || `分析完成（状态：${r.status}）`
      return res.json({ text })
    }
    const headers = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    const r = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify({ question }) })
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    res.json(json || { text })
  } catch (e) {
    // 避免连接被重置，确保返回 JSON
    try {
      res.status(500).json({ error: e.message })
    } catch {}
  }
})

// Analysis streaming via chat SSE
app.post('/api/analysis-stream', async (req, res) => {
  try {
    const { apiUrl, apiKey, question } = req.body
    // If user provided a streaming endpoint, just proxy it (must be SSE compatible)
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
    // fallback: stream Qwen chat as analysis
    if (!QWEN_API_KEY) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.write(`data: {"text":"分析任务已接收：${String(question || '')}"}\n\n`)
      return res.end()
    }
    const r = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${QWEN_API_KEY}` },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [{ role: 'user', content: `请基于你的数据知识，对以下问题进行数据分析与可视化建议：${question}` }],
        temperature: 0.3,
        stream: true
      })
    })
    if (!r.ok || !r.body) {
      const text = await r.text().catch(()=> '')
      throw new Error(`Upstream failed: ${r.status} ${text}`)
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    r.body.on('data', chunk => res.write(chunk))
    r.body.on('end', () => res.end())
    r.body.on('error', () => res.end())
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
      key = apiKey || QWEN_API_KEY;
      baseUrl = apiUrl || (provider === 'openai' ? 'https://api.openai.com/v1' : QWEN_BASE_URL);
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


