# Kumpas

A local-first desktop app that runs a team of AI coding agents from a Kanban board.

*Kumpas* is Filipino for "to conduct", as a conductor leads an orchestra.

## What it does

You write a story. Kumpas turns it into code on a branch you review:

1. **Brainstorm.** Chat with an agent about a feature until you have a spec.
2. **Promote.** The spec becomes an **epic** ticket on the board.
3. **Plan.** Hand the epic to a team. Its lead agent breaks the work into child task tickets, assigning each to a team member. The agent creates those tickets through an MCP tool that Kumpas serves.
4. **Execute.** Run the batch. Each child task runs in its own git worktree on a `task/<id>` branch, several at a time. Kumpas captures the run's result, token counts, and diff, then commits the work.
5. **Review.** Approve a task to merge its branch into the epic branch (`epic/<id>`). If the merge conflicts, or the agent reports it is blocked, the ticket is flagged. Your reply on the ticket retries the merge or resumes the agent.

Any ticket can also be dispatched by hand to a single agent, which runs it directly in the repo.

## Features

- **Kanban board** with user-defined columns. The dispatch engine goes by each column's role (todo, in progress, review, done), so you can rename columns freely.
- **Agents**: each has a provider, a model, a system prompt, and a permission level (`read`, `edit`, `auto`). The permission level maps to the agent CLI's permission mode.
- **Teams**: groups of agents that take an epic and plan its tasks.
- **Brainstorm chats**: multi-turn conversations that keep the provider's session across turns.
- **Planning via MCP**: a localhost MCP server, alive for one planning turn only, with a per-run bearer token. It exposes one tool that can only create child tasks of that epic.
- **Parallel execution**: one git worktree per task. Parallelism (1–10) and auto-merge are set in the Settings dialog.
- **Ticket drawer** showing status, assignee, priority, due date, tags, comments, attachments, and run history.
- **Attachments**: text files are inlined into the agent's prompt (truncated at 100 KB). Binary files are passed by path.
- **Dark and light themes.**

## Architecture

```
src/
  core/      Headless domain logic: SQLite store, dispatch, execution, git, planning, providers
  main/      Electron main process: window setup, IPC handlers (the trust boundary)
  preload/   contextBridge API exposed to the sandboxed renderer
  renderer/  React UI: board, ticket drawer, agents/teams, chats, settings
  shared/    The typed IPC contract shared by main, preload, and renderer
```

- **Local-first.** All state lives in a local SQLite database (`better-sqlite3`), and schema migrations are versioned with `PRAGMA user_version`. Nothing leaves your machine except what the agent CLI itself sends.
- **Pluggable providers.** Agents run behind an `AgentProvider` interface that wraps headless coding-agent CLIs. The Claude Code CLI (`claude -p`) is implemented. `agy` and `codex` are reserved in the provider list but not yet implemented.
- **Validated IPC.** The main process validates every value it gets from the renderer, for example allowlisting agent permission levels. The renderer is never trusted.
- **Testable core.** `src/core` doesn't import Electron. Git and provider calls go through injectable seams, and the git helpers are tested against real temporary repositories.

## Tech stack

TypeScript · Electron · React 19 · Tailwind CSS v4 · Radix UI (shadcn/ui) · better-sqlite3 · electron-vite · Vitest · git worktrees · Model Context Protocol

## Getting started

Requirements: Node.js, git, and the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and signed in.

```bash
npm install
npm run rebuild:electron   # build better-sqlite3 for Electron's ABI
npm run dev
```

## Development

```bash
npm test            # Vitest: the core test suite (src/core/*.test.ts)
npm run typecheck
npm run build
```

`better-sqlite3` is a native module. Its compiled binary works against only one ABI at a time, either Node's or Electron's.

- `npm test`, `npm run typecheck`, and `npm run build` run against the **Node ABI** (whatever `npm install` produces).
- To **launch the app**, first run `npm run rebuild:electron` to rebuild `better-sqlite3` for Electron's ABI, then run `npm run dev`.
- Before running tests again, run `npm run rebuild:node` to restore the Node ABI.

## Status

This is an active personal project. The pipeline from spec to plan to parallel execution to merge works end to end. Still to come: an in-app diff review view, a cost dashboard, more providers, and packaged builds.
