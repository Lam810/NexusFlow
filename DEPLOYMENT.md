# Deploying to Vercel

NexusFlow deploys as one Vercel project: the Vite client is served from Vercel's CDN and the Express application runs as one Node.js Function. Persistent application data uses Turso Cloud, and distributed rate-limit state uses Upstash Redis.

## 1. Requirements

- Node.js 22 and npm.
- A Vercel account and Vercel CLI 47.0.5 or later.
- A Turso Cloud database and an Upstash Redis database. Both can be provisioned from the Vercel Marketplace and have free plans.

The local `DATABASE_PATH` file is for development only. Vercel Functions have an ephemeral file system, so production refuses to start without Turso credentials.

## 2. Link the project

```bash
vercel login
vercel link
```

Use the repository root as the project root. Keep the framework preset as **Other**; `vercel.json` builds the client into `public` and routes `/api/*` to the Express Function in `api/index.js`.

## 3. Provision storage

Run these commands from the linked project directory:

```bash
vercel i tursocloud
vercel i upstash
```

Create and connect one Turso database and one Upstash Redis database to the project. Include Production and Preview environments when the integration asks which environments to connect. The integrations inject:

```text
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

Some Upstash integrations expose `KV_REST_API_URL` and `KV_REST_API_TOKEN` instead; NexusFlow accepts those names too.

## 4. Add application secrets

Generate two independent secrets locally: one for JWT signing and one for encrypting users' saved model API keys.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Add the generated value without committing it:

```bash
vercel env add JWT_SECRET
vercel env add MODEL_CONFIG_ENCRYPTION_KEY
```

Provider secrets are optional fallbacks. Each signed-in user can instead open **模型设置** and save an OpenAI-compatible Base URL, API Key, chat model, and optional embedding model:

```bash
vercel env add QWEN_API_KEY
vercel env add OPENAI_API_KEY
vercel env add OPENROUTER_API_KEY
```

`MODEL_CONFIG_ENCRYPTION_KEY` must remain stable and must differ from `JWT_SECRET`; rotating it without re-encrypting stored values makes existing user API keys unreadable. For the first account, temporarily add `ALLOW_REGISTRATION=true`. Production otherwise defaults to closed registration. When using a custom domain, add its full HTTPS origin as `CORS_ORIGINS`, for example `https://nexusflow.example.com`. Vercel's generated deployment domains are allowed automatically.

Do not set `EXPOSE_AUTH_TOKEN=true`, `ENABLE_LEGACY_ADMIN=true`, or `ALLOW_PRIVATE_NETWORK_REQUESTS=true` on a public deployment. A Vercel Function also cannot reach a model endpoint bound to a developer machine's `localhost`.

## 5. Deploy

Create a preview deployment first:

```bash
vercel
```

After testing login, workflow CRUD, and the provider calls you enabled, publish production:

```bash
vercel --prod
```

Verify the production URL:

```bash
curl --fail --show-error https://your-project.vercel.app/api/health
```

The response should report `ok`, `database`, and `rateLimiter` as `true`.

After creating the first account, change `ALLOW_REGISTRATION` to `false` in Vercel Project Settings and redeploy. Leave it enabled only if the public instance has an account-verification, abuse, moderation, and recovery policy.

## 6. Connect a Local Runtime

The Local Runtime does not run inside Vercel. It runs on the user's AI PC and polls the public deployment over outbound HTTPS, so no router port-forwarding or inbound firewall rule is required.

1. Sign in to the deployed NexusFlow site.
2. Open **运行记录**, choose **配对设备**, and save the one-time token.
3. Start `npm --prefix runtime start` on the cloned local repository with `NEXUSFLOW_URL` and `NEXUSFLOW_DEVICE_TOKEN` configured.
4. Optionally set `NEXUSFLOW_ALLOWED_DIRS` for text-file actions and `NEXUSFLOW_ADAPTERS_FILE` for locally reviewed application adapters. Leave `NEXUSFLOW_ALLOW_WRITES` unset unless writes are explicitly needed.

Runtime requests use a dedicated bearer token rather than the browser session cookie. Tokens are stored in Turso only as SHA-256 hashes and can be revoked from the dashboard. Model calls are proxied through the authenticated server-side account configuration; the saved model API key is never sent to the AI PC.

File and app actions create approval requests in **运行记录 → 权限审批中心** before execution. Decisions and automatically used exact-capability grants are persisted in Turso as an audit trail. No extra Vercel environment variable is required; the permission tables are created by the existing startup migration.

## Platform limits

- Direct uploads are capped at 4,000,000 bytes so they stay below Vercel's 4.5 MB Function request limit. Larger uploads require a future direct-to-object-storage flow.
- The Express application runs as one Fluid Compute function with a configured maximum duration of 60 seconds so it remains compatible with the Hobby plan. Higher-plan deployments can raise this value in `vercel.json` within their plan limit.
- Uploaded files are temporary; parsed text and embeddings are persisted in Turso. Do not treat the Function file system as storage.
- Keep the Function region close to the Turso database region when latency matters.
- Local Runtime task claiming uses short polling. The default three-second interval is intentionally compatible with Vercel Functions and does not hold long-lived requests open.

## Updating

Pushes connected through Git create Preview deployments automatically. Promote a tested deployment in the Vercel dashboard or deploy the current checkout with `vercel --prod`. Turso is managed storage; configure its backup and recovery policy separately from Vercel deployments.
