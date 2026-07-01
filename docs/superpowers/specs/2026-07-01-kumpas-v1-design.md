# Kumpas v1 — Design

**Date:** 2026-07-01
**Status:** Approved for planning

## What this is

Kumpas is a local-first desktop app for orchestrating AI-assisted software
projects. It gives a human manager a Kanban board that AI coding agents can
read and act on, a comment thread per ticket that agents use to collaborate,
a diff-review surface, and a per-project token-usage dashboard.

"Kumpas" = to conduct, as an orchestra conductor. The app conducts the agents;
it does not do the coding itself — it delegates to an existing coding-agent CLI.

## v1 goal (the vertical slice)

Prove the hard, risky part end to end: **a human drops a ticket on an agent,
the agent reads the ticket + comment thread, edits the repo, and the human
reviews the resulting diff — with token usage logged.**

Everything else in the broader vision (spec builder, plan builder, concurrent
agents, extra adapters) layers on *after* this loop is real.

## Non-goals (v1)

Explicitly deferred, in rough priority order:

- **Spec / plan builder** — AI-assisted spec drafting and plan approval. The
  front of the eventual flow; built after execution is proven.
- **Gemini/`agy` and Codex adapters** — the adapter contract is built in v1,
  but only the Claude adapter is implemented.
- **Dollar cost** — tokens are tracked; dollars are an optional derived view
  added only when someone wants to see spend in $.
- **Concurrent agents on one ticket** — v1 is sequential handoff only.
- **Branch/worktree-per-ticket isolation** — v1 edits the working tree.
- **Retrieval / RAG memory** — not needed while a comment thread fits in
  context.
- **Any hosting / multi-user / cloud sync / auth** — single-user, local only.

## Key decisions (and why)

| Decision | Choice | Why |
|---|---|---|
| Runtime | Wrap an existing coding-agent CLI, headless | Reuse a best-in-class agent; token/cost data comes free from the tool |
| Claude integration | **CLI (`claude -p … --output-format json`), not the Agent SDK** | Preserves subscription auth; keeps all adapters symmetric; JSON gives usage + streaming |
| Auth | Auth-agnostic (`ANTHROPIC_API_KEY` if set, else subscription login) | Free personal dogfooding on a subscription; API key for anything heavier |
| Deployment | Local-first, single-user, OSS, bring-your-own-credentials | Not a hosted product — sidesteps the ToS rule against routing others' work through Pro/Max credentials |
| Collaboration | Ticket comment thread as the shared channel; **sequential handoff (A) + ask-and-answer (C)** | The board is already being built; reuse it as the coordination + audit layer. No agent-to-agent messaging bus |
| Memory | Fresh run + re-inject the comment thread; curate one `CLAUDE.md`; no RAG | Only portable option across CLIs with different session semantics; comment thread is agent-agnostic durable memory |
| Cost | Track **tokens** as source of truth; dollars = optional user-entered `$/1M` multiplier | Tokens normalize cleanly across all CLIs; no bundled price table to go stale; honest metric for subscription users |
| Adapters | Pluggable `AgentAdapter` contract; **Claude only in v1** | Three real future implementations (Claude / `agy` / Codex) earn the seam; building all three now triples surface area before the loop is proven |
| Shell | **Electron** | Subprocess orchestration is the hottest path and trivial in Node; one Chromium = identical rendering across Win/Linux/Mac |
| Storage | **SQLite** on disk | Local-first, single-user, zero setup |
| Scope | **Multiple local git projects** | Schema is already project-scoped; artificially capping at one adds nothing |

## Architecture

Electron app, two processes:

- **Main process (Node):** SQLite data layer, the `AgentAdapter` + `ClaudeAdapter`,
  the dispatch service, and git-diff capture. All subprocess spawning lives here.
- **Renderer (web UI):** project switcher, board, ticket detail (thread + diff),
  agent-role config, dashboard. Talks to main over IPC.

### Components (each has one job)

1. **DB layer** — SQLite read/write, the only thing that touches the database.
2. **`AgentAdapter` (interface) + `ClaudeAdapter`** — turn a prompt + repo into a
   normalized run result. `ClaudeAdapter` spawns `claude -p` and parses its JSON.
3. **Dispatch service** — assemble prompt, invoke the adapter, capture the diff,
   record the run, post the agent comment, move the ticket. The core orchestration.
4. **Diff capture** — run `git diff` in the project repo after a run.
5. **UI** — render state, issue dispatch/approve/comment commands over IPC.

## Data model (SQLite)

