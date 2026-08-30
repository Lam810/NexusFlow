import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import csv from 'csv-parser';
import VectorDB from './vectorDB.js';
import FileParser from './fileParser.js';
import EnhancedVectorSearch from './enhancedVectorSearch.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});
// 初始化向量数据库和增强搜索
const vectorDB = new VectorDB();
const fileParser = new FileParser();
const enhancedSearch = new EnhancedVectorSearch(vectorDB);


const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_API_KEY = process.env.QWEN_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LOCAL_MODEL_URL = process.env.LOCAL_MODEL_URL || 'http://localhost:8000/v1/chat/completions';
const JWT_SECRET = process.env.JWT_SECRET || 'replace-with-a-local-development-secret';

// 动态知识库配置
const KNOWLEDGE_API_URL = process.env.KNOWLEDGE_API_URL || 'http://localhost:5000';

// 聊天记录管理API端点
app.post('/api/chat/add-context', async (req, res) => {
  try {
    const { workflowId, question, answer, timestamp } = req.body;
    
    if (!workflowId || !question || !answer) {
      return res.status(400).json({ error: 'workflowId、question和answer不能为空' });
    }
    
    console.log('📝 收到保存请求 - 问题:', question.substring(0, 50), '回答:', answer.substring(0, 50));
    
    // 生成问题的embedding用于后续相似度搜索
    let questionEmbedding = null;
    try {
      questionEmbedding = await createEmbedding(question);
      console.log('✅ 问题embedding生成成功');
    } catch (embError) {
      console.warn('⚠️ 生成问题embedding失败:', embError.message);
    }
    
    const result = vectorDB.saveChatHistory(
      workflowId, 
      question, 
      answer, 
      questionEmbedding, 
      timestamp
    );
    
    console.log('💾 聊天记录已保存到VectorDB:', result.id);
    
    res.json({ 
      success: true, 
      message: '聊天记录保存成功',
      data: result 
    });
  } catch (error) {
    console.error('添加聊天记录失败:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat/search-context', async (req, res) => {
  try {
    const { query, workflowId, topK = 3 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'query不能为空' });
    }
    
    if (!workflowId) {
      return res.status(400).json({ error: 'workflowId不能为空' });
    }
    
    console.log('🔍 收到搜索请求 - 查询:', query, 'workflowId:', workflowId);
    
    // 生成查询的embedding
    const queryEmbedding = await createEmbedding(query);
    console.log('✅ 查询embedding生成成功');
    
    // 搜索相似的聊天历史
    const results = vectorDB.searchChatHistory(queryEmbedding, workflowId, topK);
    
    console.log(`📊 找到 ${results.length} 条相关历史记录`);
    if (results.length > 0) {
      results.forEach((r, i) => {
        console.log(`  [${i + 1}] 相似度: ${r.similarity.toFixed(4)} - 问题: ${r.question.substring(0, 30)}`);
      });
    }
    
    res.json({ 
      success: true,
      results: results,
      count: results.length
    });
  } catch (error) {
    console.error('搜索聊天记录失败:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat/clear-context', async (req, res) => {
  try {
    const { workflowId } = req.body;
    
    if (!workflowId) {
      return res.status(400).json({ error: 'workflowId不能为空' });
    }
    
    console.log('🗑️ 收到清除请求 - workflowId:', workflowId);
    
    const deletedCount = vectorDB.clearChatHistory(workflowId);
    
    console.log(`✅ 已清除 ${deletedCount} 条聊天记录`);
    
    res.json({ 
      success: true,
      message: `已清除${deletedCount}条聊天记录`,
      deletedCount: deletedCount
    });
  } catch (error) {
    console.error('清除聊天记录失败:', error);
    res.status(500).json({ error: error.message });
  }
});

if (!QWEN_API_KEY) console.warn('QWEN_API_KEY not set. Set it in server/.env');
if (!OPENAI_API_KEY) console.warn('OPENAI_API_KEY not set. Set it in server/.env');
if (!OPENROUTER_API_KEY) console.warn('OPENROUTER_API_KEY not set. Set it in server/.env');
console.log(`Local model URL: ${LOCAL_MODEL_URL}`);
console.log(`Knowledge API URL: ${KNOWLEDGE_API_URL}`);

// 认证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '访问令牌缺失' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: '访问令牌无效' });
    }
    req.user = user;
    next();
  });
};

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


