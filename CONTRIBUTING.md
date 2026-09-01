# Contributing to NexusFlow

Thanks for helping improve NexusFlow. Bug reports, documentation corrections, tests, and focused pull requests are welcome.

## Development setup

Use Node.js 20.19+ or 22.13+ and npm 9+.

```bash
npm run setup
```

Copy `server/.env.example` to `server/.env`, generate a unique `JWT_SECRET`, then run the server and client in separate terminals:

```bash
npm run dev:server
npm run dev:client
```

## Before opening a pull request

Keep changes focused and avoid committing credentials, `.env` files, databases, uploaded documents, or generated build output. Add or update tests when behavior changes, and run:

```bash
npm run check
npm run audit
```

Describe the problem, the chosen solution, and any compatibility or security impact in the pull request. For user-interface changes, include a screenshot or short recording where practical.

Changes to Local Runtime capabilities must preserve the no-arbitrary-shell boundary, validate paths or executables before requesting approval, use the narrowest practical capability name, and include tests for both execution and permission behavior. Do not add a manifest action that lets workflow input replace an executable or expand into additional command-line arguments.

## Reporting security issues

Do not disclose vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md) instead.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
