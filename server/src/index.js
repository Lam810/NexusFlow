import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import csv from 'csv-parser';
import VectorDB from './vectorDB.js';
import FileParser from './fileParser.js';
import EnhancedVectorSearch from './enhancedVectorSearch.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import {
  assertSecureJwtSecret,
  createCorsOptions,
  createCookieOriginGuard,
  createJwtAuthenticator,
  createRateLimiter as createMemoryRateLimiter,
  parseAllowedOrigins,
  readTextLimited,
  safeFetch,
  sanitizeWorkflowNodes,
  substituteVariables,
} from './security.js';
import {
  assertModelConfigEncryptionKey,
  decryptModelApiKey,
  encryptModelApiKey,
  normalizeModelName,
  normalizeOpenAIBaseUrl,
  openAICompatibleEndpoint,
} from './modelConfig.js';

const app = express();
const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_API_KEY = process.env.QWEN_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LOCAL_MODEL_URL = process.env.LOCAL_MODEL_URL || 'http://localhost:8000/v1/chat/completions';
const JWT_SECRET = assertSecureJwtSecret(process.env.JWT_SECRET);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MODEL_CONFIG_ENCRYPTION_KEY = assertModelConfigEncryptionKey(
  process.env.MODEL_CONFIG_ENCRYPTION_KEY || (!IS_PRODUCTION ? JWT_SECRET : '')
);
const IS_VERCEL = Boolean(process.env.VERCEL);
const vercelOrigins = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
  .filter(Boolean)
  .map(hostname => `https://${hostname}`);
const CORS_ORIGINS = [
  process.env.CORS_ORIGINS || (!IS_PRODUCTION ? 'http://localhost:5173,http://127.0.0.1:5173' : ''),
  ...vercelOrigins,
].filter(Boolean).join(',');
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || process.env.DATABASE_PATH || 'vector_knowledge.db';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || '';
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 5757;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || (IS_VERCEL ? '/tmp/nexusflow-uploads' : 'uploads'));
const MAX_UPLOAD_BYTES = Math.max(
  64 * 1024,
  Math.min(Number(process.env.MAX_UPLOAD_BYTES) || (IS_VERCEL ? 4_000_000 : 20 * 1024 * 1024), IS_VERCEL ? 4_000_000 : 20 * 1024 * 1024)
);
const SESSION_COOKIE_NAME = IS_PRODUCTION ? '__Host-nexusflow_session' : 'nexusflow_session';
const SESSION_TTL_SECONDS = Math.max(900, Math.min(Number(process.env.SESSION_TTL_SECONDS) || 43_200, 604_800));
const EXPOSE_AUTH_TOKEN = process.env.EXPOSE_AUTH_TOKEN === 'true';
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION === 'true' || !IS_PRODUCTION;
const configuredBcryptRounds = Number(process.env.BCRYPT_ROUNDS) || (IS_PRODUCTION ? 12 : 10);
const BCRYPT_ROUNDS = Math.max(IS_PRODUCTION ? 12 : 4, Math.min(configuredBcryptRounds, 14));
const ALLOW_PRIVATE_NETWORK_REQUESTS = process.env.ALLOW_PRIVATE_NETWORK_REQUESTS === 'true';
const MAX_PROXY_RESPONSE_BYTES = Math.max(
  64 * 1024,
  Math.min(Number(process.env.MAX_PROXY_RESPONSE_BYTES) || 2 * 1024 * 1024, 10 * 1024 * 1024)
);

// 动态知识库配置
const KNOWLEDGE_API_URL = process.env.KNOWLEDGE_API_URL || 'http://localhost:5000';

if (IS_PRODUCTION) {
  const allowedOrigins = parseAllowedOrigins(CORS_ORIGINS);
  if (allowedOrigins.size === 0 || [...allowedOrigins].some(origin => {
    try {
      return new URL(origin).protocol !== 'https:';
    } catch {
      return true;
    }
  })) {
    throw new Error('Production CORS_ORIGINS must contain only valid HTTPS origins.');
  }
  if (process.env.ENABLE_LEGACY_ADMIN === 'true') {
    throw new Error('ENABLE_LEGACY_ADMIN cannot be enabled in production.');
  }
  if (EXPOSE_AUTH_TOKEN) {
    throw new Error('EXPOSE_AUTH_TOKEN cannot be enabled in production.');
  }
  if (!process.env.MODEL_CONFIG_ENCRYPTION_KEY) {
    throw new Error('MODEL_CONFIG_ENCRYPTION_KEY is required in production.');
  }
  if (process.env.MODEL_CONFIG_ENCRYPTION_KEY === JWT_SECRET) {
    throw new Error('MODEL_CONFIG_ENCRYPTION_KEY must be different from JWT_SECRET in production.');
  }
  if (IS_VERCEL && (!process.env.TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN)) {
    throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required on Vercel.');
  }
  if (IS_VERCEL && (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN)) {
    throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required on Vercel.');
  }
}

const redisClient = UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN })
  : null;

function createRequestLimiter({ windowMs, limit, prefix, keyGenerator }) {
  if (!redisClient) {
    return createMemoryRateLimiter({ windowMs, max: limit, keyPrefix: `nexusflow:${prefix}` });
  }

  const limiter = new Ratelimit({
    redis: redisClient,
    limiter: Ratelimit.slidingWindow(limit, `${Math.ceil(windowMs / 1000)} s`),
    prefix: `nexusflow:${prefix}`,
    analytics: false,
    timeout: 3_000,
  });

  return async (req, res, next) => {
    const identifier = keyGenerator
      ? String(keyGenerator(req))
      : String(req.ip || req.socket.remoteAddress || 'unknown');
    try {
      const result = await limiter.limit(identifier);
      res.setHeader('RateLimit-Limit', String(result.limit));
      res.setHeader('RateLimit-Remaining', String(result.remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(result.reset / 1000)));
      if (!result.success) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))));
        return res.status(429).json({ error: '请求过于频繁，请稍后重试' });
      }
      return next();
    } catch (error) {
      console.error('Rate limiter failed:', error.message);
      if (IS_PRODUCTION) return res.status(503).json({ error: '请求限流服务暂时不可用' });
      return next();
    }
  };
}

const authenticateToken = createJwtAuthenticator(jwt, JWT_SECRET, [SESSION_COOKIE_NAME]);
const cookieOriginGuard = createCookieOriginGuard(CORS_ORIGINS);
const apiRateLimiter = createRequestLimiter({ windowMs: 60_000, limit: 120, prefix: 'api' });
const authRateLimiter = createRequestLimiter({ windowMs: 15 * 60_000, limit: 10, prefix: 'auth' });
const loginAccountRateLimiter = createRequestLimiter({
  windowMs: 15 * 60_000,
  limit: 30,
  prefix: 'login-account',
  keyGenerator: req => createHash('sha256')
    .update(String(req.body?.username || '').trim().toLowerCase())
    .digest('hex'),
});
const publicApiPaths = new Set(['/health', '/auth/config', '/auth/login', '/auth/register']);
const runtimeAgentPathPrefix = '/runtime/agent/';
const DUMMY_PASSWORD_HASH = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);