// 增强的向量数据库上传端点 - 支持多种文件格式
app.post('/api/vector/upload', upload.single('file'), async (req, res) => {
  try {
    const { text, filename, chunkOptions = {} } = req.body; // optional
    let rawText = (typeof text === 'string') ? text : (text || '');
    let originalFilename = filename || 'unknown.txt';
    let fileMetadata = {};
    
    if (req.file) {
      // 限制文件大小
      if (req.file.size > 50 * 1024 * 1024) { // 50MB限制
        return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
      }
      
      const filePath = path.resolve(req.file.path);
      originalFilename = req.file.originalname || filename || 'unknown.txt';
      
      // 检查文件格式是否支持
      const fileExtension = path.extname(originalFilename).toLowerCase();
      if (!fileParser.supportedFormats.hasOwnProperty(fileExtension)) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ 
          error: `不支持的文件格式: ${fileExtension}`,
          supportedFormats: Object.keys(fileParser.supportedFormats)
        });
      }
      
      try {
        // 使用文件解析器解析文件
        const parseOptions = {
          ...chunkOptions,
          originalFileName: originalFilename
        };
        const parseResult = await fileParser.parseFile(filePath, parseOptions);
        
        if (!parseResult.success) {
          fs.unlinkSync(filePath);
          return res.status(400).json({ 
            error: `文件解析失败: ${parseResult.error}`,
            fileType: fileParser.getFileType(originalFilename),
            supportedFormats: Object.keys(fileParser.supportedFormats)
          });
        }
        
        rawText = parseResult.content;
        fileMetadata = parseResult.metadata;
        
        // 清理临时文件
        fs.unlinkSync(filePath);
      } catch (parseError) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        console.error('文件解析错误:', parseError);
        return res.status(400).json({ 
          error: `文件解析异常: ${parseError.message}`,
          fileType: fileParser.getFileType(originalFilename),
          supportedFormats: Object.keys(fileParser.supportedFormats)
        });
      }
    }
    
    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ error: 'No text content provided' });
    }
    
    // 使用增强的文本分块
    const chunks = fileParser.chunkText(rawText, {
      chunkSize: chunkOptions.chunkSize || 800,
      overlap: chunkOptions.overlap || 100,
      maxChunks: chunkOptions.maxChunks || 50,
      preserveStructure: chunkOptions.preserveStructure !== false
    });
    
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
      file_type: fileParser.getFileType(originalFilename),
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
          file_type: fileParser.getFileType(originalFilename)
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
      fileType: fileParser.getFileType(originalFilename),
      metadata: fileMetadata,
      inserted: successCount, 
      total: chunks.length,
      results: results
    });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message });
  }
});


