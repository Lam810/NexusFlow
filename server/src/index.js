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

// 为了向后兼容，保留内存知识库
const knowledgeBase = [];
const KNOWLEDGEBASE_MAX_ITEMS = 2000; // 防止内存无限增长

function addToKnowledgeBase(record) {
  knowledgeBase.push(record);
  if (knowledgeBase.length > KNOWLEDGEBASE_MAX_ITEMS) {
    // 移除最早的若干条，保持在上限以内
    const overflow = knowledgeBase.length - KNOWLEDGEBASE_MAX_ITEMS;
    knowledgeBase.splice(0, overflow);
  }
}

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

function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
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

app.post('/api/knowledge/upsert', async (req, res) => {
  try {
    const { documents } = req.body; // [{id?, text}]
    const results = [];
    for (const doc of documents) {
      const id = doc.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const embedding = await createEmbedding(doc.text);
      const record = { id, text: doc.text, embedding };
      const idx = knowledgeBase.findIndex((d) => d.id === id);
      if (idx >= 0) knowledgeBase[idx] = record; else addToKnowledgeBase(record);
      results.push({ id });
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
        
        // 同时添加到内存知识库以保持兼容性
        addToKnowledgeBase({ id: docId, text: chunk, embedding });
        
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

// 保持原有的内存知识库上传端点
app.post('/api/knowledge/upload', upload.single('file'), async (req, res) => {
  try {
    const { text } = req.body; // optional
    let rawText = text || '';
    
    if (req.file) {
      // 限制文件大小
      if (req.file.size > 500000) { // 500KB限制
        return res.status(400).json({ error: 'File too large. Maximum size is 500KB.' });
      }
      const filePath = path.resolve(req.file.path);
      rawText = fs.readFileSync(filePath, 'utf-8');
      fs.unlinkSync(filePath);
    }
    
    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ error: 'No text content provided' });
    }
    
    const chunks = chunkText(rawText);
    if (chunks.length === 0) {
      return res.status(400).json({ error: 'No valid text chunks found' });
    }
    
    const results = [];
    let successCount = 0;
    for (const c of chunks) {
      try {
        const embedding = await createEmbedding(c);
        addToKnowledgeBase({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text: c, embedding });
        results.push({ ok: true });
        successCount++;
      } catch (error) {
        console.error('Failed to process chunk:', error);
        results.push({ ok: false, error: error.message });
      }
    }
    
    res.json({ ok: true, inserted: successCount, total: chunks.length });
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

// 保持原有的内存知识库搜索端点
app.post('/api/knowledge/search', async (req, res) => {
  try {
    const { query, topK = 3 } = req.body;
    const qEmbedding = await createEmbedding(query);
    const scored = knowledgeBase.map((d) => ({
      id: d.id,
      text: d.text,
      score: cosineSimilarity(qEmbedding, d.embedding),
    }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    res.json({ matches: scored });
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

app.get('/api/health', (_, res) => res.json({ ok: true }));

// 根路径服务主页
app.get('/', (_, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

const PORT = process.env.PORT || 5757;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));