app.disable('x-powered-by');
if (IS_PRODUCTION) app.set('trust proxy', 1);
app.use(cors(createCorsOptions(CORS_ORIGINS)));
app.use(express.json({ limit: '2mb' }));
app.use('/api', apiRateLimiter);
app.use('/api', (req, res, next) => {
  if (publicApiPaths.has(req.path) || req.path.startsWith(runtimeAgentPathPrefix)) return next();
  return authenticateToken(req, res, error => {
    if (error) return next(error);
    return cookieOriginGuard(req, res, next);
  });
});

if (process.env.ENABLE_LEGACY_ADMIN === 'true') {
  app.use('/legacy', express.static(path.resolve('public'), {
    dotfiles: 'deny',
    index: false,
    redirect: false,
  }));
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  dest: UPLOAD_DIR,
  fileFilter: (_req, file, callback) => {
    const allowedExtensions = new Set([
      '.txt', '.md', '.docx', '.pdf', '.xlsx', '.csv', '.json', '.xml', '.html', '.htm'
    ]);
    const extension = path.extname(file.originalname || '').toLowerCase();
    callback(allowedExtensions.has(extension) ? null : new Error('Unsupported file extension.'), allowedExtensions.has(extension));
  },
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
});

// 初始化向量数据库和增强搜索
const vectorDB = new VectorDB({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });
const fileParser = new FileParser();
const enhancedSearch = new EnhancedVectorSearch(vectorDB);
const MAX_RUNTIME_TRACE_BYTES = 64 * 1024;
const RUNTIME_ONLINE_WINDOW_MS = 90_000;

function hashRuntimeToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function runtimeDeviceView(device) {
  if (!device) return null;
  const lastSeen = device.last_seen_at
    ? Date.parse(`${String(device.last_seen_at).replace(' ', 'T')}Z`)
    : 0;
  return {
    id: device.id,
    name: device.name,
    capabilities: device.capabilities || {},
    lastSeenAt: device.last_seen_at || null,
    createdAt: device.created_at,
    revokedAt: device.revoked_at || null,
    online: !device.revoked_at && Number.isFinite(lastSeen) && Date.now() - lastSeen <= RUNTIME_ONLINE_WINDOW_MS,
  };
}

function normalizeRuntimeCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > 8 * 1024) throw new Error('设备能力信息过大');
  return JSON.parse(serialized);
}

