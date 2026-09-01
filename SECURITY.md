# Security Policy

## Supported versions

Security fixes are applied to the latest commit on the `main` branch. This project is currently a prototype and does not publish long-term-support releases.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository (the **Security** tab, then **Report a vulnerability**). Include the affected route or component, reproduction steps, impact, and a suggested mitigation if available.

If private reporting is not enabled, open a public issue that asks the maintainers for a private contact channel, but do not include exploit details, credentials, personal data, or other sensitive information.

Please allow the maintainers reasonable time to investigate and release a fix before public disclosure.

## Deployment scope

The documented Vercel deployment uses platform TLS, HttpOnly session cookies, Turso Cloud persistence, Upstash-backed distributed rate limiting, and Vercel-managed secrets. Operators remain responsible for provider backups, monitoring, data handling, account policy, log retention, and incident response. See [DEPLOYMENT.md](DEPLOYMENT.md).

The Local Runtime is a developer tool rather than a general command executor. It intentionally exposes no listening port or arbitrary shell action. File capabilities remain inside configured real-path roots, application capabilities are pinned to a local manifest, and sensitive actions require an exact-capability approval or an active device-scoped grant. Approval context can contain local paths and rendered application arguments and is stored for audit, so secrets must not be passed through those fields.
