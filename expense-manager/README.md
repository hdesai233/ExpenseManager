# Ledger

A local-first personal expense manager. React + TypeScript renderer,
Electron desktop shell, `node:sqlite` for storage — no cloud, no account,
your data stays on your machine.

- **New here?** See the [User Guide](docs/USER_GUIDE.md) for how to
  install, import statements, categorize transactions, and generate
  reports.
- **Working on the code?** See the [Architecture Guide](docs/ARCHITECTURE.md)
  for the process model, data flow, and the reasoning behind the security
  and persistence design.

## Quick start

```bash
npm install
npm run electron:dev   # desktop app, hot reload, real SQLite storage
```

Other scripts: `npm run dev` (browser-only fallback mode), `npm run build`
(type-check + production bundle), `npm run electron:build` (produce a
Windows installer in `release/`).