function boundedRuntimeValue(value, fieldName) {
  if (value === undefined) return null;
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${fieldName} 必须是可序列化的 JSON`);
  }
  if (Buffer.byteLength(serialized) > MAX_RUNTIME_TRACE_BYTES) {
    throw new Error(`${fieldName} 超过 ${MAX_RUNTIME_TRACE_BYTES / 1024}KB 限制`);
  }
  return JSON.parse(serialized);
}

async function authenticateRuntimeDevice(req, res, next) {
  const header = String(req.headers.authorization || '').trim();
  const match = header.match(/^Bearer\s+(nfr_[A-Za-z0-9_-]+)$/i);
  if (!match) return res.status(401).json({ error: 'Runtime 设备令牌无效' });
  try {
    const device = await vectorDB.getRuntimeDeviceByTokenHash(hashRuntimeToken(match[1]));
    if (!device) return res.status(401).json({ error: 'Runtime 设备令牌无效或已撤销' });
    req.runtimeDevice = device;
    return next();
  } catch (error) {
    return next(error);
  }
}

const sanitizedWorkflowCount = await vectorDB.sanitizeStoredWorkflows(sanitizeWorkflowNodes);
if (sanitizedWorkflowCount > 0) {
  console.warn(`Removed persisted secrets from ${sanitizedWorkflowCount} workflow(s).`);
}

function modelRequestSecurityOptions(provider, apiUrl, timeoutMs = 60_000) {
  let usesConfiguredLocalEndpoint = false;
  if (provider === 'local') {
    try {
      usesConfiguredLocalEndpoint = new URL(apiUrl || LOCAL_MODEL_URL).href === new URL(LOCAL_MODEL_URL).href;
    } catch {
      usesConfiguredLocalEndpoint = false;
    }
  }
  return {
    allowPrivate: ALLOW_PRIVATE_NETWORK_REQUESTS || usesConfiguredLocalEndpoint,
    timeoutMs,
  };
}

async function getStoredModelConfig(userId) {
  const stored = await vectorDB.getUserModelConfig(userId);
  if (!stored) return null;
  return {
    baseUrl: stored.base_url,
    model: stored.model,
    embeddingModel: stored.embedding_model || '',
    apiKey: decryptModelApiKey(stored.api_key_encrypted, MODEL_CONFIG_ENCRYPTION_KEY, userId),
  };
}

async function resolveChatModel(userId, { provider = 'qwen', apiUrl, apiKey, model = 'qwen-plus' }) {
  const stored = await getStoredModelConfig(userId);
  if (stored) {
    return {
      endpoint: openAICompatibleEndpoint(stored.baseUrl, 'chat/completions'),
      key: stored.apiKey,
      model: stored.model,
      isLocal: false,
      securityOptions: modelRequestSecurityOptions('account', stored.baseUrl),
    };
  }

  if (provider === 'local') {
    const endpoint = apiUrl || LOCAL_MODEL_URL;
    return {
      endpoint,
      key: null,
      model: model || 'local-model',
      isLocal: true,
      securityOptions: modelRequestSecurityOptions(provider, endpoint),
    };
  }

  const key = provider === 'openai'
    ? apiKey || OPENAI_API_KEY
    : provider === 'openrouter'
      ? apiKey || OPENROUTER_API_KEY
      : apiKey || QWEN_API_KEY;
  if (!key) throw new Error('请先在“模型设置”中配置 OpenAI 兼容 API');
  const baseUrl = apiUrl || (provider === 'openai'
    ? 'https://api.openai.com/v1'
    : provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : QWEN_BASE_URL);
  return {
    endpoint: openAICompatibleEndpoint(baseUrl, 'chat/completions'),
    key,
    model,
    isLocal: false,
    securityOptions: modelRequestSecurityOptions(provider, apiUrl),
  };
}

async function hasWorkflowAccess(userId, workflowId) {
  if (!workflowId || typeof workflowId !== 'string') return false;
  return Boolean(await vectorDB.getWorkflow(userId, workflowId));
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

function issueSession(res, user) {
  const token = jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: SESSION_TTL_SECONDS,
      issuer: 'nexusflow',
      audience: 'nexusflow-client',
    }
  );
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
  res.setHeader('Cache-Control', 'no-store');
  return token;
}

function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email };
}

function publicModelConfig(config) {
  if (!config) {
    return { configured: false, baseUrl: '', model: '', embeddingModel: '', hasApiKey: false };
  }
  return {
    configured: true,
    baseUrl: config.base_url,
    model: config.model,
    embeddingModel: config.embedding_model || '',
    hasApiKey: Boolean(config.api_key_encrypted),
  };
}

app.get('/api/model-config', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicModelConfig(await vectorDB.getUserModelConfig(req.user.id)));
});

app.put('/api/model-config', async (req, res) => {
  try {
    const existing = await vectorDB.getUserModelConfig(req.user.id);
    const baseUrl = normalizeOpenAIBaseUrl(req.body.baseUrl, { requireHttps: IS_PRODUCTION });
    const model = normalizeModelName(req.body.model);
    const embeddingModel = normalizeModelName(req.body.embeddingModel, { required: false });
    const apiKey = String(req.body.apiKey || '').trim();
    if (!apiKey && !existing?.api_key_encrypted) {
      return res.status(400).json({ error: '首次配置时必须填写 API Key' });
    }
    if (apiKey.length > 8_192) {
      return res.status(400).json({ error: 'API Key 过长' });
    }
    const apiKeyEncrypted = apiKey
      ? encryptModelApiKey(apiKey, MODEL_CONFIG_ENCRYPTION_KEY, req.user.id)
      : existing.api_key_encrypted;
    const saved = await vectorDB.upsertUserModelConfig(req.user.id, {
      baseUrl,
      model,
      embeddingModel,
      apiKeyEncrypted,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json(publicModelConfig(saved));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/model-config', async (req, res) => {
  await vectorDB.deleteUserModelConfig(req.user.id);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true });
});

// 聊天记录管理API端点
app.post('/api/chat/add-context', async (req, res) => {
  try {
    const { workflowId, question, answer, timestamp } = req.body;
    
    if (!workflowId || !question || !answer) {
      return res.status(400).json({ error: 'workflowId、question和answer不能为空' });
    }
    if (!(await hasWorkflowAccess(req.user.id, workflowId))) {
      return res.status(404).json({ error: '工作流不存在' });
    }
    
    // 生成问题的embedding用于后续相似度搜索
    let questionEmbedding = null;
    try {
      questionEmbedding = await createEmbedding(question, req.user.id);
      console.log('✅ 问题embedding生成成功');
    } catch (embError) {
      console.warn('⚠️ 生成问题embedding失败:', embError.message);
    }
    
    const result = await vectorDB.saveChatHistory(
      req.user.id,
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
    if (!(await hasWorkflowAccess(req.user.id, workflowId))) {
      return res.status(404).json({ error: '工作流不存在' });
    }
    
    // 生成查询的embedding
    const queryEmbedding = await createEmbedding(query, req.user.id);
    console.log('✅ 查询embedding生成成功');
    
    // 搜索相似的聊天历史
    const results = await vectorDB.searchChatHistory(req.user.id, queryEmbedding, workflowId, topK);
    
    console.log(`📊 找到 ${results.length} 条相关历史记录`);
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
    if (!(await hasWorkflowAccess(req.user.id, workflowId))) {
      return res.status(404).json({ error: '工作流不存在' });
    }
    
    console.log('🗑️ 收到清除请求 - workflowId:', workflowId);
    
    const deletedCount = await vectorDB.clearChatHistory(req.user.id, workflowId);
    
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

async function createEmbedding(input, userId) {
  const stored = await getStoredModelConfig(userId);
  const baseUrl = stored?.embeddingModel ? stored.baseUrl : QWEN_BASE_URL;
  const key = stored?.embeddingModel ? stored.apiKey : QWEN_API_KEY;
  const model = stored?.embeddingModel || 'text-embedding-v3';
  if (!key) {
    throw new Error('请在“模型设置”中填写 Embedding Model，或由管理员配置 QWEN_API_KEY');
  }
  const res = await safeFetch(openAICompatibleEndpoint(baseUrl, 'embeddings'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      input,
    }),
  }, modelRequestSecurityOptions(stored?.embeddingModel ? 'account' : 'qwen', baseUrl, 30_000));
  if (!res.ok) {
    const text = await readTextLimited(res, 64 * 1024);
    throw new Error(`Embeddings failed: ${res.status} ${text}`);
  }
  const json = JSON.parse(await readTextLimited(res, MAX_PROXY_RESPONSE_BYTES));
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
      if (req.file.size > MAX_UPLOAD_BYTES) {
        return res.status(400).json({ error: `File too large. Maximum size is ${MAX_UPLOAD_BYTES} bytes.` });
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
    const fileId = randomUUID();
    
    // 插入文件信息
    await vectorDB.insertFile(req.user.id, {
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
        const embedding = await createEmbedding(chunk, req.user.id);
        const docId = `${fileId}-chunk-${i}`;
        
        // 插入到向量数据库
        await vectorDB.insertDocument(req.user.id, {
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
    
    const qEmbedding = await createEmbedding(query, req.user.id);
    let results = [];
    let suggestions = [];
    
    try {
      switch (searchType) {
        case 'keyword':
          results = await enhancedSearch.keywordSearch(query, req.user.id, topK);
          break;
        case 'hybrid':
          results = await enhancedSearch.hybridSearch(query, qEmbedding, req.user.id, {
            topK,
            ...options
          });
          break;
        case 'vector':
        default:
          results = await enhancedSearch.searchSimilar(qEmbedding, req.user.id, {
            topK,
            threshold: options.threshold || 0.3,
            rerank: options.rerank !== false,
            expandQuery: options.expandQuery || false,
            ...options
          });
          break;
      }
      
      // 生成搜索建议
      suggestions = await enhancedSearch.suggestCorrections(query, results, req.user.id);
      
      // 记录搜索历史
      enhancedSearch.recordSearch(req.user.id, query, results);
      
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
app.get('/api/vector/files', async (req, res) => {
  try {
    const files = await vectorDB.getAllFiles(req.user.id);
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取所有文档列表
app.get('/api/vector/documents', async (req, res) => {
  try {
    const documents = await vectorDB.getAllDocuments(req.user.id);
    res.json({ documents });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 根据文件名获取文档
app.get('/api/vector/files/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const documents = await vectorDB.getDocumentsByFilename(req.user.id, filename);
    res.json({ documents });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除文件
app.delete('/api/vector/files/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const result = await vectorDB.deleteFile(req.user.id, filename);
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
app.get('/api/vector/stats', async (req, res) => {
  try {
    const stats = await vectorDB.getStats(req.user.id);
    const searchStats = enhancedSearch.getSearchStats(req.user.id);
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
        '.pdf': 'PDF文档',
        '.xlsx': 'Microsoft Excel表格',
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
    const searchStats = enhancedSearch.getSearchStats(req.user.id);
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

    const resolvedModel = await resolveChatModel(req.user.id, { provider, apiUrl, apiKey, model });
    const { key, endpoint, isLocal, securityOptions } = resolvedModel;

    // 如果启用知识库，先搜索相关知识
    let knowledgeContext = '';
    if (useKnowledgeBase && messages.length > 0) {
      try {
        const lastMessage = messages[messages.length - 1];
        const userQuery = typeof lastMessage === 'string' ? lastMessage : lastMessage.content;
        
        // 从知识库搜索相关内容
        const kbResponse = await safeFetch(`${KNOWLEDGE_API_URL}/api/knowledge-base/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: userQuery, top_k: 3 })
        }, { allowPrivate: true, timeoutMs: 15_000 });
        
        if (kbResponse.ok) {
          const kbData = JSON.parse(await readTextLimited(kbResponse, MAX_PROXY_RESPONSE_BYTES));
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
    if (workflowId && !(await hasWorkflowAccess(req.user.id, workflowId))) {
      return res.status(404).json({ error: '工作流不存在' });
    }
    if (workflowId && messages.length > 0) {
      try {
        const lastMessage = messages[messages.length - 1];
        const userQuery = typeof lastMessage === 'string' ? lastMessage : lastMessage.content;
        
        // 从聊天记录搜索相关内容
        const chatResponse = await safeFetch(`${KNOWLEDGE_API_URL}/api/knowledge-base/chat/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query: userQuery, 
            workflow_id: workflowId,
            top_k: 3 
          })
        }, { allowPrivate: true, timeoutMs: 15_000 });
        
        if (chatResponse.ok) {
          const chatData = JSON.parse(await readTextLimited(chatResponse, MAX_PROXY_RESPONSE_BYTES));
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

    const r = await safeFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        model: resolvedModel.model,
        messages: finalMessages, 
        temperature, 
        stream: false,
        max_tokens: isLocal ? 1000 : undefined // 为本地模型添加max_tokens
      }),
    }, securityOptions);
    
    if (!r.ok) {
      const text = await readTextLimited(r, 64 * 1024);
      throw new Error(`Chat failed: ${r.status} ${text}`);
    }
    
    const json = JSON.parse(await readTextLimited(r, MAX_PROXY_RESPONSE_BYTES));
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
      advanced = { timeout: 30000, retries: 0, followRedirects: true, validateSSL: true },
      authQueryParams = [],
      authBodyParams = []
    } = req.body;

    if (typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: '请求URL不能为空' });
    }
    const safeVariables = variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {};
    const safeHeaders = headers && typeof headers === 'object' && !Array.isArray(headers) ? headers : {};
    const advancedOptions = advanced && typeof advanced === 'object' ? advanced : {};
    const queryParams = Array.isArray(authQueryParams) ? authQueryParams : [];
    const bodyParams = Array.isArray(authBodyParams) ? authBodyParams : [];

    // Replace literal placeholders without interpreting variable names as regular expressions.
    let formattedUrl = substituteVariables(url, safeVariables);

    // Add auth query parameters to URL
    if (queryParams.length > 0) {
      const urlObj = new URL(formattedUrl);
      queryParams.forEach(param => {
        if (param && typeof param.key === 'string') {
          urlObj.searchParams.append(param.key, String(param.value ?? ''));
        }
      });
      formattedUrl = urlObj.toString();
    }

    // Replace variables in headers
    const formattedHeaders = {};
    for (const [key, value] of Object.entries(safeHeaders)) {
      formattedHeaders[key] = substituteVariables(String(value), safeVariables);
    }

    // Add custom User-Agent if specified
    if (advancedOptions.customUserAgent) {
      formattedHeaders['User-Agent'] = String(advancedOptions.customUserAgent);
    }

    // Replace variables in body
    let formattedBody = substituteVariables(body, safeVariables);

    // Add auth body parameters
    if (bodyParams.length > 0) {
      if (typeof formattedBody === 'string') {
        try {
          const bodyObj = JSON.parse(formattedBody);
          bodyParams.forEach(param => {
            if (param && typeof param.key === 'string') bodyObj[param.key] = param.value;
          });
          formattedBody = JSON.stringify(bodyObj);
        } catch (e) {
          // If body is not JSON, append as form data
          const formData = new URLSearchParams();
          bodyParams.forEach(param => {
            if (param && typeof param.key === 'string') {
              formData.append(param.key, String(param.value ?? ''));
            }
          });
          formattedBody = formData.toString();
          formattedHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        }
      } else if (formattedBody && typeof formattedBody === 'object') {
        bodyParams.forEach(param => {
          if (param && typeof param.key === 'string') formattedBody[param.key] = param.value;
        });
      }
    }

    const upperMethod = String(method || 'GET').toUpperCase();
    const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
    if (!allowedMethods.has(upperMethod)) {
      return res.status(400).json({ error: '不支持的HTTP方法' });
    }
    if (advancedOptions.validateSSL === false) {
      return res.status(400).json({ error: '不允许关闭TLS证书验证' });
    }

    const forbiddenHeaders = new Set([
      'host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'proxy-authorization'
    ]);
    for (const key of Object.keys(formattedHeaders)) {
      if (forbiddenHeaders.has(key.toLowerCase())) delete formattedHeaders[key];
    }

    const options = {
      method: upperMethod, 
      headers: formattedHeaders,
    };
    
    if (upperMethod !== 'GET' && upperMethod !== 'HEAD' && formattedBody) {
      options.body = typeof formattedBody === 'object' ? JSON.stringify(formattedBody) : formattedBody;
      if (typeof formattedBody === 'object' && !options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
      }
    }

    // Retry logic
    const retries = Math.max(0, Math.min(Number(advancedOptions.retries) || 0, 3));
    const timeoutMs = Math.max(1_000, Math.min(Number(advancedOptions.timeout) || 30_000, 60_000));
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await safeFetch(formattedUrl, options, {
          allowPrivate: ALLOW_PRIVATE_NETWORK_REQUESTS,
          maxRedirects: advancedOptions.followRedirects === false ? 0 : 3,
          timeoutMs,
        });

        const content = await readTextLimited(response, MAX_PROXY_RESPONSE_BYTES);
        let json = null;
        try {
          json = JSON.parse(content);
        } catch {
          // Non-JSON responses are returned as text.
        }

        const responseHeaders = Object.fromEntries(
          [...response.headers.entries()].filter(([key]) => key.toLowerCase() !== 'set-cookie')
        );
        res.json({
          status_code: response.status,
          headers: responseHeaders,
          content,
          json,
          success: response.ok,
          attempt: attempt + 1
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
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
    
    // Prepare token request body
    const tokenBody = new URLSearchParams();
    tokenBody.append('grant_type', grantType);
    tokenBody.append('client_id', clientId);
    tokenBody.append('client_secret', clientSecret);
    
    if (scope) {
      tokenBody.append('scope', scope);
    }
    
    const response = await safeFetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: tokenBody.toString()
    }, {
      allowPrivate: ALLOW_PRIVATE_NETWORK_REQUESTS,
      maxRedirects: 0,
      timeoutMs: 15_000,
    });
    
    if (!response.ok) {
      const errorText = await readTextLimited(response, 64 * 1024);
      throw new Error(`OAuth2 token request failed: ${response.status} ${errorText}`);
    }
    
    const tokenText = await readTextLimited(response, 256 * 1024);
    const tokenData = JSON.parse(tokenText);
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

    const resolvedModel = await resolveChatModel(req.user.id, { provider, apiUrl, apiKey, model });
    const { key, endpoint, isLocal, securityOptions } = resolvedModel;

    // 构建请求头
    const headers = {
      'Content-Type': 'application/json',
    };
    
    // 只有非本地模型才需要Authorization头
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

        const r = await safeFetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
        model: resolvedModel.model,
            messages,
        temperature: temperature || 0.2, 
        stream: false,
        max_tokens: isLocal ? 1000 : undefined // 为本地模型添加max_tokens
      }),
    }, securityOptions);
    
    if (!r.ok) {
      const text = await readTextLimited(r, 64 * 1024);
      throw new Error(`Analysis failed: ${r.status} ${text}`);
    }
    
    const json = JSON.parse(await readTextLimited(r, MAX_PROXY_RESPONSE_BYTES));
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

    const resolvedModel = await resolveChatModel(req.user.id, { provider, apiUrl, apiKey, model });
    const { key, endpoint, securityOptions } = resolvedModel;

    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const upstream = await safeFetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
        model: resolvedModel.model,
        messages,
        temperature: temperature || 0.2,
        stream: true,
      }),
    }, securityOptions);

    if (!upstream.ok || !upstream.body) {
      const text = await readTextLimited(upstream, 64 * 1024).catch(() => '');
      throw new Error(`Upstream failed: ${upstream.status} ${text}`);
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.once('close', () => upstream.body.destroy());
    upstream.body.once('error', () => {
      if (!res.writableEnded) res.end();
    });
    upstream.body.pipe(res);
  } catch (e) {
    try {
      res.status(500).end(`data: ${JSON.stringify({ error: String(e.message || e) })}\n\n`);
    } catch {}
  }
});

// 文件上传API - 支持Excel和CSV文件解析
app.post('/api/upload-data', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const fileExtension = path.extname(originalName).toLowerCase();

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
      } else if (fileExtension === '.xlsx') {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) throw new Error('Excel工作簿不包含工作表');

        const rows = [];
        worksheet.eachRow({ includeEmpty: false }, row => {
          rows.push(row.values.slice(1).map(value => {
            if (value === null || value === undefined) return '';
            if (value instanceof Date) return value.toISOString();
            if (typeof value === 'object') {
              if ('text' in value) return String(value.text);
              if ('result' in value) return String(value.result ?? '');
              if ('richText' in value) return value.richText.map(item => item.text).join('');
              return JSON.stringify(value);
            }
            return String(value);
          }));
        });

        if (rows.length > 0) {
          headers = rows[0].map(String);
          data = rows.slice(1);
        }
      } else {
        fs.unlinkSync(filePath);
        return res.status(400).json({ error: '不支持的文件格式，请上传CSV或XLSX文件' });
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

    const resolvedModel = await resolveChatModel(req.user.id, { provider, apiUrl, apiKey, model });
    const { key, endpoint, securityOptions } = resolvedModel;

    const headers_req = {
      'Content-Type': 'application/json',
    };
    
    if (key) {
      headers_req['Authorization'] = `Bearer ${key}`;
    }

    const r = await safeFetch(endpoint, {
      method: 'POST',
      headers: headers_req,
      body: JSON.stringify({
        model: resolvedModel.model,
        messages,
        temperature: temperature || 0.2,
        stream: true,
      }),
    }, securityOptions);

    if (!r.ok || !r.body) {
      const text = await readTextLimited(r, 64 * 1024).catch(() => '');
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
    if (workflowId && !(await hasWorkflowAccess(req.user.id, workflowId))) {
      return res.status(404).json({ error: '工作流不存在' });
    }

    const resolvedModel = await resolveChatModel(req.user.id, { provider, apiUrl, apiKey, model });
    const { key, endpoint, securityOptions } = resolvedModel;

    // 搜索聊天上下文（如果提供了workflowId）
    let chatContext = '';
    if (workflowId && messages.length > 0) {
      try {
        const lastMessage = messages[messages.length - 1];
        const userQuery = typeof lastMessage === 'string' ? lastMessage : lastMessage.content;
        
        // 从聊天记录搜索相关内容
        const chatResponse = await safeFetch(`${KNOWLEDGE_API_URL}/api/knowledge-base/chat/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query: userQuery, 
            workflow_id: workflowId,
            top_k: 3 
          })
        }, { allowPrivate: true, timeoutMs: 15_000 });
        
        if (chatResponse.ok) {
          const chatData = JSON.parse(await readTextLimited(chatResponse, MAX_PROXY_RESPONSE_BYTES));
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

    const upstream = await safeFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: resolvedModel.model,
        messages: finalMessages,
        temperature,
        stream: true,
      }),
    }, securityOptions);

    if (!upstream.ok || !upstream.body) {
      const text = await readTextLimited(upstream, 64 * 1024).catch(() => '');
      throw new Error(`Upstream failed: ${upstream.status} ${text}`);
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.once('close', () => upstream.body.destroy());
    upstream.body.once('error', () => {
      if (!res.writableEnded) res.end();
    });
    upstream.body.pipe(res);
  } catch (e) {
    try {
      res.status(500).end(`data: ${JSON.stringify({ error: String(e.message || e) })}\n\n`);
    } catch {}
  }
});

