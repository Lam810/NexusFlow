# NexusFlow Local Runtime

The Local Runtime connects an AI PC to a NexusFlow deployment. It claims queued jobs over outbound HTTP(S), executes supported nodes locally, and returns one trace record per node. It does not open a listening port and it never receives the user's saved model API key.

## Start

Create a device from **运行记录 → 配对设备**. The token is shown once.

PowerShell:

```powershell
$env:NEXUSFLOW_URL="https://your-project.vercel.app"
$env:NEXUSFLOW_DEVICE_TOKEN="nfr_token-shown-once"
$env:NEXUSFLOW_ALLOWED_DIRS="D:\NexusFlowData"
$env:NEXUSFLOW_ADAPTERS_FILE="D:\NexusFlow\runtime\adapters.json"
npm --prefix runtime start
```

macOS/Linux:

```bash
export NEXUSFLOW_URL="https://your-project.vercel.app"
export NEXUSFLOW_DEVICE_TOKEN="nfr_token-shown-once"
export NEXUSFLOW_ALLOWED_DIRS="/Users/me/NexusFlowData:/Volumes/Shared/AssistantData"
npm --prefix runtime start
```

`NEXUSFLOW_ALLOWED_DIRS` uses the operating system path delimiter (`;` on Windows and `:` on macOS/Linux). A JSON string array also works on every platform.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXUSFLOW_URL` | required | NexusFlow deployment origin |
| `NEXUSFLOW_DEVICE_TOKEN` | required | one-time paired device token |
| `NEXUSFLOW_ALLOWED_DIRS` | empty | directories available to file actions |
| `NEXUSFLOW_ALLOW_WRITES` | `false` | enables `file.write` only when exactly `true` |
| `NEXUSFLOW_ADAPTERS_FILE` | empty | absolute or working-directory-relative path to a version 1 app adapter manifest |
| `NEXUSFLOW_APPROVAL_TIMEOUT_MS` | `300000` | how long a sensitive action waits for approval, clamped to 10 seconds–30 minutes |
| `NEXUSFLOW_POLL_MS` | `3000` | queue polling interval, clamped to 1–60 seconds |
| `NEXUSFLOW_RUN_ONCE` | `false` | claim once and exit; useful for diagnostics |

## Supported execution nodes

- Start, Query trigger, keyword Condition, LLM, Response.
- Device `system.info`.
- Device `file.read`, restricted to real paths under configured roots and limited to 1 MB.
- Device `file.write`, restricted to configured roots, limited to 1 MB, and disabled by default.
- Device `app.invoke`, restricted to actions declared in the local adapter manifest.
- Loop is recorded as a one-pass skip during a manually dispatched run.

Knowledge retrieval, semantic conditions, HTTP requests, and data-analysis nodes currently fail explicitly in Local Runtime and produce a failed node trace. They remain available in the existing browser execution path.

## App adapters

Copy [`adapters.example.json`](adapters.example.json) to a private local file, then edit the executable paths and actions for that PC. Adapter IDs and action IDs become exact capabilities such as `app.notepad.open_file`.

```json
{
  "version": 1,
  "adapters": [{
    "id": "photos",
    "label": "Photos",
    "executable": "C:\\Program Files\\Example\\Photos.exe",
    "actions": [{
      "id": "open",
      "label": "Open a photo",
      "args": ["{{input.path}}"],
      "wait": false,
      "timeoutMs": 30000
    }]
  }]
}
```

The executable and argument layout come only from this local manifest. A workflow can supply values for declared `{{input.*}}` slots, but cannot replace the executable, add arguments, or enable a shell. The Runtime verifies that every executable is an existing absolute file when it starts. Restart the Runtime after changing the manifest.

## Permission approval

`file.read`, `file.write`, and every `app.invoke` action pause before execution and create a request in **运行记录 → 权限审批中心**. The request shows the exact capability and operation context. The user can deny it, allow that request once, or create an always-allow grant for the same device and exact capability.

Always-allow grants are scoped to one user, one paired device, and one capability. They can be revoked from the approval center. Each automatically allowed invocation still creates an audit record. Pending requests expire when the Runtime timeout is reached; denying or timing out fails the workflow node and records the reason in its trace.

Approval context is stored in the NexusFlow database for audit. For file actions it includes the resolved local path; for app adapters it includes the rendered arguments. Do not pass passwords, tokens, or other secrets as adapter arguments.

## Security model

- There is deliberately no arbitrary shell or process executor.
- Application launches use fixed, locally reviewed executables and `shell: false`; workflow JSON cannot introduce a command line program.
- The device token is never printed by the Runtime and is stored on the server only as a SHA-256 hash.
- File reads resolve the final real path to block symlink escapes.
- File writes validate the real parent directory and existing target before writing.
- Allowed directory paths are not sent to NexusFlow; heartbeat metadata reports only the root count and whether writes are enabled.
- Sensitive operations require a server-recorded decision unless an active exact-capability grant already exists.
- LLM requests are proxied by NexusFlow with the signed-in user's encrypted OpenAI-compatible configuration.

Run the Runtime checks with:

```bash
npm --prefix runtime run check
npm --prefix runtime test
```
