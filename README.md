# Kumpas

Local-first desktop app for orchestrating AI-assisted coding via a Kanban board.

## Development

`better-sqlite3` is a native module, and its compiled binary only works against one ABI at a time (Node's or Electron's) — it can't serve both at once.

- `npm test`, `npm run typecheck`, and `npm run build` run against the **Node ABI** (whatever `npm install` produces).
- To **launch the app**: run `npm run rebuild:electron` (rebuilds `better-sqlite3` for Electron's ABI), then `npm run dev`.
- Before running tests again: run `npm run rebuild:node` to restore the Node ABI.