// 认证相关API
app.get('/api/auth/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ registrationEnabled: ALLOW_REGISTRATION });
});

app.post('/api/auth/register', authRateLimiter, async (req, res) => {
  try {
    if (!ALLOW_REGISTRATION) {
      return res.status(403).json({ error: '当前实例未开放注册' });
    }
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    
    if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) {
      return res.status(400).json({ error: '用户名需为3至32个字母、数字或 _.- 字符' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: '邮箱格式无效' });
    }
    if (password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: '密码长度需为12至128个字符' });
    }

    // 检查用户是否已存在
    const existingUser = await vectorDB.getUserByUsername(username) || await vectorDB.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: '用户名或邮箱已存在' });
    }

    // 加密密码
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    
    // 创建用户
    const user = await vectorDB.createUser(username, email, passwordHash);
    
    const token = issueSession(res, user);

    res.json({ 
      message: '注册成功', 
      ...(EXPOSE_AUTH_TOKEN ? { token } : {}),
      user: publicUser(user)
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ error: '注册失败' });
  }
});

app.post('/api/auth/login', authRateLimiter, loginAccountRateLimiter, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码都是必需的' });
    }

    // 查找用户
    const user = await vectorDB.getUserByUsername(username);
    // 即使用户不存在也执行密码比较，减少基于响应时间的用户名枚举。
    const isValidPassword = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!user || !isValidPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = issueSession(res, user);

    res.json({ 
      message: '登录成功', 
      ...(EXPOSE_AUTH_TOKEN ? { token } : {}),
      user: publicUser(user)
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ error: '登录失败' });
  }
});

