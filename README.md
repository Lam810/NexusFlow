# Dify-like minimal workflow (React Flow + Express)

## 快速开始

```bash
# Windows PowerShell
cd server; npm i; cd ..
cd client; npm i; cd ..
```

### 配置环境变量

- 复制 `server/.env.example` 为 `server/.env`
- 将 `QWEN_API_KEY` 设置为你的 API 钥匙
- （你给的是：`sk-a14dcee56184459d9d5eab7a65af3f3f`）这个你不用修改

### 启动服务

```bash
# 终端 1
cd server; npm run dev

# 终端 2
cd client; npm run dev
```

- 前端: http://localhost:5173
- 后端: http://localhost:8787

## 使用

- 点击“导入示例知识”导入两条样例文档（会在后端进行 `text-embedding-v3` 向量化并存入内存库）。
- 输入问题，点击“运行工作流”。节点顺序为：`开始` → `知识检索` → `LLM` → `直接回复`。
- LLM 通过 Qwen 兼容 OpenAI Chat Completions 接口，知识检索通过 `text-embedding-v3` 生成向量并使用余弦相似度检索。

## 项目结构

- **.gitignore**: 忽略不必要的文件，如 `node_modules/` 和构建产物。
- **README.md**: 项目文档和使用说明。
- **client/**: 前端 React 应用，使用 Vite 构建和 React Flow 实现工作流可视化。
  - **package.json**: 前端依赖和脚本配置（`npm run dev` 启动开发服务器）。
  - **src/index.js**: 前端主入口文件，渲染 React 应用。
  - **index.html**: HTML 模板文件。
  - **vite.config.ts**: Vite 构建工具配置。
  - **_1 后缀文件** (如 `package_1.json`, `index_1.html`): 备份或先前版本文件，可忽略。
- **server/**: 后端 Express.js 服务器，提供 API 接口。
  - **package.json**: 后端依赖和脚本配置（`npm run dev` 启动开发服务器）。
  - **src/index.js**: 后端主入口文件，设置 Express 路由和 Qwen API 集成。
- **根目录 package-lock.json**: NPM 锁文件，用于依赖版本锁定（可选，用于 monorepo 管理）。

## 参考

- 阿里云百炼 API 控制台（OpenAI 兼容模式 & 向量接口）：`https://bailian.console.aliyun.com/?spm=5176.29597918.J_SEsSjsNv72yRuRFS2VknO.2.3a797b08FUnvgF&tab=api#/api`