- `projects` — id, name, **repo_path** (a local git repo).
- `tickets` — id, project_id, title, description, status
  (`backlog` | `in_progress` | `review` | `done`), blocked flag.
- `comments` — id, ticket_id, author (human, or an agent-role name), body,
  kind (`note` | `question`), created_at.
- `agents` — id, name, system_prompt, model, permission_level. **Global** —
  reusable across all projects. Ships with starter **Developer** and **Reviewer**.
- `runs` — id, ticket_id, agent_id, status (`success` | `failed` | `blocked`),
  tokens_in, tokens_out, diff snapshot, created_at.

Everything queryable is scoped by `project_id`. Roles are the one global entity;
a dispatch binds a role to a project at run time.

## The dispatch loop (core flow)

1. Human opens a ticket in a project, clicks **Dispatch → [role]**.
2. Dispatch service assembles the prompt = ticket description + full comment thread.
3. `ClaudeAdapter` runs `claude -p "<prompt>" --output-format json` in the
   project's repo dir. Claude Code reads the repo and its curated `CLAUDE.md`.
4. Agent edits files; adapter returns result text + token usage
   (`usage`, and `total_cost_usd` if present, stored as a bonus).
5. Dispatch service runs `git diff` to snapshot the change, records a `run`
   (tokens), posts an agent **comment** summarizing what it did, and moves the
   ticket to **Review**.
6. Human reviews the diff and either **Approves** (keep/commit) or **Requests
   changes** (adds a comment → re-dispatch).

### Collaboration: A + C

- **Sequential handoff (A):** Reviewer leaves a comment → re-dispatch Developer;
  it reads the new comment (re-injected thread) and revises. Turn by turn, one
  agent at a time.
- **Ask-and-answer (C):** an agent posts a `kind = question` comment and stops.
  The run is recorded `blocked`, the ticket flags blocked, and it waits for a
  human reply before the next dispatch.

## Adapter contract

```
run(prompt, repoPath, roleConfig) →
  { resultText, diff, tokensIn, tokensOut, costUsd?, sessionId? }
```

Each future adapter fulfills this however suits its CLI:

- **Claude / `agy`** — single JSON blob from `--output-format json`.
- **Codex** — folds a JSONL event stream (`codex exec --json`), reading token
  usage from `turn.completed` events.

Above the adapter, nothing knows or cares which CLI ran. v1 implements the
Claude adapter only; the contract is what makes the others drop-in later.

## Memory

Three tiers, each mapped to something that already exists — no custom store:

1. **Code memory** → the repo + a curated `CLAUDE.md` that Claude Code reads
   natively. Kumpas keeps `CLAUDE.md` curated; it does not append junk to it.
2. **Task/collaboration memory** → the SQLite comment thread, re-injected into
   the prompt on every dispatch. This is the portable, agent-agnostic memory.
3. **Project knowledge** → specs/plans as markdown in the repo, referenced by path.

Each headless run is stateless, so "memory management" = assembling the right
context per dispatch, not maintaining a session.

## Cost / usage

Tokens are the stored truth (per run → aggregated per ticket / agent / project).
Dashboard shows a per-project token total plus an all-projects sum on the home
screen. Dollars are an optional display layer: a user-entered `$ per 1M tokens`
per model in settings, `tokens × rate`. Kumpas ships no price table.

## Error handling

- **Adapter run fails** (non-zero exit, CLI error) → record run `failed`, post
  the error as a comment, leave the ticket where it is. No silent failures.
- **Missing credentials / CLI not installed** → surface a clear, actionable
  message before dispatch, not a raw stderr dump.
- **Not a git repo** → block adding the project (diffs and approve-as-commit
  depend on git) with an explanation.
- **Run timeout** → cap run duration, record `failed` with a timeout reason.

## Testing

- **Adapter parsing** — feed a captured `claude -p` JSON sample → assert the
  normalized `{resultText, tokensIn, tokensOut, ...}` shape.
- **Dispatch service** — with a mock adapter, assert it records the run, posts
  the comment, moves the ticket, and handles the `blocked`/`failed` branches.
- **DB layer** — round-trip each entity; assert `project_id` scoping.

No framework beyond the runner; no per-function suites.

## Open flags carried into implementation

- `// ponytail: working-tree edits; add branch/worktree-per-ticket isolation
  when parallel agents would clobber each other.`
- `// ponytail: one adapter now, contract ready for agy + codex.`
- `// ponytail: tokens are truth; dollars are an optional user-entered
  multiplier, not a bundled price table.`
- `agy` exact headless-exec flags to be confirmed when that adapter is built
  (docs are currently thin).