app.get('/api/auth/me', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ user: publicUser(req.user) });
});

app.post('/api/auth/logout', (req, res) => {
  const { maxAge: _maxAge, ...clearOptions } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, clearOptions);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ message: '已退出登录' });
});

// 工作流管理API
app.get('/api/workflows', async (req, res) => {
  try {
    const workflows = await vectorDB.getWorkflows(req.user.id);
    res.json({ workflows });
  } catch (error) {
    console.error('获取工作流错误:', error);
    res.status(500).json({ error: '获取工作流失败' });
  }
});

app.post('/api/workflows', async (req, res) => {
  try {
    const { name, nodes, edges } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || !Array.isArray(nodes) || !Array.isArray(edges)) {
      return res.status(400).json({ error: '工作流数据无效' });
    }
    const workflowId = `workflow_${randomUUID()}`;
    const sanitizedNodes = sanitizeWorkflowNodes(nodes);
    const workflow = await vectorDB.createWorkflow(req.user.id, workflowId, name.trim(), sanitizedNodes, edges);
    res.json({ message: '工作流保存成功', workflow });
  } catch (error) {
    console.error('保存工作流错误:', error);
    res.status(500).json({ error: '保存工作流失败' });
  }
});

app.put('/api/workflows/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, nodes, edges } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || !Array.isArray(nodes) || !Array.isArray(edges)) {
      return res.status(400).json({ error: '工作流数据无效' });
    }
    const sanitizedNodes = sanitizeWorkflowNodes(nodes);
    const workflow = await vectorDB.updateWorkflow(req.user.id, id, name.trim(), sanitizedNodes, edges);
    if (!workflow) return res.status(404).json({ error: '工作流不存在' });
    res.json({ message: '工作流更新成功', workflow });
  } catch (error) {
    console.error('更新工作流错误:', error);
    res.status(500).json({ error: '更新工作流失败' });
  }
});

