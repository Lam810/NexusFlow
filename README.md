# AI-Flow: 高度自定义的 AI 工作流构建器

AI-Flow 是一个最小化工作流工具，使用 React Flow 实现可视化节点编辑器，前端基于 React + Vite，后端基于 Express.js。支持知识检索（RAG）、LLM 对话、条件分支、HTTP 请求等节点，构建复杂 AI 管道。

## 特性

- **可视化工作流**: 使用 React Flow 拖拽节点、连接边，构建自定义 AI 流程。
- **知识库管理**: 使用 SQLite3 持久化存储文本嵌入（使用 Qwen text-embedding-v3），支持文件/文本上传、余弦相似度检索、文件管理。
- **LLM 集成**: 支持 Qwen（阿里云百炼）和 OpenAI 兼容的聊天完成，模板化提示词。
- **条件分支**: 基于变量的 if/elif/else 逻辑，支持多种运算符（包含、等于、空值等）。
- **HTTP 请求**: 代理外部 API 调用，支持变量替换、JSON/文本 body。
- **直接回复**: 使用 LLM 输出或模板渲染最终答案。
- **聊天界面**: 运行工作流后显示历史对话，支持导入示例知识。
- **持久化存储**: SQLite3 数据库存储向量嵌入，支持文件管理、统计查询，文本分块（800 字符，100 重叠），文件大小限 500KB。

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
  ```
  QWEN_API_KEY=sk-your-api-key-here
  PORT=5757
  ```

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
  - 在知识检索节点配置面板：粘贴文本或上传 .txt 文件（自动分块向量化）。
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
  - **知识检索**: 配置 topK (默认 3)，检索相关片段到 kb_text 变量。
  - **LLM**: 配置模型 (qwen-plus)、温度、system/user prompt (模板: {{query}}, {{kb_text}}, {{http_text}}, {{llm_text_节点ID}})。输出 llm_text_节点ID。
  - **HTTP 请求**: 配置方法/URL/headers/body (支持 {var} 替换)，输出 http_data/http_text。
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

### 4. 聊天与历史

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
  - `src/App.tsx`: 主组件，节点渲染、配置面板、工作流执行逻辑。
  - `src/main.tsx`: 入口，渲染 App。
  - `src/index.js`: 可能为旧入口 (可忽略)。
  - `src/styles.css`: 样式 (节点卡片、面板等)。
  - `index.html`: HTML 模板。
  - `vite.config.ts`: Vite 配置 (端口 5173)。
  - `_1 后缀文件`: 备份版本 (e.g., package_1.json)，可忽略。

- **server/**: Express 后端。
  - `package.json`: 依赖 (express, cors, multer, node-fetch, dotenv, better-sqlite3)，脚本: `npm run dev` (nodemon)。
  - `src/index.js`: 主服务器，路由:
    - `/api/vector/*`: 向量数据库管理 (上传/搜索/文件管理/统计)。
    - `/api/chat`: LLM 调用 (Qwen/OpenAI 兼容)。
    - `/api/http-request`: 代理 HTTP (变量替换)。
    - `/api/health`: 健康检查。
  - `src/vectorDB.js`: SQLite3 向量数据库类，支持文档存储、相似性搜索。
  - `vector_knowledge.db`: SQLite3 数据库文件 (自动创建)。
  - `uploads/`: 临时文件目录 (multer)。

## API 参考

### 向量数据库 API
- **POST /api/vector/upload**: multipart (file) 或 { text, filename } → { ok, fileId, filename, inserted, total, results }
- **POST /api/vector/search**: { query, topK } → { matches: [{id, text, similarity}] }
- **GET /api/vector/files**: → { files: [{id, filename, file_size, file_type, chunk_count, created_at}] }
- **GET /api/vector/files/:filename**: → { documents: [{id, filename, chunk_index, chunk_text, ...}] }
- **DELETE /api/vector/files/:filename**: → { ok, filename, docsDeleted, fileDeleted }
- **GET /api/vector/documents**: → { documents: [{id, filename, chunk_index, chunk_text, ...}] }
- **GET /api/vector/stats**: → { stats: {totalDocuments, totalFiles, totalSize} }

### 其他 API
- **POST /api/chat**: { messages, model, temperature, apiKey?, apiUrl?, provider } → OpenAI 格式响应。
- **POST /api/http-request**: { method, url, headers, body, variables } → { status_code, content, json }
- **GET /api/health**: → { ok: true }

所有 API 使用 POST，JSON body，CORS 启用。

## 开发与自定义

- **添加节点**: 在 App.tsx 的 createNewNode 函数扩展类型/配置。
- **扩展后端**: index.js 添加新路由 (e.g., 更多数据库集成)。
- **样式**: 修改 styles.css 自定义节点主题 (theme-blue 等)。
- **环境**: 前端 LLM 配置可覆盖后端 .env (per-node API key)。

### 常见问题

- **API Key 无效**: 检查 Qwen 控制台配额，确保兼容模式启用。
- **嵌入失败**: 文本过长? 自动分块；文件 >500KB 拒绝。
- **数据库连接错误**: 确保 SQLite3 数据库文件权限正确，better-sqlite3 依赖已安装。
- **向量搜索无结果**: 检查是否已上传文档到向量数据库，使用 `/api/vector/stats` 查看统计信息。
- **跨域错误**: 确保前端代理或 CORS 配置正确 (默认启用)。
- **节点不执行**: 检查边连接；条件分支需匹配 sourceHandle (if/else)。
- **端口冲突**: 确保后端运行在 5757 端口，前端代理配置正确。

## 参考与贡献

- **Qwen API**: [阿里云百炼文档](https://bailian.console.aliyun.com/#/api) (OpenAI 兼容 + 嵌入)。
- **React Flow**: [文档](https://reactflow.dev/) 用于高级节点/边自定义。
- **依赖**: 前端 ~200MB node_modules；后端轻量，SQLite3 数据库文件自动创建。
- **SQLite3**: 使用 better-sqlite3 提供高性能本地数据库存储。
- 欢迎 PR！焦点：更多节点类型 (e.g., 数据库集成)、流式响应、向量索引优化。

项目灵感来源于 Dify/RAG 工具，目标是轻量、可扩展的本地 AI 工作流。
