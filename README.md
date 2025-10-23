# AI-Flow: 高度自定义的 AI 工作流构建器

AI-Flow 是一个最小化工作流工具，使用 React Flow 实现可视化节点编辑器，前端基于 React + Vite，后端基于 Express.js。支持知识检索（RAG）、LLM 对话、条件分支、HTTP 请求等节点，构建复杂 AI 管道。

## 更新日志

- 2025-10-22：
  - 扩展知识库文件格式支持：新增对Word、PDF、Excel、CSV、JSON、XML、HTML等12种文件格式的支持。
  - 优化向量处理策略：实现结构化分块、滑动窗口分块、混合分块等多种智能分块算法。
  - 增强向量搜索功能：支持向量搜索、关键词搜索、混合搜索三种模式，提供智能重排序和查询扩展。
  - 新增智能纠错机制：提供搜索建议、查询优化、低相似度提示等智能辅助功能。
  - 改进文件解析器：统一的文件解析接口，支持元数据提取和错误处理。
  - 优化上传界面：支持多种文件格式上传，可配置分块参数，显示文件类型和元数据信息。

- 2025-09-29：
  - 增强HTTP请求插件：支持多种鉴权方式（Bearer Token、API Key、Basic Auth、OAuth2.0、自定义鉴权）。
  - 新增高级配置：支持超时设置、重试机制、SSL验证、自定义User-Agent等。
  - 优化用户体验：添加实时测试功能，支持变量替换，改进错误处理和响应显示。
  - 简化OAuth2.0配置：支持直接使用Access Token，无需复杂的token获取流程。
  - 完善用户认证系统：支持用户注册、登录、JWT令牌认证、工作流权限管理。

- 2025-09-27：
  - 新增数据分析插件：支持多种LLM提供商（Qwen、OpenAI、OpenRouter、本地模型），提供数据分析建议和可视化图表。
  - 新增环境变量配置：支持通过.env文件配置本地模型URL，LLM和数据分析插件统一使用环境变量配置。
  - 新增多模型选择：OpenRouter支持多个模型选择，本地模型支持自定义URL配置。
  - 优化流式输出：数据分析插件支持流式响应，实时显示分析结果和图表。

- 2025-09-25：
  - 新增向量数据库（SQLite3 + better-sqlite3）持久化与管理接口：上传、搜索、文件/文档列表、统计等。
  - 新增流式输出：支持 LLM 与数据分析节点的 SSE 流式响应，聊天区实时增量显示。
  - 修复多项问题：消除聊天空白气泡、移除无意义占位提示、统一直接回复模板渲染、优化 Markdown 表格显示等。

## 特性

- **用户认证系统**: 完整的用户注册、登录、JWT令牌认证，支持工作流权限管理和用户隔离。
- **可视化工作流**: 使用 React Flow 拖拽节点、连接边，构建自定义 AI 流程。
- **知识库管理**: 使用 SQLite3 持久化存储文本嵌入（使用 Qwen text-embedding-v3），支持多种文件格式上传（TXT、MD、DOCX、PDF、XLSX、CSV、JSON、XML、HTML等）、智能分块、余弦相似度检索、文件管理。
- **LLM 集成**: 支持多种LLM提供商（Qwen、OpenAI、OpenRouter、本地模型），支持流式输出和模板化提示词。
- **数据分析**: 智能数据分析插件，支持多种LLM提供商，提供分析建议和可视化图表（柱状图、折线图、饼图）。
- **条件分支**: 基于变量的 if/elif/else 逻辑，支持多种运算符（包含、等于、空值等）。
- **HTTP 请求**: 强大的HTTP请求插件，支持多种鉴权方式（Bearer Token、API Key、Basic Auth、OAuth2.0、自定义鉴权）、变量替换、JSON/文本 body、高级配置（超时、重试、SSL验证等）。
- **直接回复**: 使用 LLM 输出或模板渲染最终答案。
- **聊天界面**: 运行工作流后显示历史对话，支持导入示例知识。
- **持久化存储**: SQLite3 数据库存储向量嵌入，支持文件管理、统计查询，智能文本分块（可配置块大小、重叠度、最大块数），文件大小限 2MB。

