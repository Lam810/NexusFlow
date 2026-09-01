# Changelog

This project is a developer prototype and does not yet publish a stable versioned release train. Significant changes merged to `main` are summarized here.

## Unreleased

### Added

- A redesigned responsive workflow dashboard, authentication flow, editor, model settings, and Runtime operations console.
- Per-user OpenAI-compatible model configuration with encrypted API-key storage.
- Vercel deployment support with Turso persistence, Upstash rate limiting, HttpOnly sessions, and closed-by-default production registration.
- A dependency-free Local Runtime with device pairing, outbound task polling, guarded node execution, cancellation, and per-node run traces.
- Allowlisted local text-file actions and declarative application adapters with fixed executables, fixed argument templates, and `shell: false` process launches.
- A permission approval center with allow-once, always-allow, deny, revoke, timeout, and audit flows scoped to the signed-in account and paired device.
- Open-source governance, security policy, contributor guidance, deployment documentation, and continuous integration.

### Security

- Added tenant ownership checks across workflows, knowledge, chat history, model configuration, Runtime devices, runs, traces, and approvals.
- Added SSRF controls, bounded proxy responses, credential scrubbing, encrypted saved model keys, hashed Runtime tokens, and safer production defaults.
- Cancelling a run or revoking a device now invalidates outstanding local-action approvals; device revocation also cancels active runs and revokes persistent grants.

### Known prototype limits

- The Local Runtime must be started with Node.js and is not packaged as a native desktop application or OS service.
- Application adapters are configured through a local JSON manifest; automatic application discovery and signed adapter packages are not implemented.
- Approval is performed in the web application; native OS consent notifications are not implemented.
- Runtime scheduling, offline resume, and multi-device capability routing remain roadmap items.