app.get('/api/workflows/:id', async (req, res) => {
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

app.delete('/api/workflows/:id', async (req, res) => {
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

// ==================== Local Runtime 与运行追踪 ====================

app.get('/api/runtime/devices', async (req, res) => {
  try {
    const devices = await vectorDB.getRuntimeDevices(req.user.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ devices: devices.map(runtimeDeviceView) });
  } catch (error) {
    console.error('获取 Runtime 设备失败:', error.message);
    res.status(500).json({ error: '获取 Runtime 设备失败' });
  }
});

app.post('/api/runtime/devices', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 80) return res.status(400).json({ error: '设备名称应为 1-80 个字符' });
    const token = `nfr_${randomBytes(32).toString('base64url')}`;
    const device = await vectorDB.createRuntimeDevice(req.user.id, {
      id: `device_${randomUUID()}`,
      name,
      tokenHash: hashRuntimeToken(token),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({
      device: runtimeDeviceView(device),
      token,
      warning: '设备令牌只显示这一次，请立即保存到本机环境变量。',
    });
  } catch (error) {
    console.error('创建设备配对失败:', error.message);
    res.status(500).json({ error: '创建设备配对失败' });
  }
});

app.delete('/api/runtime/devices/:id', async (req, res) => {
  try {
    const revoked = await vectorDB.revokeRuntimeDevice(req.user.id, req.params.id);
    if (!revoked) return res.status(404).json({ error: '设备不存在或已经撤销' });
    res.json({ message: '设备访问已撤销' });
  } catch (error) {
    console.error('撤销 Runtime 设备失败:', error.message);
    res.status(500).json({ error: '撤销 Runtime 设备失败' });
  }
});

app.post('/api/runtime/runs', async (req, res) => {
  try {
    const workflowId = String(req.body?.workflowId || '');
    const deviceId = String(req.body?.deviceId || '');
    const workflow = await vectorDB.getWorkflow(req.user.id, workflowId);
    if (!workflow) return res.status(404).json({ error: '工作流不存在' });
    const device = await vectorDB.getRuntimeDevice(req.user.id, deviceId);
    if (!device || device.revoked_at) return res.status(404).json({ error: 'Runtime 设备不存在或已撤销' });
    const input = boundedRuntimeValue(req.body?.input ?? { query: '' }, '运行输入');
    const run = await vectorDB.createWorkflowRun(req.user.id, {
      id: `run_${randomUUID()}`,
      workflowId,
      deviceId,
      triggerSource: 'manual',
      input,
      workflowSnapshot: {
        id: workflow.id,
        name: workflow.name,
        nodes: sanitizeWorkflowNodes(workflow.nodes),
        edges: workflow.edges,
      },
    });
    res.status(201).json({ run });
  } catch (error) {
    if (/JSON|64KB|可序列化/.test(error.message)) return res.status(400).json({ error: error.message });
    console.error('创建 Runtime 运行失败:', error.message);
    res.status(500).json({ error: '创建 Runtime 运行失败' });
  }
});

app.get('/api/runtime/runs', async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit) || 50;
    const runs = await vectorDB.getWorkflowRuns(req.user.id, Math.max(1, Math.min(requestedLimit, 100)));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ runs });
  } catch (error) {
    console.error('获取运行记录失败:', error.message);
    res.status(500).json({ error: '获取运行记录失败' });
  }
});