// 增强的向量数据库搜索端点
app.post('/api/vector/search', async (req, res) => {
  try {
    const { 
      query, 
      topK = 5, 
      searchType = 'vector', // 'vector', 'keyword', 'hybrid'
      options = {} 
    } = req.body;
    
    if (!query || !query.trim()) {
      return res.status(400).json({ error: '查询内容不能为空' });
    }
    
    const qEmbedding = await createEmbedding(query);
    let results = [];
    let suggestions = [];
    
    try {
      switch (searchType) {
        case 'keyword':
          results = enhancedSearch.keywordSearch(query, topK);
          break;
        case 'hybrid':
          results = await enhancedSearch.hybridSearch(query, qEmbedding, {
            topK,
            ...options
          });
          break;
        case 'vector':
        default:
          results = await enhancedSearch.searchSimilar(qEmbedding, {
            topK,
            threshold: options.threshold || 0.3,
            rerank: options.rerank !== false,
            expandQuery: options.expandQuery || false,
            ...options
          });
          break;
      }
      
      // 生成搜索建议
      suggestions = await enhancedSearch.suggestCorrections(query, results);
      
      // 记录搜索历史
      enhancedSearch.recordSearch(query, results);
      
    } catch (searchError) {
      console.error('搜索错误:', searchError);
      return res.status(500).json({ error: '搜索失败: ' + searchError.message });
    }
    
    res.json({ 
      matches: results,
      suggestions: suggestions,
      searchType: searchType,
      query: query,
      totalResults: results.length
    });
  } catch (e) {
    console.error('搜索端点错误:', e);
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
    const searchStats = enhancedSearch.getSearchStats();
    res.json({ 
      stats,
      searchStats,
      supportedFormats: Object.keys(fileParser.supportedFormats)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取支持的文件格式
app.get('/api/vector/formats', (req, res) => {
  try {
    res.json({ 
      supportedFormats: Object.keys(fileParser.supportedFormats),
      formatDetails: {
        '.txt': '纯文本文件',
        '.md': 'Markdown文档',
        '.docx': 'Microsoft Word文档',
        '.doc': 'Microsoft Word文档(旧版)',
        '.pdf': 'PDF文档',
        '.xlsx': 'Microsoft Excel表格',
        '.xls': 'Microsoft Excel表格(旧版)',
        '.csv': 'CSV数据文件',
        '.json': 'JSON数据文件',
        '.xml': 'XML文档',
        '.html': 'HTML网页',
        '.htm': 'HTML网页'
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取搜索历史和建议
app.get('/api/vector/search-history', (req, res) => {
  try {
    const searchStats = enhancedSearch.getSearchStats();
    res.json(searchStats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 文件解析测试端点
app.post('/api/vector/parse-test', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    
    const filePath = path.resolve(req.file.path);
    const originalName = req.file.originalname;
    
    try {
      const parseResult = await fileParser.parseFile(filePath);
      
      // 清理临时文件
      fs.unlinkSync(filePath);
      
      res.json({
        success: true,
        filename: originalName,
        fileType: fileParser.getFileType(originalName),
        content: parseResult.content.substring(0, 1000) + (parseResult.content.length > 1000 ? '...' : ''),
        metadata: parseResult.metadata,
        contentLength: parseResult.content.length
      });
    } catch (parseError) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw parseError;
    }
  } catch (e) {
    console.error('文件解析测试错误:', e);
    res.status(500).json({ error: e.message });
  }
});


app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model = 'qwen-plus', temperature = 0.7, apiKey, apiUrl, provider = 'qwen', useKnowledgeBase = false } = req.body;

    // 根据provider确定API配置
    let key, baseUrl, endpoint;
    
    if (provider === 'local') {
      // 本地模型不需要API Key
      key = null;
      baseUrl = apiUrl || LOCAL_MODEL_URL;
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

    // 如果启用知识库，先搜索相关知识
    let knowledgeContext = '';
    if (useKnowledgeBase && messages.length > 0) {
      try {
        const lastMessage = messages[messages.length - 1];
        const userQuery = typeof lastMessage === 'string' ? lastMessage : lastMessage.content;
        
        // 从知识库搜索相关内容
        const kbResponse = await fetch(`${KNOWLEDGE_API_URL}/api/knowledge-base/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: userQuery, top_k: 3 })
        });
        
        if (kbResponse.ok) {
          const kbData = await kbResponse.json();
          if (kbData.success && kbData.results && kbData.results.length > 0) {
            const contextParts = kbData.results.map((r, i) => `[知识${i + 1}] ${r.title}\n${r.content}`).join('\n\n');
            knowledgeContext = `\n\n以下是来自知识库的相关信息，请基于这些信息回答用户问题：\n\n${contextParts}\n\n`;
          }
        }
      } catch (kbError) {
        console.warn('知识库搜索失败，继续使用基础对话:', kbError.message);
      }
    }

    // 搜索聊天上下文（如果提供了workflowId）
    let chatContext = '';
    const workflowId = req.body.workflowId;
    if (workflowId && messages.length > 0) {
      try {
        const lastMessage = messages[messages.length - 1];
        const userQuery = typeof lastMessage === 'string' ? lastMessage : lastMessage.content;
        
        // 从聊天记录搜索相关内容
        const chatResponse = await fetch(`${KNOWLEDGE_API_URL}/api/knowledge-base/chat/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query: userQuery, 
            workflow_id: workflowId,
            top_k: 3 
          })
        });
        
        if (chatResponse.ok) {
          const chatData = await chatResponse.json();
          if (chatData.success && chatData.results && chatData.results.length > 0) {
            const contextParts = chatData.results.map((r, i) => 
              `[历史对话${i + 1}] 问题: ${r.question}\n回答: ${r.answer}`
            ).join('\n\n');
            chatContext = `\n\n以下是相关的历史对话记录，请参考这些上下文来回答用户问题：\n\n${contextParts}\n\n`;
          }
        }
      } catch (chatError) {
        console.warn('聊天上下文搜索失败，继续使用基础对话:', chatError.message);
      }
    }

    // 构建请求头
    const headers = {
      'Content-Type': 'application/json',
    };
    
    // 只有非本地模型才需要Authorization头
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    // 如果有知识库上下文，添加到最后一个用户消息
    let finalMessages = messages;
    if (knowledgeContext && messages.length > 0) {
      finalMessages = [...messages];
      const lastMsg = finalMessages[finalMessages.length - 1];
      const updatedContent = knowledgeContext + (typeof lastMsg === 'string' ? lastMsg : lastMsg.content);
      
      if (typeof lastMsg === 'string') {
        finalMessages[finalMessages.length - 1] = updatedContent;
      } else {
        finalMessages[finalMessages.length - 1] = { ...lastMsg, content: updatedContent };
      }
    }

    // 如果有聊天上下文，也添加到最后一个用户消息
    if (chatContext && finalMessages.length > 0) {
      const lastMsg = finalMessages[finalMessages.length - 1];
      const updatedContent = chatContext + (typeof lastMsg === 'string' ? lastMsg : lastMsg.content);
      
      if (typeof lastMsg === 'string') {
        finalMessages[finalMessages.length - 1] = updatedContent;
      } else {
        finalMessages[finalMessages.length - 1] = { ...lastMsg, content: updatedContent };
      }
    }

    const r = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        model: provider === 'local' ? (model || 'local-model') : model, 
        messages: finalMessages, 
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
    const { 
      method, 
      url, 
      headers = {}, 
      body, 
      variables = {}, 
      auth = { type: 'none' },
      advanced = { timeout: 30000, retries: 0, followRedirects: true, validateSSL: true },
      authQueryParams = [],
      authBodyParams = []
    } = req.body;
    
    // Replace variables in URL
    let formattedUrl = url;
    for (const [key, value] of Object.entries(variables)) {
      formattedUrl = formattedUrl.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    
    // Add auth query parameters to URL
    if (authQueryParams.length > 0) {
      const urlObj = new URL(formattedUrl);
      authQueryParams.forEach(param => {
        urlObj.searchParams.append(param.key, param.value);
      });
      formattedUrl = urlObj.toString();
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
    
    // Add custom User-Agent if specified
    if (advanced.customUserAgent) {
      formattedHeaders['User-Agent'] = advanced.customUserAgent;
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
    
    // Add auth body parameters
    if (authBodyParams.length > 0) {
      if (typeof formattedBody === 'string') {
        try {
          const bodyObj = JSON.parse(formattedBody);
          authBodyParams.forEach(param => {
            bodyObj[param.key] = param.value;
          });
          formattedBody = JSON.stringify(bodyObj);
        } catch (e) {
          // If body is not JSON, append as form data
          const formData = new URLSearchParams();
          authBodyParams.forEach(param => {
            formData.append(param.key, param.value);
          });
          formattedBody = formData.toString();
          formattedHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        }
      } else if (typeof formattedBody === 'object') {
        authBodyParams.forEach(param => {
          formattedBody[param.key] = param.value;
        });
      }
    }

    const fetch = (await import('node-fetch')).default;
    const upperMethod = String(method || 'GET').toUpperCase();

    const options = { 
      method: upperMethod, 
      headers: formattedHeaders,
      timeout: advanced.timeout || 30000
    };
    
    // Handle redirects
    if (advanced.followRedirects !== false) {
      options.redirect = 'follow';
    } else {
      options.redirect = 'manual';
    }
    
    // Handle SSL validation
    if (advanced.validateSSL === false) {
      // Note: In production, you might want to use a proper SSL configuration
      // This is a simplified approach for development/testing
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
    
    if (upperMethod !== 'GET' && upperMethod !== 'HEAD' && formattedBody) {
      options.body = typeof formattedBody === 'object' ? JSON.stringify(formattedBody) : formattedBody;
      if (typeof formattedBody === 'object' && !options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
      }
    }

    // Retry logic
    let lastError;
    for (let attempt = 0; attempt <= (advanced.retries || 0); attempt++) {
      try {
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
          success: response.ok,
          attempt: attempt + 1
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < (advanced.retries || 0)) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    
    throw lastError;
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// OAuth2 token endpoint
app.post('/api/oauth2/token', async (req, res) => {
  try {
    const { clientId, clientSecret, tokenUrl, scope, grantType = 'client_credentials' } = req.body;
    
    if (!clientId || !clientSecret || !tokenUrl) {
      return res.status(400).json({ error: 'Missing required OAuth2 parameters' });
    }
    
    const fetch = (await import('node-fetch')).default;
    
    // Prepare token request body
    const tokenBody = new URLSearchParams();
    tokenBody.append('grant_type', grantType);
    tokenBody.append('client_id', clientId);
    tokenBody.append('client_secret', clientSecret);
    
    if (scope) {
      tokenBody.append('scope', scope);
    }
    
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: tokenBody.toString()
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OAuth2 token request failed: ${response.status} ${errorText}`);
    }
    
    const tokenData = await response.json();
    res.json(tokenData);
  } catch (e) {
    console.error('OAuth2 token error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 数据分析代理：将问题转发到任意分析服务（示例：将其发送到 LLM 做数据理解）
app.post('/api/analysis', async (req, res) => {
  try {
    const { apiUrl, apiKey, question, provider = 'qwen', model = 'qwen-plus', temperature = 0.2 } = req.body

    const messages = [
      { role: 'user', content: `${question}` }
    ]

    // 根据provider确定API配置
    let key, baseUrl, endpoint;
    
    if (provider === 'local') {
      // 本地模型不需要API Key
      key = null;
      baseUrl = apiUrl || LOCAL_MODEL_URL;
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

    // 搜索聊天上下文（如果提供了workflowId）
    let chatContext = '';
    if (workflowId && messages.length > 0) {
      try {
        const lastMessage = messages[messages.length - 1];
        const userQuery = typeof lastMessage === 'string' ? lastMessage : lastMessage.content;
        
        // 从聊天记录搜索相关内容
        const chatResponse = await fetch(`${KNOWLEDGE_API_URL}/api/knowledge-base/chat/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query: userQuery, 
            workflow_id: workflowId,
            top_k: 3 
          })
        });
        
        if (chatResponse.ok) {
          const chatData = await chatResponse.json();
          if (chatData.success && chatData.results && chatData.results.length > 0) {
            const contextParts = chatData.results.map((r, i) => 
              `[历史对话${i + 1}] 问题: ${r.question}\n回答: ${r.answer}`
            ).join('\n\n');
            chatContext = `\n\n以下是相关的历史对话记录，请参考这些上下文来回答用户问题：\n\n${contextParts}\n\n`;
          }
        }
      } catch (chatError) {
        console.warn('聊天上下文搜索失败，继续使用基础对话:', chatError.message);
      }
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
        temperature: temperature || 0.2, 
        stream: false,
        max_tokens: provider === 'local' ? 1000 : undefined // 为本地模型添加max_tokens
      }),
    });
    
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Analysis failed: ${r.status} ${text}`);
    }
    
    const json = await r.json();
    res.json({ text: json?.choices?.[0]?.message?.content || '分析完成' });
  } catch (e) {
    console.error('Analysis API error:', e);
    res.status(500).json({ error: e.message });
  }
})

// Analysis streaming via chat SSE
app.post('/api/analysis-stream', async (req, res) => {
  try {
    const { apiUrl, apiKey, question, provider = 'qwen', model = 'qwen-plus', temperature = 0.2 } = req.body;

    const messages = [
      { role: 'user', content: `${question}` }
    ];

    let key, baseUrl, endpoint;
    if (provider === 'local') {
      key = null;
      baseUrl = apiUrl || LOCAL_MODEL_URL;
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
        temperature: temperature || 0.2,
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

// 文件上传API - 支持Excel和CSV文件解析
app.post('/api/upload-data', upload.single('file'), async (req, res) => {
  console.log('📁 收到文件上传请求:', req.file);
  try {
    if (!req.file) {
      console.log('❌ 没有上传文件');
      return res.status(400).json({ error: '没有上传文件' });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const fileExtension = path.extname(originalName).toLowerCase();
    console.log('📄 文件信息:', { filePath, originalName, fileExtension });
    
    let data = [];
    let headers = [];

    try {
      if (fileExtension === '.csv') {
        // 解析CSV文件
        const results = [];
        await new Promise((resolve, reject) => {
          fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => results.push(row))
            .on('end', () => resolve())
            .on('error', reject);
        });
        
        if (results.length > 0) {
          headers = Object.keys(results[0]);
          data = results.map(row => headers.map(header => row[header] || ''));
        }
      } else if (fileExtension === '.xlsx' || fileExtension === '.xls') {
        // 解析Excel文件
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // 转换为JSON数组
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (jsonData.length > 0) {
          headers = jsonData[0];
          data = jsonData.slice(1);
        }
      } else {
        return res.status(400).json({ error: '不支持的文件格式，请上传CSV或Excel文件' });
      }

      // 清理临时文件
      fs.unlinkSync(filePath);

      res.json({
        success: true,
        filename: originalName,
        headers,
        data,
        rowCount: data.length,
        columnCount: headers.length
      });

    } catch (parseError) {
      // 清理临时文件
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw parseError;
    }

  } catch (error) {
    console.error('文件上传错误:', error);
    res.status(500).json({ error: `文件解析失败: ${error.message}` });
  }
});

// 数据分析与文件数据API - 结合上传的数据进行分析
app.post('/api/analysis-with-data', async (req, res) => {
  try {
    const { 
      apiUrl, 
      apiKey, 
      question, 
      data, 
      headers,
      provider = 'qwen', 
      model = 'qwen-plus', 
      temperature = 0.2 
    } = req.body;

    // 构建包含数据的分析提示
    const dataSummary = `
数据概览：
- 行数：${data.length}
- 列数：${headers.length}
- 列名：${headers.join(', ')}

完整数据：
${JSON.stringify(data, null, 2)}
`;

    const messages = [
      { 
        role: 'user', 
        content: `${question}\n\n${dataSummary}` 
      }
    ];

    // 根据provider确定API配置
    let key, baseUrl, endpoint;
    
    if (provider === 'local') {
      key = null;
      baseUrl = apiUrl || LOCAL_MODEL_URL;
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

    const headers_req = {
      'Content-Type': 'application/json',
    };
    
    if (key) {
      headers_req['Authorization'] = `Bearer ${key}`;
    }

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: headers_req,
      body: JSON.stringify({
        model: provider === 'local' ? (model || 'local-model') : model,
        messages,
        temperature: temperature || 0.2,
        stream: true,
      }),
    });

    if (!r.ok || !r.body) {
      const text = await r.text().catch(() => '');
      throw new Error(`API请求失败: ${r.status} ${text}`);
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    r.body.on('data', chunk => res.write(chunk));
    r.body.on('end', () => res.end());
    r.body.on('error', () => res.end());

  } catch (error) {
    console.error('数据分析错误:', error);
    res.status(500).json({ error: `数据分析失败: ${error.message}` });
  }
});

// Chat streaming (SSE passthrough)
app.post('/api/chat-stream', async (req, res) => {
  try {
    const { messages, model = 'qwen-plus', temperature = 0.7, apiKey, apiUrl, provider = 'qwen', workflowId } = req.body;

    let key, baseUrl, endpoint;
    if (provider === 'local') {
      key = null;
      baseUrl = apiUrl || LOCAL_MODEL_URL;
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

    // 搜索聊天上下文（如果提供了workflowId）
    let chatContext = '';
    if (workflowId && messages.length > 0) {
      try {
        const lastMessage = messages[messages.length - 1];
        const userQuery = typeof lastMessage === 'string' ? lastMessage : lastMessage.content;
        
        // 从聊天记录搜索相关内容
        const chatResponse = await fetch(`${KNOWLEDGE_API_URL}/api/knowledge-base/chat/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query: userQuery, 
            workflow_id: workflowId,
            top_k: 3 
          })
        });
        
        if (chatResponse.ok) {
          const chatData = await chatResponse.json();
          if (chatData.success && chatData.results && chatData.results.length > 0) {
            const contextParts = chatData.results.map((r, i) => 
              `[历史对话${i + 1}] 问题: ${r.question}\n回答: ${r.answer}`
            ).join('\n\n');
            chatContext = `\n\n以下是相关的历史对话记录，请参考这些上下文来回答用户问题：\n\n${contextParts}\n\n`;
          }
        }
      } catch (chatError) {
        console.warn('聊天上下文搜索失败，继续使用基础对话:', chatError.message);
      }
    }

    // 如果有聊天上下文，添加到最后一个用户消息
    let finalMessages = messages;
    if (chatContext && messages.length > 0) {
      finalMessages = [...messages];
      const lastMsg = finalMessages[finalMessages.length - 1];
      const updatedContent = chatContext + (typeof lastMsg === 'string' ? lastMsg : lastMsg.content);
      
      if (typeof lastMsg === 'string') {
        finalMessages[finalMessages.length - 1] = updatedContent;
      } else {
        finalMessages[finalMessages.length - 1] = { ...lastMsg, content: updatedContent };
      }
    }

    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider === 'local' ? (model || 'local-model') : model,
        messages: finalMessages,
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

// 认证相关API
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: '用户名、邮箱和密码都是必需的' });
    }

    // 检查用户是否已存在
    const existingUser = await vectorDB.getUserByUsername(username) || await vectorDB.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: '用户名或邮箱已存在' });
    }

    // 加密密码
    const passwordHash = await bcrypt.hash(password, 10);
    
    // 创建用户
    const user = await vectorDB.createUser(username, email, passwordHash);
    
    // 生成JWT令牌
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ 
      message: '注册成功', 
      token, 
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ error: error.message || '注册失败' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码都是必需的' });
    }

    // 查找用户
    const user = await vectorDB.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 生成JWT令牌
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ 
      message: '登录成功', 
      token, 
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ error: '登录失败' });
  }
});