## 快速开始

### 先决条件

- Node.js >= 20.19.0 或 >= 22.12.0（Vite 7.1.7 要求；当前环境 Node.js v18.18.2 不满足，建议升级 Node.js 以避免兼容性问题。检查：`node --version`）
- npm >= 9.8.1（随 Node.js 升级自动更新；当前 npm v9.8.1 已满足，但需匹配 Node.js。检查：`npm --version`）
- Qwen API Key（从 [阿里云百炼控制台](https://bailian.console.aliyun.com/) 获取）

📌 **附加建议**
- 不要强行忽略版本警告：Node.js 18 和 Vite 7 不兼容是硬性限制，无法绕过。
- 团队协作时统一 Node 版本：建议在项目根目录加一个 .nvmrc 文件：
  ```bash
  echo "20" > .nvmrc
  ```
  其他成员运行 `nvm use` 即可自动切换版本。

### 安装

```bash
# 克隆项目（假设已存在）
cd AI-Flow

# 安装后端依赖
cd server && npm install && cd ..

# 安装前端依赖
cd client && npm install && cd ..
```

### 配置环境变量

- 复制 `server/.env.example` 为 `server/.env`（如果不存在，创建并添加）：
  ```bash
  # 通义千问 API Key (必需)
  QWEN_API_KEY=sk-your-qwen-api-key-here
  
  # OpenAI API Key (可选)
  OPENAI_API_KEY=sk-your-openai-key-here
  
  # OpenRouter API Key (可选)  
  OPENROUTER_API_KEY=sk-your-openrouter-key-here
  
  # 本地模型服务URL (可选，默认值已设置)
  LOCAL_MODEL_URL=http://xxx.xxx.xxx.xxx:8000/v1/chat/completions
  
  # 服务器端口 (可选，默认5757)
  PORT=5757
  ```

**环境变量说明**：
- `QWEN_API_KEY`: 通义千问API密钥，从[阿里云百炼控制台](https://bailian.console.aliyun.com/)获取
- `OPENAI_API_KEY`: OpenAI API密钥，可选
- `OPENROUTER_API_KEY`: OpenRouter API密钥，可选
- `LOCAL_MODEL_URL`: 本地模型服务地址，支持自定义URL配置
- `PORT`: 服务器端口，默认5757

### 启动服务

```bash
# 终端 1: 启动后端 (端口 5757)
cd server && npm run dev

# 终端 2: 启动前端 (端口 5173)
cd client && npm run dev
```

- 前端: http://localhost:5173
- 后端: http://localhost:5757 (健康检查: GET /api/health)

## 使用指南

### 1. 导入知识

- 上传自定义知识：
  - 在知识检索节点配置面板：粘贴文本或上传多种格式文件（自动解析和分块向量化）。
  - 支持文件格式：TXT、MD、DOCX、PDF、XLSX、CSV、JSON、XML、HTML等12种格式。
  - 智能分块：支持结构化分块、滑动窗口分块，可配置块大小、重叠度等参数。
  - 向量数据库 API: POST /api/vector/upload (multipart form, file 或 text)

### 2. 构建工作流

- **画布操作**:
  - 点击 **+ 新建插件** 添加节点（知识检索、条件分支、LLM、HTTP 请求、直接回复）。
  - 拖拽连接节点（从源句柄到目标）。
  - 点击节点/边查看/编辑配置，按 Delete 删除（起始节点不可删）。
  - 条件分支有多个输出句柄 (if/elif/else)。

- **节点类型**:
  - **开始**: 入口节点，注入 { query } 变量。
  - **条件分支**: 配置 if/elif/else 条件（变量如 query.kb_text，支持 contains/is_empty 等）。输出分支变量 condition.branch。
  - **知识检索**: 配置 topK (默认 3)，支持多种搜索模式（向量搜索、关键词搜索、混合搜索），检索相关片段到 kb_text 变量。
  - **LLM**: 支持多种提供商（Qwen、OpenAI、OpenRouter、本地模型），配置模型、温度、API Key、API URL、system/user prompt (模板: {{query}}, {{kb_text}}, {{http_text}}, {{llm_text_节点ID}})。输出 llm_text_节点ID。
  - **数据分析**: 智能数据分析插件，支持多种LLM提供商，提供分析建议和可视化图表（柱状图、折线图、饼图），支持流式输出，支持多种文件格式上传和智能解析。
  - **HTTP 请求**: 配置方法/URL/headers/body (支持 {var} 替换)，支持多种鉴权方式，输出 http_data/http_text。
  - **直接回复**: 模式 (LLM 输出 或 模板 {{llm_text}}/{{query}} 等)，设置最终 answer。

- **运行工作流**:
  - 在 **输入** 标签输入问题，点击 **发送**。
  - 流从开始节点执行，支持异步节点顺序。
  - 输出显示在聊天历史；**输出** 标签显示原始 answer。

### 3. 示例工作流

默认初始流：
- 开始 → 条件 (query 包含 "技术"?) → [是: 知识检索 → LLM → 直接回复] / [否: 直接回复(Else)]

扩展示例：
- 添加 HTTP 节点调用外部 API (e.g., URL: https://api.example.com/{user_id})。
- 多 LLM: 第一个 LLM 输出到变量，第二个 prompt 使用 {{llm_text_first}}。
- 数据分析工作流：开始 → 数据分析 → 直接回复，用于分析数据并生成可视化图表。
- 文件分析工作流：上传Excel/PDF文件到数据分析节点 → 智能解析 → 生成分析报告和图表。

### 4. HTTP请求插件使用

HTTP请求插件支持多种鉴权方式和高级配置，适用于各种API调用场景：

#### 支持的鉴权方式

- **无鉴权**: 直接访问公开API
- **Bearer Token**: 在Authorization头中添加Bearer token
- **API Key**: 支持Header、Query参数、Body三种位置
- **Basic Auth**: 用户名密码基础认证
- **OAuth2.0**: 直接使用Access Token（需预先获取）
- **自定义鉴权**: 自定义Header配置

#### 配置示例

**Bearer Token认证**:
```
URL: http://127.0.0.1:8000/secret
鉴权方式: Bearer Token
Token: mysecrettoken
```

**API Key认证**:
```
URL: http://localhost:8000/api-key-query
鉴权方式: API Key
API Key: sk-1234567890abcdef
Key位置: Query Parameter
Key名称: api_key
```

**OAuth2.0认证**:
```
URL: http://localhost:8000/oauth/protected
鉴权方式: OAuth2.0
Access Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### 高级功能

- **变量替换**: 支持在URL、Headers、Body中使用 `{{变量名}}` 进行动态替换
- **测试功能**: 内置"发送请求"按钮，可实时测试配置
- **响应处理**: 自动解析JSON响应，支持文本和二进制数据
- **错误处理**: 详细的错误信息和状态码显示

### 5. 数据分析插件使用

数据分析插件支持多种LLM提供商，提供智能数据分析功能：

- **配置选项**：
  - API提供商：Qwen、OpenAI、OpenRouter、本地模型
  - 模型选择：根据提供商自动推荐模型
  - 温度设置：控制分析结果的创造性（0-1）
  - 问题模板：自定义分析问题模板

- **文件上传功能**：
  - 支持多种文件格式：XLSX、CSV、JSON等
  - 自动文件解析：智能提取文件内容并转换为表格格式
  - 结构化数据处理：支持CSV、Excel等结构化数据的直接分析
  - 文本内容分析：支持文档、网页等非结构化内容的智能分析
  - 元数据提取：自动提取文件类型、结构信息等元数据

- **输出格式**：
  - 分析结论：Markdown格式的分析文本
  - 可视化图表：自动生成柱状图、折线图、饼图
  - 数据表格：结构化的数据展示
  - 文件信息：显示上传文件的类型、大小、处理状态等

- **环境变量配置**：
  - 本地模型URL可通过 `LOCAL_MODEL_URL` 环境变量配置
  - 支持自定义API Key和API URL

### 6. 用户认证系统

AI-Flow 提供完整的用户认证系统，支持多用户环境下的工作流管理：

#### 用户注册与登录

- **注册功能**：
  - 用户名、邮箱、密码注册
  - 密码确认验证
  - 用户名和邮箱唯一性检查
  - 密码加密存储（bcryptjs）

- **登录功能**：
  - 用户名/密码登录
  - JWT令牌认证（7天有效期）
  - 自动登录状态保持
  - 安全的登出功能

#### 权限管理

- **工作流隔离**：每个用户只能访问自己的工作流
- **数据安全**：知识库、文档等数据按用户隔离
- **API保护**：需要认证的API自动验证JWT令牌

#### 使用流程

1. **首次使用**：访问系统会自动跳转到登录界面
2. **注册账户**：点击"注册"创建新账户
3. **登录系统**：使用用户名和密码登录
4. **工作流管理**：登录后可以创建、编辑、管理个人工作流
5. **安全登出**：点击登出按钮安全退出系统

### 7. 向量数据库增强功能

AI-Flow 的向量数据库系统经过全面升级，提供更强大的知识库管理能力：

#### 支持的文件格式

- **文本文件**: `.txt`, `.md` - 纯文本和Markdown文档
- **Microsoft Office**: `.docx`, `.doc` - Word文档（新旧版本）
- **PDF文档**: `.pdf` - 可提取文本内容
- **Excel表格**: `.xlsx`, `.xls` - 支持多工作表解析
- **数据文件**: `.csv` - 结构化数据解析
- **JSON文件**: `.json` - 结构化数据存储
- **网页文件**: `.html`, `.htm` - HTML内容提取
- **XML文档**: `.xml` - 结构化标记语言

#### 智能分块策略

- **结构化分块**: 优先按段落和句子分割，保持文档结构完整性
- **滑动窗口分块**: 智能边界检测，避免截断重要信息
- **混合分块**: 结合多种策略，自动选择最佳分块方法
- **可配置参数**: 支持自定义块大小、重叠度、最大块数等

#### 增强搜索功能

- **多种搜索模式**:
  - 向量搜索：基于语义相似度的智能检索
  - 关键词搜索：基于文本匹配的精确查找
  - 混合搜索：结合向量和关键词的优势
- **智能重排序**: 基于文本长度、关键词匹配等综合评分
- **查询扩展**: 自动生成相关查询，提高召回率
- **搜索建议**: 提供查询优化和纠错建议

#### 文件解析与元数据

- **统一解析接口**: 所有文件格式使用相同的解析流程
- **元数据提取**: 自动提取文件结构信息（如Excel工作表、PDF页数等）
- **错误处理**: 完善的错误处理和回退机制
- **文件统计**: 详细的文件信息和处理统计

#### 使用示例

**上传多种格式文件**:
```javascript
// 上传PDF文件
const formData = new FormData();
formData.append('file', pdfFile);
formData.append('chunkOptions', JSON.stringify({
  chunkSize: 1000,
  overlap: 150,
  preserveStructure: true
}));

const response = await fetch('/api/vector/upload', {
  method: 'POST',
  body: formData
});
```

**混合搜索**:
```javascript
const searchResponse = await fetch('/api/vector/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: '人工智能应用',
    searchType: 'hybrid',
    topK: 10,
    options: {
      threshold: 0.5,
      rerank: true,
      expandQuery: true
    }
  })
});
```

### 8. 聊天与历史

- 支持连续对话，历史保存在前端状态。
- 清除记录按钮重置历史。
- 加载中显示 "正在思考中..."。

## 项目结构

- **根目录**:
  - `.gitignore`: 忽略 node_modules 等。
  - `LICENSE`: 项目许可。
  - `package-lock.json`: 依赖锁定。
  - `README.md`: 本文档。

- **client/**: React 前端 (Vite + TypeScript + React Flow)。
  - `package.json`: 依赖 (reactflow, @types 等)，脚本: `npm run dev`。
  - `src/App.tsx`: 主组件，认证状态管理、视图切换、工作流管理。
  - `src/Auth.tsx`: 用户认证组件，登录/注册界面。
  - `src/WorkflowDashboard.tsx`: 工作流仪表板，工作流列表和管理。
  - `src/WorkflowEditor.tsx`: 工作流编辑器，节点配置和执行。
  - `src/WorkflowManager.tsx`: 工作流管理组件。
  - `src/WorkflowCard.tsx`: 工作流卡片组件。
  - `src/main.tsx`: 入口，渲染 App。
  - `src/styles.css`: 样式 (节点卡片、面板、认证界面等)。
  - `index.html`: HTML 模板。
  - `vite.config.ts`: Vite 配置 (端口 5173)。
  - `_1 后缀文件`: 备份版本 (e.g., package_1.json)，可忽略。

- **server/**: Express 后端。
  - `package.json`: 依赖 (express, cors, multer, node-fetch, dotenv, better-sqlite3, mammoth, pdf-parse, xlsx, csv-parser)，脚本: `npm run dev` (nodemon)。
  - `src/index.js`: 主服务器，路由:
    - `/api/auth/*`: 用户认证 (注册/登录/JWT验证)。
    - `/api/workflows/*`: 工作流管理 (创建/读取/更新/删除)。
    - `/api/vector/*`: 向量数据库管理 (上传/搜索/文件管理/统计/格式支持)。
    - `/api/chat`: LLM 调用 (Qwen/OpenAI/OpenRouter/本地模型)。
    - `/api/chat-stream`: LLM 流式调用。
    - `/api/analysis`: 数据分析调用。
    - `/api/analysis-stream`: 数据分析流式调用。
    - `/api/http-request`: 代理 HTTP (变量替换，支持多种鉴权方式)。
    - `/api/oauth2/token`: OAuth2.0 令牌获取。
    - `/api/config`: 获取服务器配置信息。
    - `/api/health`: 健康检查。
  - `src/vectorDB.js`: SQLite3 向量数据库类，支持文档存储、相似性搜索。
  - `src/fileParser.js`: 文件解析器，支持多种文件格式解析和智能分块。
  - `src/enhancedVectorSearch.js`: 增强向量搜索，支持多种搜索模式和智能纠错。
  - `vector_knowledge.db`: SQLite3 数据库文件 (自动创建)。
  - `uploads/`: 临时文件目录 (multer)。

## API 参考

### 用户认证 API
- **POST /api/auth/register**: { username, email, password } → { message, token, user }
- **POST /api/auth/login**: { username, password } → { message, token, user }

### 工作流管理 API
- **GET /api/workflows**: (需要认证) → { workflows: [...] }
- **POST /api/workflows**: (需要认证) { name, nodes, edges } → { workflowId, message }
- **GET /api/workflows/:id**: (需要认证) → { workflow: {...} }
- **PUT /api/workflows/:id**: (需要认证) { name, nodes, edges } → { message }
- **DELETE /api/workflows/:id**: (需要认证) → { message }

### 向量数据库 API
- **POST /api/vector/upload**: multipart (file) 或 { text, filename, chunkOptions } → { ok, fileId, filename, fileType, metadata, inserted, total, results }
- **POST /api/vector/search**: { query, topK, searchType, options } → { matches: [{id, text, similarity, metadata}], suggestions, searchType, totalResults }
- **GET /api/vector/files**: → { files: [{id, filename, file_size, file_type, chunk_count, created_at}] }
- **GET /api/vector/files/:filename**: → { documents: [{id, filename, chunk_index, chunk_text, ...}] }
- **DELETE /api/vector/files/:filename**: → { ok, filename, docsDeleted, fileDeleted }
- **GET /api/vector/documents**: → { documents: [{id, filename, chunk_index, chunk_text, ...}] }
- **GET /api/vector/stats**: → { stats: {totalDocuments, totalFiles, totalSize}, searchStats, supportedFormats }
- **GET /api/vector/formats**: → { supportedFormats, formatDetails }
- **GET /api/vector/search-history**: → { totalSearches, averageResults, topQueries }
- **POST /api/vector/parse-test**: multipart (file) → { success, filename, fileType, content, metadata, contentLength }

### 其他 API
- **POST /api/chat**: { messages, model, temperature, apiKey?, apiUrl?, provider } → OpenAI 格式响应。
- **POST /api/chat-stream**: { messages, model, temperature, apiKey?, apiUrl?, provider } → SSE 流式响应。
- **POST /api/analysis**: { apiUrl, apiKey, question, provider, model, temperature } → 数据分析结果。
- **POST /api/analysis-stream**: { apiUrl, apiKey, question, provider, model, temperature } → SSE 流式数据分析。
- **POST /api/http-request**: { method, url, headers, body, variables, auth, advanced } → { status_code, content, json }
- **POST /api/oauth2/token**: { clientId, clientSecret, tokenUrl, scope?, grantType? } → { access_token, token_type, expires_in }
- **GET /api/config**: → { localModelUrl, providers } 服务器配置信息。
- **GET /api/health**: → { ok: true }

所有 API 使用 POST，JSON body，CORS 启用。

## 开发与自定义

- **添加节点**: 在 App.tsx 的 createNewNode 函数扩展类型/配置。
- **扩展后端**: index.js 添加新路由 (e.g., 更多数据库集成)。
- **样式**: 修改 styles.css 自定义节点主题 (theme-blue 等)。
- **环境**: 前端 LLM 配置可覆盖后端 .env (per-node API key)。

### 常见问题

- **API Key 无效**: 检查 Qwen 控制台配额，确保兼容模式启用。
- **嵌入失败**: 文本过长? 自动分块；文件 >2MB 拒绝。
- **数据库连接错误**: 确保 SQLite3 数据库文件权限正确，better-sqlite3 依赖已安装。
- **向量搜索无结果**: 检查是否已上传文档到向量数据库，使用 `/api/vector/stats` 查看统计信息。
- **文件格式不支持**: 确保上传的文件格式在支持列表中，使用 `/api/vector/formats` 查看支持的格式。
- **文件解析失败**: 检查文件是否损坏，尝试使用 `/api/vector/parse-test` 测试文件解析。
- **搜索结果不准确**: 尝试调整搜索参数，使用混合搜索模式，或调整相似度阈值。
- **跨域错误**: 确保前端代理或 CORS 配置正确 (默认启用)。
- **节点不执行**: 检查边连接；条件分支需匹配 sourceHandle (if/else)。
- **端口冲突**: 确保后端运行在 5757 端口，前端代理配置正确。
- **本地模型连接失败**: 检查 `LOCAL_MODEL_URL` 环境变量配置，确保本地模型服务正在运行。
- **数据分析无结果**: 检查LLM提供商配置，确保API Key和模型设置正确。
- **图表不显示**: 确保数据分析结果包含表格数据，检查Markdown表格格式。
- **文件上传失败**: 检查文件格式是否支持，确保文件大小不超过2MB，检查文件是否损坏。
- **文件解析错误**: 尝试使用 `/api/vector/parse-test` 测试文件解析，检查文件格式是否正确。
- **数据分析结果不准确**: 检查上传的文件内容是否完整，尝试调整问题模板以获得更好的分析结果。
- **HTTP请求失败**: 检查鉴权配置是否正确，确保API Key、Token等凭据有效。
- **OAuth2认证失败**: 确保Access Token有效且未过期，检查Token格式是否正确。
- **用户认证失败**: 检查用户名和密码是否正确，确保JWT令牌未过期。
- **工作流访问被拒绝**: 确保已正确登录，检查工作流是否属于当前用户。
- **注册失败**: 检查用户名和邮箱是否已被使用，确保密码符合要求。

## 参考与贡献

- **Qwen API**: [阿里云百炼文档](https://bailian.console.aliyun.com/#/api) (OpenAI 兼容 + 嵌入)。
- **React Flow**: [文档](https://reactflow.dev/) 用于高级节点/边自定义。
- **依赖**: 前端 ~200MB node_modules；后端轻量，SQLite3 数据库文件自动创建。
- **SQLite3**: 使用 better-sqlite3 提供高性能本地数据库存储。
- 欢迎 PR！焦点：更多节点类型 (e.g., 数据库集成)、流式响应、向量索引优化。

项目灵感来源于 Dify/RAG 工具，目标是轻量、可扩展的本地 AI 工作流。
