# NexusFlow

NexusFlow is a visual workflow studio for building assistant-style AI pipelines. It was refactored as a public, desensitized prototype for demonstrating how an AI PC or HarmonyOS-style assistant can connect user intent, local knowledge, model inference, tool calls, and structured responses.

The project is not an official HarmonyOS application and does not include proprietary platform APIs. It focuses on the orchestration layer that can sit behind an OS-level assistant: intent routing, retrieval, LLM calls, tool execution, data analysis, and user-scoped workflow management.

## Why It Matters

Modern AI assistants need more than a chat box. A practical assistant on a PC, tablet, or edge device must understand a user request, gather relevant context, decide whether to call tools, execute the task with guardrails, and return a verifiable result. NexusFlow provides a lightweight playground for prototyping that loop.

Potential HarmonyOS / AI PC scenarios include:

- Document assistant: retrieve from local files, summarize content, and answer grounded questions.
- App operation assistant: route user intent to predefined tool or HTTP nodes.
- Personal productivity agent: combine user input, knowledge snippets, and model reasoning into task-specific responses.
- Edge-cloud assistant: choose between local model endpoints and cloud model APIs.
- Evaluation sandbox: inspect intermediate node outputs rather than treating the assistant as a black box.

## Features

- Visual workflow editor based on React Flow.
- Node-based pipeline execution with start, condition, retrieval, LLM, HTTP request, data analysis, and response nodes.
- Static knowledge base with SQLite-backed vector storage and file parsing.
- Dynamic knowledge API hook for near-real-time retrieval experiments.
- Multi-provider model routing for Qwen-compatible APIs, OpenAI-compatible APIs, OpenRouter, and local model endpoints.
- Streaming chat and analysis responses.
- User authentication with JWT-based workflow isolation.
- File ingestion for text, Markdown, Word, PDF, Excel, CSV, JSON, XML, and HTML.
- HTTP tool node with variable substitution, retries, timeout settings, and common authentication modes.

## Architecture

```text
client/
  React + Vite application
  Workflow dashboard
  Visual workflow editor
  Node configuration panels

server/
  Express API server
  Workflow CRUD APIs
  LLM and streaming proxy
  Vector database and file parsing
  HTTP tool proxy
  Authentication layer
```

Typical execution flow:

```text
User request
  -> Start node
  -> Intent or condition node
  -> Retrieval / HTTP / analysis tool nodes
  -> LLM node
  -> Response node
```

## Public Demo Positioning

This repository is a sanitized engineering prototype. It intentionally avoids:

- Private business data.
- Production credentials.
- Internal deployment endpoints.
- Customer-specific workflows.
- Proprietary HarmonyOS or device APIs.

For public presentation, the recommended description is:

> NexusFlow is a visual orchestration prototype for AI PC and HarmonyOS-style assistants, supporting retrieval, local/cloud model routing, tool-use workflows, and inspectable execution traces.

## Getting Started

### Requirements

- Node.js 20.19+ or 22.12+
- npm 9+
- Optional: a Qwen-compatible, OpenAI-compatible, OpenRouter, or local model endpoint

### Install

```bash
git clone https://github.com/Lam810/NexusFlow.git
cd NexusFlow

cd server
npm install

cd ../client
npm install
```

### Configure

Copy the example environment file:

```bash
cd server
cp .env.example .env
```

Then add only the keys you need. Do not commit `.env`.

```env
QWEN_API_KEY=
OPENAI_API_KEY=
OPENROUTER_API_KEY=
LOCAL_MODEL_URL=http://localhost:8000/v1/chat/completions
KNOWLEDGE_API_URL=http://localhost:5000
JWT_SECRET=replace-with-a-local-development-secret
PORT=5757
```

### Run

Start the backend:

```bash
cd server
npm run dev
```

Start the frontend:

```bash
cd client
npm run dev
```

Open:

```text
http://localhost:5173
```

## Main Nodes

- Start: injects the user request.
- Condition: routes requests with keyword or semantic matching.
- Knowledge Retrieval: retrieves relevant chunks from the local knowledge base.
- LLM: calls a local or cloud model with templated prompts.
- HTTP Request: calls external tools or services with variable substitution.
- Data Analysis: turns uploaded tables or documents into analysis outputs.
- Response: renders the final answer from LLM output or templates.

## Security Notes

- Keep `.env` private.
- Use test credentials only during local development.
- Do not connect the HTTP node to sensitive internal systems without an allowlist.
- Replace the development `JWT_SECRET` before deployment.
- Review uploaded files before using this project with real user data.

## Roadmap

- Add reusable assistant templates for document QA, app operation, and productivity workflows.
- Add a visible execution trace panel for each node.
- Add local model presets for edge-device and AI PC experiments.
- Add policy checks for tool invocation and sensitive-data handling.
- Improve mobile and tablet layouts for touch-first usage.

## License

MIT
