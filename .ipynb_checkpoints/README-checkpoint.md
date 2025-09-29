# AI minimal workflow (React Flow + Express)

## 快速开始

```bash
# Windows PowerShell
cd server; npm i; cd ..
cd client; npm i; cd ..
```

### 配置环境变量

- 复制 `server/.env.example` 为 `server/.env`
- 将 `QWEN_API_KEY` 设置为你的钥匙（你给的是：`sk-a14dcee56184459d9d5eab7a65af3f3f`）

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

## 参考

- 阿里云百炼 API 控制台（OpenAI 兼容模式 & 向量接口）：`https://bailian.console.aliyun.com/?spm=5176.29597918.J_SEsSjsNv72yRuRFS2VknO.2.3a797b08FUnvgF&tab=api#/api`