app.get('/api/runtime/runs/:id', async (req, res) => {
  try {
    const run = await vectorDB.getWorkflowRunWithSteps(req.user.id, req.params.id);
    if (!run) return res.status(404).json({ error: '运行记录不存在' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ run });
  } catch (error) {
    console.error('获取运行详情失败:', error.message);
    res.status(500).json({ error: '获取运行详情失败' });
  }
});

app.post('/api/runtime/runs/:id/cancel', async (req, res) => {
  try {
    const cancelled = await vectorDB.cancelWorkflowRun(req.user.id, req.params.id);
    if (!cancelled) return res.status(409).json({ error: '该运行无法取消' });
    res.json({ message: '运行已取消' });
  } catch (error) {
    console.error('取消运行失败:', error.message);
    res.status(500).json({ error: '取消运行失败' });
  }
});

app.get('/api/runtime/permissions', async (req, res) => {
  try {
    const [requests, grants] = await Promise.all([
      vectorDB.getRuntimePermissionRequests(req.user.id, 100),
      vectorDB.getRuntimePermissionGrants(req.user.id),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ requests, grants });
  } catch (error) {
    console.error('获取 Runtime 权限中心失败:', error.message);
    res.status(500).json({ error: '获取权限中心失败' });
  }
});

app.post('/api/runtime/permissions/:id/resolve', async (req, res) => {
  try {
    const decision = String(req.body?.decision || '');
    if (!new Set(['allow_once', 'allow_always', 'deny']).has(decision)) {
      return res.status(400).json({ error: '审批决定无效' });
    }
    const request = await vectorDB.resolveRuntimePermissionRequest(req.user.id, req.params.id, decision);
    if (!request) return res.status(409).json({ error: '审批请求不存在或已经处理' });
    res.json({ request });
  } catch (error) {
    console.error('处理 Runtime 权限申请失败:', error.message);
    res.status(500).json({ error: '处理权限申请失败' });
  }
});

app.delete('/api/runtime/permissions/grants/:id', async (req, res) => {
  try {
    const revoked = await vectorDB.revokeRuntimePermissionGrant(req.user.id, req.params.id);
    if (!revoked) return res.status(404).json({ error: '持续授权不存在' });
    res.json({ message: '持续授权已撤销' });
  } catch (error) {
    console.error('撤销 Runtime 持续授权失败:', error.message);
    res.status(500).json({ error: '撤销持续授权失败' });
  }
});

app.post('/api/runtime/agent/heartbeat', authenticateRuntimeDevice, async (req, res) => {
  try {
    const capabilities = normalizeRuntimeCapabilities(req.body?.capabilities);
    await vectorDB.touchRuntimeDevice(req.runtimeDevice.id, capabilities);
    res.json({ ok: true, deviceId: req.runtimeDevice.id, serverTime: new Date().toISOString() });
  } catch (error) {
    if (/能力信息/.test(error.message)) return res.status(400).json({ error: error.message });
    throw error;
  }
});

app.post('/api/runtime/agent/jobs/claim', authenticateRuntimeDevice, async (req, res) => {
  await vectorDB.touchRuntimeDevice(req.runtimeDevice.id);
  const job = await vectorDB.claimWorkflowRun(req.runtimeDevice);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ job });
});

app.post('/api/runtime/agent/runs/:id/start', authenticateRuntimeDevice, async (req, res) => {
  const run = await vectorDB.startWorkflowRun(req.runtimeDevice, req.params.id);
  if (!run) return res.status(409).json({ error: '运行不属于此设备，或状态不允许启动' });
  res.json({ run });
});

app.post('/api/runtime/agent/runs/:id/steps', authenticateRuntimeDevice, async (req, res) => {
  try {
    const nodeId = String(req.body?.nodeId || '').trim();
    const nodeType = String(req.body?.nodeType || '').trim();
    const nodeLabel = String(req.body?.nodeLabel || '').trim();
    const status = String(req.body?.status || 'done');
    if (!nodeId || nodeId.length > 160 || !nodeType || nodeType.length > 80 || !nodeLabel || nodeLabel.length > 160) {
      return res.status(400).json({ error: '节点轨迹字段无效' });
    }
    if (!new Set(['done', 'failed', 'skipped']).has(status)) {
      return res.status(400).json({ error: '节点轨迹状态无效' });
    }
    const durationMs = Math.max(0, Math.min(Number(req.body?.durationMs) || 0, 86_400_000));
    const step = await vectorDB.addWorkflowRunStep(req.runtimeDevice, req.params.id, {
      nodeId,
      nodeType,
      nodeLabel,
      status,
      input: boundedRuntimeValue(req.body?.input, '节点输入'),
      output: boundedRuntimeValue(req.body?.output, '节点输出'),
      error: req.body?.error ? String(req.body.error).slice(0, 8_000) : null,
      startedAt: req.body?.startedAt ? String(req.body.startedAt) : null,
      completedAt: req.body?.completedAt ? String(req.body.completedAt) : null,
      durationMs,
    });
    if (!step) return res.status(409).json({ error: '运行不属于此设备，或尚未启动' });
    res.status(201).json({ step });
  } catch (error) {
    if (/JSON|64KB|可序列化/.test(error.message)) return res.status(400).json({ error: error.message });
    throw error;
  }
});

app.post('/api/runtime/agent/runs/:id/complete', authenticateRuntimeDevice, async (req, res) => {
  try {
    const status = String(req.body?.status || 'failed');
    if (!new Set(['succeeded', 'failed']).has(status)) return res.status(400).json({ error: '完成状态无效' });
    const run = await vectorDB.completeWorkflowRun(req.runtimeDevice, req.params.id, {
      status,
      output: boundedRuntimeValue(req.body?.output, '运行输出'),
      error: req.body?.error ? String(req.body.error).slice(0, 8_000) : null,
    });
    if (!run) return res.status(409).json({ error: '运行不属于此设备，或已经结束' });
    res.json({ run });
  } catch (error) {
    if (/JSON|64KB|可序列化/.test(error.message)) return res.status(400).json({ error: error.message });
    throw error;
  }
});

app.post('/api/runtime/agent/permissions/request', authenticateRuntimeDevice, async (req, res) => {
  try {
    const runId = String(req.body?.runId || '').trim();
    const nodeId = String(req.body?.nodeId || '').trim();
    const capability = String(req.body?.capability || '').trim().toLowerCase();
    const actionLabel = String(req.body?.actionLabel || '').trim();
    if (!runId || !nodeId || nodeId.length > 160 || !/^[a-z][a-z0-9_.:-]{1,119}$/.test(capability)) {
      return res.status(400).json({ error: '权限申请字段无效' });
    }
    if (!actionLabel || actionLabel.length > 160) return res.status(400).json({ error: '权限操作名称无效' });
    const context = boundedRuntimeValue(req.body?.context || {}, '权限上下文');
    const request = await vectorDB.requestRuntimePermission(req.runtimeDevice, {
      runId, nodeId, capability, actionLabel, context,
    });
    if (!request) return res.status(409).json({ error: '运行不属于此设备，或尚未启动' });
    res.status(request.status === 'pending' ? 201 : 200).json({
      requestId: request.id,
      status: request.status,
      decision: request.decision || null,
    });
  } catch (error) {
    if (/JSON|64KB|可序列化/.test(error.message)) return res.status(400).json({ error: error.message });
    throw error;
  }
});

