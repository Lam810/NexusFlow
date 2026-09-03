<div align="center">

<h1><img src="showcase/assets/nexusflow-mark.svg" width="38" height="38" alt="NexusFlow logo" /> NexusFlow</h1>

**A visual workflow studio for assistant-style AI pipelines.**
Drag-and-drop intent routing, retrieval, tool calls, and model orchestration — prototyped for AI PC / HarmonyOS-style assistants.

**Live App:** [nexusflow-rose.vercel.app](https://nexusflow-rose.vercel.app) · **Product Showcase:** [wwwwwkkkkkk7777.github.io/nexusflow](https://wwwwwkkkkkk7777.github.io/nexusflow/)

[![License: MIT](https://img.shields.io/badge/License-MIT-informational.svg)](LICENSE)
[![CI](https://github.com/Lam810/NexusFlow/actions/workflows/ci.yml/badge.svg)](https://github.com/Lam810/NexusFlow/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-React%20%2B%20Node-3178c6.svg)](client/package.json)
[![Status](https://img.shields.io/badge/status-developer%20prototype-f2a65a.svg)](#prototype-status)
[![Live Demo](https://img.shields.io/badge/live%20demo-Vercel-00c7c7.svg)](https://nexusflow-rose.vercel.app)
[![Product Site](https://img.shields.io/badge/product%20site-GitHub%20Pages-ff8a4c.svg)](https://wwwwwkkkkkk7777.github.io/nexusflow/)

</div>

---

NexusFlow is a visual workflow studio for building assistant-style AI pipelines. It was refactored as a public, desensitized prototype for demonstrating how an AI PC or HarmonyOS-style assistant can connect user intent, local knowledge, model inference, tool calls, and structured responses.

The project is not an official HarmonyOS application and does not include proprietary platform APIs. It focuses on the orchestration layer that can sit behind an OS-level assistant: intent routing, retrieval, LLM calls, tool execution, data analysis, and user-scoped workflow management.

> [!IMPORTANT]
> NexusFlow is a developer prototype, not a production desktop automation product. The Local Runtime is intentionally launched from Node.js, application integrations are declarative manifests, and sensitive actions require a web approval. Review the security model and adapt authentication, retention, monitoring, and recovery policies before using it with real personal or business data.

## Prototype Status

Explore the [NexusFlow product site](https://wwwwwkkkkkk7777.github.io/nexusflow/) or open the hosted build at [nexusflow-rose.vercel.app](https://nexusflow-rose.vercel.app). Public registration is enabled on the current hosted build; self-hosted operators can control it with `ALLOW_REGISTRATION`.

| Area | Current prototype scope |
| --- | --- |
| Workflow studio | Visual authoring, browser execution, workflow persistence, and manual dispatch |
| Model configuration | Per-user OpenAI-compatible chat and embedding settings with encrypted API keys |
| Local Runtime | Outbound-only Node.js worker with device pairing and node-level traces |
| Local capabilities | System information, allowlisted text files, and manifest-defined application actions |
| Human approval | Allow once, always allow, deny, revoke, timeout, and account/device-scoped audit records |
| Intentional boundary | No arbitrary shell, native desktop installer, background OS service, or proprietary device API |

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
- Static knowledge base with local libSQL or Turso Cloud storage and file parsing.
- Dynamic knowledge API hook for near-real-time retrieval experiments.
- Multi-provider model routing for Qwen-compatible APIs, OpenAI-compatible APIs, OpenRouter, and local model endpoints.
- Streaming chat and analysis responses.
- HttpOnly JWT session authentication with user-scoped workflow and knowledge isolation.
- File ingestion for text, Markdown, DOCX, PDF, XLSX, CSV, JSON, XML, and HTML.
- HTTP tool node with variable substitution, retries, timeout settings, and common authentication modes.
- Local Runtime device pairing, outbound-only task polling, and node-level execution traces.
- Guarded AI PC actions for system information and allowlisted text-file reads/writes; arbitrary shell execution is intentionally unavailable.
- Local application adapters with fixed executable manifests, per-capability approval, reusable grants, and an auditable permission inbox.

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
  libSQL/Turso data access and file parsing
  HTTP tool proxy
  Authentication layer

runtime/
  Dependency-free Node.js agent
  Device token client and job poller
  Guarded local capability executors
  Local application adapter registry
  Permission approval polling
  Node-level trace reporter
```

Typical execution flow:

```text
User request
  -> Vercel/Turso task queue
  -> Local Runtime claims over outbound HTTPS
  -> Sensitive actions pause for an allow-once / always-allow / deny decision
  -> Start / condition / LLM / guarded device nodes
  -> Per-node traces sent back to NexusFlow
  -> Response and run history
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

- Node.js 20.19+ or 22.13+
- npm 9+
- Optional: a Qwen-compatible, OpenAI-compatible, OpenRouter, or local model endpoint

### Install

```bash
git clone https://github.com/Lam810/NexusFlow.git
cd NexusFlow
npm run setup
```

### Configure

Copy the example environment file (`copy` on Windows, `cp` on macOS/Linux):

```bash
copy server\.env.example server\.env
```

Generate two unique secrets with at least 32 characters: one for sessions and a separate one for encrypting saved user model keys. Never commit `.env`.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```env
QWEN_API_KEY=
OPENAI_API_KEY=
OPENROUTER_API_KEY=
LOCAL_MODEL_URL=http://localhost:8000/v1/chat/completions
KNOWLEDGE_API_URL=http://localhost:5000
JWT_SECRET=replace-with-the-generated-value
MODEL_CONFIG_ENCRYPTION_KEY=replace-with-a-different-generated-value
PORT=5757
HOST=127.0.0.1
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

The server refuses to start with an unsafe `JWT_SECRET`. Production also requires a distinct, stable `MODEL_CONFIG_ENCRYPTION_KEY`. After signing in, use **模型设置** to configure any service implementing the OpenAI-compatible `/chat/completions` API; vector features can additionally use `/embeddings`.

### Run

Start the backend and frontend in separate terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Open:

```text
http://localhost:5173
```

For a local production preview, run the backend and then `npm run build && npm run preview`. The preview server proxies `/api` to the backend. For an actual deployment, serve the built client and `/api` behind the same origin (or configure an equivalent reverse proxy) so the browser CSP and API routing remain intact.

For an Internet-facing Vercel deployment with Turso persistence, Upstash rate limiting, HttpOnly sessions, and first-account setup, follow [DEPLOYMENT.md](DEPLOYMENT.md).

### Run the models on an Ascend NPU

NexusFlow reaches models only over the OpenAI-compatible HTTP API, so it needs no
code changes to run against Huawei Ascend hardware — but the surrounding setup has
three requirements that are easy to miss. The following was verified on an
**Ascend 910C** (2 dies per card, 64 GB HBM per die, CANN 8.5.0, aarch64).

**1. Build vLLM from source.** The prebuilt wheel pins `torch==2.8.0` while
`vllm-ascend` pins `torch==2.7.1`, so installing it replaces the torch that
`torch-npu` needs:

```bash
export VLLM_TARGET_DEVICE=empty
git clone -b v0.11.0 --depth 1 https://github.com/vllm-project/vllm.git
pip install -e ./vllm --no-build-isolation
pip install vllm-ascend==0.11.0
pip install "setuptools<80"      # torch-npu imports pkg_resources, removed in 81

source /usr/local/Ascend/ascend-toolkit/set_env.sh
source /usr/local/Ascend/nnal/atb/set_env.sh   # NNAL/ATB is required, not optional
```

`vllm-ascend` calls `_register_atb_extensions()` unconditionally, so without
`libatb.so` the engine dies during worker init rather than falling back.

**2. Serve chat and embeddings behind one base URL.** The vector features need
`/embeddings`, and the server reads both from a single stored base URL, so the two
models have to answer on the same origin. A vLLM process serves one model, so run
two and put an OpenAI-compatible router (LiteLLM, or a reverse proxy) in front:

```bash
# chat
vllm serve /path/to/Qwen2.5-7B-Instruct \
  --served-model-name qwen2.5-7b-instruct \
  --port 8000 --max-model-len 4096

# embeddings - note --enforce-eager
vllm serve /path/to/gte-base-zh \
  --served-model-name gte-base-zh --task embed \
  --port 8001 --max-model-len 512 --enforce-eager
```

`--enforce-eager` is required for the embedding model, not a precaution: BERT-style
encoders fail ACL graph capture with `Cannot run aclop operators during NPU graph
capture. Current working aclop is Fill`, and the engine exits. Decoder models
capture fine and do not need it.

**3. Allow private-network requests.** A base URL saved through **模型设置** is
treated as user-supplied and stays subject to the SSRF guard, so a local address is
rejected until you opt in:

```env
ALLOW_PRIVATE_NETWORK_REQUESTS=true
```

Only an endpoint exactly matching `LOCAL_MODEL_URL` is exempt automatically, and
that path carries no embedding model. Leave the flag `false` on any instance whose
model endpoint is not on your own network — it is what stops a saved base URL from
reaching internal addresses.

Then in **模型设置**, set the base URL to the router's `/v1` root (not
`/v1/chat/completions`), the chat model to the served chat name, and the embedding
model to the served embedding name. vLLM matches on `--served-model-name` and
returns 404 for a model directory or HuggingFace ID.

### Run workflows on an AI PC

Open **运行记录** in the dashboard and choose **配对设备**. NexusFlow displays a device token once and generates the PowerShell commands for the current deployment. On the cloned AI PC, the essential configuration is:

```powershell
$env:NEXUSFLOW_URL="https://your-project.vercel.app"
$env:NEXUSFLOW_DEVICE_TOKEN="nfr_token-shown-once"
$env:NEXUSFLOW_ALLOWED_DIRS="D:\NexusFlowData"
$env:NEXUSFLOW_ADAPTERS_FILE="D:\NexusFlow\runtime\adapters.json"
npm --prefix runtime start
```

The Runtime only makes outbound HTTPS requests, stores no model API key, and exposes no local listening port. Standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables are honored automatically for corporate or filtered networks. `system.info` is available without approval. File and application actions pause in the permission approval center; file writes additionally require `$env:NEXUSFLOW_ALLOW_WRITES="true"`. See [runtime/README.md](runtime/README.md) for adapter manifests, macOS/Linux syntax, supported nodes, and the security model.

### Upgrading an existing database

Back up `server/vector_knowledge.db` (or the file configured by `DATABASE_PATH`) before the first start with this version. The libSQL driver can continue using an existing SQLite file locally. Startup adds tenant columns and removes literal credentials from stored workflows. Legacy documents, files, chat records, and dynamic knowledge without an owner remain unassigned and therefore invisible to all users; re-import them under the intended account instead of assigning them automatically. A new Turso deployment starts with a separate cloud database, so local records are not uploaded automatically.

## Main Nodes

- Start: injects the user request.
- Condition: routes requests with keyword or semantic matching.
- Knowledge Retrieval: retrieves relevant chunks from the local knowledge base.
- LLM: calls a local or cloud model with templated prompts.
- HTTP Request: calls external tools or services with variable substitution.
- Data Analysis: turns uploaded tables or documents into analysis outputs.
- Response: renders the final answer from LLM output or templates.
- Device Capability: asks a paired Local Runtime to read system information, access an allowlisted text file, or invoke a locally declared app adapter; sensitive actions require an exact-capability approval.

## Security Notes

- All `/api` routes require authentication except health, login, and registration.
- Workflow, vector, knowledge, dynamic-context, and chat-history data are scoped to the authenticated user.
- HTTP and model proxy calls block private/reserved network targets by default, validate redirects, enforce timeouts, and cap buffered responses. Set `ALLOW_PRIVATE_NETWORK_REQUESTS=true` only for a trusted local deployment that intentionally calls private services.
- Workflow saves scrub literal credential fields while preserving runtime references such as `{{runtime_secret}}`. Account-level model API keys are encrypted at rest, never returned to the browser, and take precedence over legacy per-node or server fallback settings.
- Browser access is restricted by `CORS_ORIGINS`. The server binds to `127.0.0.1` by default, and legacy database pages are disabled unless `ENABLE_LEGACY_ADMIN=true`; do not enable them on a network-exposed instance.
- Local uploads are limited to one 20 MB file in the documented formats; Vercel deployments cap requests at 4,000,000 bytes. Review parser and retention requirements before processing untrusted or sensitive documents.
- The Vercel deployment uses platform TLS, Turso persistence, and Upstash distributed rate limiting. Operators still need provider backups, monitoring, account policy, log-retention controls, and incident response.
- Runtime device tokens are shown once and stored server-side only as SHA-256 hashes. Revoking a device invalidates its token. The Runtime has no shell node, does not receive saved model keys, restricts files to configured real paths, and defaults to read-only access. Application adapters pin an executable and argument template in a local manifest; allow-once, always-allow, deny, revoke, and audit records are isolated by account and paired device.

See [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Quality Checks

Run the same checks used in CI:

```bash
npm run check
npm run audit
```

The suite covers server syntax, security helpers, tenant isolation, Runtime token/job/trace boundaries, local path enforcement, API authentication and workflow ownership, client type checking, linting, and the production build.

See [CHANGELOG.md](CHANGELOG.md) for the current prototype changes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Roadmap

- Add reusable assistant templates for document QA, app operation, and productivity workflows.
- Add durable schedules and cancellation acknowledgement for Local Runtime jobs.
- Add local model presets for edge-device and AI PC experiments.
- Add OS-native consent overlays and signed adapter packages for deeper desktop integration.
- Improve mobile and tablet layouts for touch-first usage.

## License

MIT