// 工作流管理API
app.get('/api/workflows', authenticateToken, async (req, res) => {
  try {
    const workflows = await vectorDB.getWorkflows(req.user.id);
    res.json({ workflows });
  } catch (error) {
    console.error('获取工作流错误:', error);
    res.status(500).json({ error: '获取工作流失败' });
  }
});

app.post('/api/workflows', authenticateToken, async (req, res) => {
  try {
    const { name, nodes, edges } = req.body;
    const workflowId = `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const workflow = await vectorDB.saveWorkflow(req.user.id, workflowId, name, nodes, edges);
    res.json({ message: '工作流保存成功', workflow });
  } catch (error) {
    console.error('保存工作流错误:', error);
    res.status(500).json({ error: '保存工作流失败' });
  }
});

app.put('/api/workflows/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, nodes, edges } = req.body;
    
    const workflow = await vectorDB.saveWorkflow(req.user.id, id, name, nodes, edges);
    res.json({ message: '工作流更新成功', workflow });
  } catch (error) {
    console.error('更新工作流错误:', error);
    res.status(500).json({ error: '更新工作流失败' });
  }
});

app.get('/api/workflows/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const workflow = await vectorDB.getWorkflow(req.user.id, id);
    
    if (!workflow) {
      return res.status(404).json({ error: '工作流不存在' });
    }
    
    res.json({ workflow });
  } catch (error) {
    console.error('获取工作流错误:', error);
    res.status(500).json({ error: '获取工作流失败' });
  }
});

app.delete('/api/workflows/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const success = await vectorDB.deleteWorkflow(req.user.id, id);
    
    if (!success) {
      return res.status(404).json({ error: '工作流不存在' });
    }
    
    res.json({ message: '工作流删除成功' });
  } catch (error) {
    console.error('删除工作流错误:', error);
    res.status(500).json({ error: '删除工作流失败' });
  }
});

app.get('/api/health', (_, res) => res.json({ ok: true }));

// 语义匹配条件分支API
app.post('/api/semantic-match', async (req, res) => {
  try {
    const { 
      query, 
      conditions, 
      provider = 'qwen', 
      model = 'qwen-plus',
      temperature = 0.1,
      apiKey,
      apiUrl
    } = req.body;
    
    if (!query || !conditions || !Array.isArray(conditions)) {
      return res.status(400).json({ error: '缺少必要参数：query 和 conditions' });
    }
    
    // 构建语义匹配提示词
    const conditionsText = conditions.map((cond, index) => 
      `${index + 1}. ${cond.description || cond.value}`
    ).join('\n');
    
    const prompt = `你是一个智能条件匹配助手。请根据用户查询的语义意图，从以下条件中选择最匹配的一个：

用户查询：${query}

可选条件：
${conditionsText}

请只返回匹配条件的编号（1、2、3等），如果没有匹配的条件则返回0。不要返回任何其他文字。`;

    // 根据provider确定API配置
    let key, baseUrl, endpoint;
    
    if (provider === 'local') {
      key = null;
      baseUrl = apiUrl || LOCAL_MODEL_URL;
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

    const headers = {
      'Content-Type': 'application/json',
    };
    
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider === 'local' ? (model || 'local-model') : model,
        messages: [{ role: 'user', content: prompt }],
        temperature: temperature || 0.1,
        max_tokens: 10, // 限制输出长度
        stream: false
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`语义匹配请求失败: ${response.status} ${text}`);
    }

    const result = await response.json();
    const responseText = result.choices?.[0]?.message?.content?.trim() || '0';
    
    // 解析返回的编号
    const matchIndex = parseInt(responseText);
    const matchedCondition = matchIndex > 0 && matchIndex <= conditions.length 
      ? conditions[matchIndex - 1] 
      : null;
    
    res.json({
      success: true,
      matchedIndex: matchIndex,
      matchedCondition: matchedCondition,
      rawResponse: responseText,
      confidence: matchedCondition ? 'high' : 'low'
    });

  } catch (error) {
    console.error('语义匹配错误:', error);
    res.status(500).json({ error: `语义匹配失败: ${error.message}` });
  }
});

// ==================== 动态知识库 API (使用本地 VectorDB) ====================

// 添加知识到动态知识库
app.post('/api/knowledge/add', async (req, res) => {
  try {
    const { title, content, metadata } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ error: 'title和content不能为空' });
    }
    
    console.log('📝 添加动态数据 - 标题:', title.substring(0, 30));
    
    // 生成内容的embedding
    let embedding = null;
    try {
      embedding = await createEmbedding(content);
      console.log('✅ 内容embedding生成成功');
    } catch (embError) {
      console.warn('⚠️ 生成内容embedding失败:', embError.message);
    }
    
    const result = vectorDB.addDynamicData(title, content, embedding, metadata);
    
    console.log('💾 动态数据已保存到VectorDB:', result.id);
    
    res.json({ 
      success: true,
      message: '知识添加成功',
      data: result 
    });
  } catch (error) {
    console.error('添加知识失败:', error);
    res.status(500).json({ error: `添加知识失败: ${error.message}` });
  }
});

// 批量添加知识到动态知识库
app.post('/api/knowledge/batch-add', async (req, res) => {
  try {
    const { items } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items必须是非空数组' });
    }
    
    console.log(`📝 批量添加动态数据 - 数量: ${items.length}`);
    
    const results = [];
    const errors = [];
    
    for (const item of items) {
      try {
        if (!item.title || !item.content) {
          errors.push({ item, error: 'title和content不能为空' });
          continue;
        }
        
        // 生成embedding
        let embedding = null;
        try {
          embedding = await createEmbedding(item.content);
        } catch (embError) {
          console.warn(`⚠️ 生成embedding失败 (${item.title}):`, embError.message);
        }
        
        const result = vectorDB.addDynamicData(
          item.title,
          item.content,
          embedding,
          item.metadata
        );
        results.push(result);
      } catch (error) {
        errors.push({ item, error: error.message });
      }
    }
    
    console.log(`✅ 批量添加完成 - 成功: ${results.length}, 失败: ${errors.length}`);
    
    res.json({ 
      success: true,
      message: `成功添加${results.length}条，失败${errors.length}条`,
      added: results.length,
      failed: errors.length,
      results: results,
      errors: errors
    });
  } catch (error) {
    console.error('批量添加知识失败:', error);
    res.status(500).json({ error: `批量添加知识失败: ${error.message}` });
  }
});

// 在知识库中搜索
app.post('/api/knowledge/search', async (req, res) => {
  try {
    const { query, top_k = 3, threshold = 0.3 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'query不能为空' });
    }
    
    console.log('🔍 搜索动态知识 - 查询:', query);
    
    // 生成查询embedding
    const queryEmbedding = await createEmbedding(query);
    console.log('✅ 查询embedding生成成功');
    
    // 搜索动态数据
    const results = vectorDB.searchDynamicData(queryEmbedding, top_k, threshold);
    
    console.log(`📊 找到 ${results.length} 条相关知识`);
    if (results.length > 0) {
      results.forEach((r, i) => {
        console.log(`  [${i + 1}] 相似度: ${r.similarity.toFixed(4)} - 标题: ${r.title.substring(0, 30)}`);
      });
    }
    
    res.json({ 
      success: true,
      results: results,
      count: results.length
    });
  } catch (error) {
    console.error('搜索知识失败:', error);
    res.status(500).json({ error: `搜索知识失败: ${error.message}` });
  }
});

// 获取知识库统计信息
app.get('/api/knowledge/stats', async (req, res) => {
  try {
    const stats = vectorDB.getDynamicDataStats();
    
    res.json({ 
      success: true,
      stats: stats
    });
  } catch (error) {
    console.error('获取知识库统计失败:', error);
    res.status(500).json({ error: `获取知识库统计失败: ${error.message}` });
  }
});

// 获取所有动态数据
app.get('/api/knowledge/list', async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const data = vectorDB.getAllDynamicData(parseInt(limit));
    
    res.json({ 
      success: true,
      data: data,
      count: data.length
    });
  } catch (error) {
    console.error('获取动态数据列表失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除动态数据
app.delete('/api/knowledge/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const success = vectorDB.deleteDynamicData(id);
    
    if (success) {
      res.json({ 
        success: true,
        message: '删除成功'
      });
    } else {
      res.status(404).json({ error: '数据不存在' });
    }
  } catch (error) {
    console.error('删除动态数据失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 清空所有动态数据
app.post('/api/knowledge/clear', async (req, res) => {
  try {
    const deletedCount = vectorDB.clearAllDynamicData();
    
    console.log(`🗑️ 已清空 ${deletedCount} 条动态数据`);
    
    res.json({ 
      success: true,
      message: `已清空${deletedCount}条动态数据`,
      deletedCount: deletedCount
    });
  } catch (error) {
    console.error('清空动态数据失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== 动态知识库 API 结束 ====================

// 获取服务器配置信息
app.get('/api/config', (_, res) => {
  res.json({
    localModelUrl: LOCAL_MODEL_URL,
    knowledgeApiUrl: KNOWLEDGE_API_URL,
    providers: {
      qwen: {
        name: '通义千问',
        defaultModel: 'qwen-plus',
        defaultUrl: QWEN_BASE_URL
      },
      openai: {
        name: 'OpenAI',
        defaultModel: 'gpt-4o',
        defaultUrl: 'https://api.openai.com/v1'
      },
      openrouter: {
        name: 'OpenRouter',
        defaultModel: 'x-ai/grok-4-fast:free',
        defaultUrl: 'https://openrouter.ai/api/v1'
      },
      local: {
        name: '本地模型',
        defaultModel: 'local-model',
        defaultUrl: LOCAL_MODEL_URL
      }
    }
  });
});

// 根路径服务主页
app.get('/', (_, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

const PORT = process.env.PORT || 5757;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));