app.post('/api/runtime/agent/permissions/:id/status', authenticateRuntimeDevice, async (req, res) => {
  const request = await vectorDB.getRuntimePermissionRequestForDevice(req.runtimeDevice, req.params.id);
  if (!request) return res.status(404).json({ error: '权限申请不存在' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: request.status, decision: request.decision || null });
});

app.post('/api/runtime/agent/permissions/:id/expire', authenticateRuntimeDevice, async (req, res) => {
  const expired = await vectorDB.expireRuntimePermissionRequest(req.runtimeDevice, req.params.id);
  if (!expired) return res.status(409).json({ error: '权限申请无法过期或已经处理' });
  res.json({ message: '权限申请已过期' });
});

app.post('/api/runtime/agent/model/chat', authenticateRuntimeDevice, async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (messages.length < 1 || messages.length > 50) return res.status(400).json({ error: '模型消息数量无效' });
    const normalizedMessages = messages.map(message => ({
      role: new Set(['system', 'user', 'assistant']).has(message?.role) ? message.role : 'user',
      content: String(message?.content || ''),
    }));
    boundedRuntimeValue(normalizedMessages, '模型消息');
    const temperature = Math.max(0, Math.min(Number(req.body?.temperature) || 0.7, 2));
    const resolvedModel = await resolveChatModel(req.runtimeDevice.user_id, {
      provider: 'qwen',
      model: String(req.body?.model || 'qwen-plus'),
    });
    const headers = { 'Content-Type': 'application/json' };
    if (resolvedModel.key) headers.Authorization = `Bearer ${resolvedModel.key}`;
    const upstream = await safeFetch(resolvedModel.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: resolvedModel.model,
        messages: normalizedMessages,
        temperature,
        stream: false,
      }),
    }, resolvedModel.securityOptions);
    if (!upstream.ok) {
      const detail = await readTextLimited(upstream, 16 * 1024);
      throw new Error(`模型请求失败 (${upstream.status}): ${detail}`);
    }
    const payload = JSON.parse(await readTextLimited(upstream, MAX_PROXY_RESPONSE_BYTES));
    res.json({
      text: String(payload?.choices?.[0]?.message?.content || ''),
      model: payload?.model || resolvedModel.model,
      usage: payload?.usage || null,
    });
  } catch (error) {
    console.error('Runtime 模型调用失败:', error.message);
    res.status(502).json({ error: error.message });
  }
});

// ==================== Local Runtime 与运行追踪结束 ====================

app.get('/api/health', async (_, res) => {
  let databaseReady = false;
  let rateLimiterReady = !redisClient;
  try {
    await vectorDB.healthCheck();
    databaseReady = true;
    if (redisClient) {
      await redisClient.ping();
      rateLimiterReady = true;
    }
  } catch (error) {
    console.error('Health check failed:', error.message);
  }
  const ok = databaseReady && rateLimiterReady;
  res.status(ok ? 200 : 503).json({ ok, database: databaseReady, rateLimiter: rateLimiterReady });
});

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

    const resolvedModel = await resolveChatModel(req.user.id, { provider, apiUrl, apiKey, model });
    const { key, endpoint, securityOptions } = resolvedModel;

    const headers = {
      'Content-Type': 'application/json',
    };
    
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    const response = await safeFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: resolvedModel.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: temperature || 0.1,
        max_tokens: 10, // 限制输出长度
        stream: false
      }),
    }, securityOptions);

    if (!response.ok) {
      const text = await readTextLimited(response, 64 * 1024);
      throw new Error(`语义匹配请求失败: ${response.status} ${text}`);
    }

    const result = JSON.parse(await readTextLimited(response, MAX_PROXY_RESPONSE_BYTES));
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
    
    // 生成内容的embedding
    let embedding = null;
    try {
      embedding = await createEmbedding(content, req.user.id);
      console.log('✅ 内容embedding生成成功');
    } catch (embError) {
      console.warn('⚠️ 生成内容embedding失败:', embError.message);
    }
    
    const result = await vectorDB.addDynamicData(req.user.id, title, content, embedding, metadata);
    
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
          embedding = await createEmbedding(item.content, req.user.id);
        } catch (embError) {
          console.warn('⚠️ 批量条目的embedding生成失败:', embError.message);
        }
        
        const result = await vectorDB.addDynamicData(
          req.user.id,
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
    
    // 生成查询embedding
    const queryEmbedding = await createEmbedding(query, req.user.id);
    console.log('✅ 查询embedding生成成功');
    
    // 搜索动态数据
    const results = await vectorDB.searchDynamicData(req.user.id, queryEmbedding, top_k, threshold);
    
    console.log(`📊 找到 ${results.length} 条相关知识`);
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
    const stats = await vectorDB.getDynamicDataStats(req.user.id);
    
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
    const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 100, 500));
    const data = await vectorDB.getAllDynamicData(req.user.id, safeLimit);
    
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
    const success = await vectorDB.deleteDynamicData(req.user.id, id);
    
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
    const deletedCount = await vectorDB.clearAllDynamicData(req.user.id);
    
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
  if (process.env.ENABLE_LEGACY_ADMIN === 'true') {
    return res.redirect('/legacy/index.html');
  }
  return res.json({
    name: 'NexusFlow API',
    health: '/api/health',
    legacyAdminEnabled: false,
  });
});

app.use((error, _req, res, _next) => {
  console.error('Request failed:', error);
  if (error instanceof multer.MulterError || error?.message === 'Unsupported file extension.') {
    return res.status(400).json({ error: error.message });
  }
  if (error?.message === 'Origin is not allowed by CORS policy.') {
    return res.status(403).json({ error: error.message });
  }
  return res.status(500).json({ error: '服务器内部错误' });
});

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const httpServer = app.listen(PORT, HOST, () => console.log(`Server listening on http://${HOST}:${PORT}`));
  let shuttingDown = false;
  const shutdown = async signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down.`);
    const forceExit = setTimeout(() => {
      httpServer.closeAllConnections?.();
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    await new Promise(resolve => httpServer.close(resolve));
    await vectorDB.close();
    clearTimeout(forceExit);
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

export { app, redisClient, vectorDB };
export default app;


