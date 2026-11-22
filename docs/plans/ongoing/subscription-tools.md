# Tools on the Claude subscription

**Priority:** high — Jaime (2026-11-22): an organisation that connects only its Claude subscription gets connectors that do nothing (found on the beta: Google connected, the agent could not read the calendar)
**Gate:** none
**Next:** build it (tasks below), land it with `pnpm pr:land`, then Jaime asks the calendar on the beta

## Why

An agent answering on a Claude subscription runs the unmodified Claude Code (`claude -p`, `apps/engine/src/claudeWriter.ts`) with every tool off. Anthropic allows a subscription only through that binary, so the engine cannot hand it tools the way it does on an API key (`chat.ts`, the Messages API tool loop). The one door Claude Code offers for outside tools is MCP. Today the engine works around it by trying another AI account first when the agent has tools (`orderForTools`), and with only a subscription the agent answers «no tengo las herramientas».

## Design (Jaime, 2026-11-22)

- **One short-lived MCP server per subscription reply, inside the engine process.** An HTTP server on `127.0.0.1`, a free port, a random bearer token for that reply only. It serves exactly the reply's `gated` tools (`chat.ts`, `writeReply`): reads run, writes become an approval card, as on a key. The model never sees the organisation or any account token.
- Claude Code gets it through a config file in the run's throwaway HOME (never the token on the command line): `--mcp-config <home>/mcp.json` with `{"mcpServers":{"ghostaff":{"type":"http","url":…,"headers":{"Authorization":"Bearer …"}}}}`, plus `--allowedTools mcp__ghostaff`. Its built-in tools stay off (`--tools ''`) and `--strict-mcp-config` stays.
- Each `tools/call` calls the writer's `onTool(name)` first (the step line in the chat), then `tools.run`. Results go back as text, `isError` kept.
- Claude Code names a tool `mcp__ghostaff__<name>` and the Messages API caps names at 64 characters, so the server exposes names of at most 49; a longer one (an MCP connector's `toolName` can reach 64) is cut to 40 plus `_` and 8 hex of its SHA-256, and mapped back.
- The server closes when the reply ends, on success, error or timeout.
- `orderForTools` goes: the owner's order of AI accounts holds whether or not the agent has tools. `NO_TOOLS_LINE` goes. The subscription card in Conexiones stops saying it cannot use connected apps.

**Approaches considered:** a stdio MCP process started by Claude Code would still need its own channel back to the engine for the gated tools and approvals: more parts, same result. Not giving the subscription tools (require a key for connectors) leaves the cheapest way to pay with dead connectors. The in-process HTTP server is the only one that reuses `gated` as is.

**Not in scope:** Claude Code's own tools (files, shell, web) stay off; agents run as jobs (`jobs.ts`) are untouched.

---

# Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an agent answering on a Claude subscription uses the organisation's connected accounts, with writes still waiting for an owner.

**Architecture:** `toolServer.ts` wraps an `AgentTools` in an MCP server (the SDK's low-level `Server`, stateful `StreamableHTTPServerTransport`) behind a bearer token on loopback; `claudeWriter.ts` starts one per reply when there are tools and points Claude Code at it.

**Tech Stack:** TypeScript, Node `http`, `@modelcontextprotocol/sdk` 1.32 (already a dependency), vitest.

**Spec:** the Design section above.

## Global Constraints

- Listen on `127.0.0.1` only, port `0` (the OS picks).
- Token: 32 random bytes, hex; compared with `timingSafeEqual`; missing or wrong → HTTP 401, nothing else said.
- The token never appears in Claude Code's arguments or in any log line.
- MCP server name `ghostaff`; allowed-tools entry exactly `mcp__ghostaff`.
- Exposed tool names ≤ 49 characters.
- Code and comments in English; anything a person reads in Spanish.

## Review Focus

1. A write tool called through the server must become a pending approval, never run: the server only calls the `AgentTools` it was given, and the writer passes `gated` — a test in Task 2 asserts the server calls exactly the `run` it received.
2. A request with no token or another reply's token gets 401 and reaches no tool — Task 1.
3. Claude Code timing out or failing still closes the server (no port left listening) — Task 2.
4. A tool that throws inside `run` comes back as an `isError` result and the reply goes on — Task 1.
5. Two replies at once each get their own port and token, and one's token is refused by the other — Task 1.

---

### Task 1: The per-reply MCP server

**Files:**
- Create: `apps/engine/src/toolServer.ts`
- Test: `apps/engine/test/toolServer.test.ts`

**Interfaces:**
- Consumes: `AgentTools`, `ToolSpec` from `src/tools.ts`.
- Produces:
  - `export interface ToolServer { url: string; token: string; close(): Promise<void> }`
  - `export async function startToolServer(tools: AgentTools, onTool: (name: string) => void): Promise<ToolServer>` — `url` is `http://127.0.0.1:<port>/mcp`.
  - `export function exposedName(name: string): string`
  - `export const MCP_SERVER_NAME = 'ghostaff'`

- [ ] **Step 1: Write the failing tests** (an SDK `Client` with `StreamableHTTPClientTransport`, `requestInit.headers.Authorization`), a fake `AgentTools` with one read tool `calendar_list` and one that throws:
  - `lists the organisation's tools with their schemas` — `listTools()` returns `calendar_list` with the spec's `description` and `inputSchema`.
  - `runs a tool through the AgentTools it was given and tells the reply first` — `callTool({name:'calendar_list', arguments:{days:7}})` → content text equals the fake's output; `onTool` got `'calendar_list'` before `run` was called; `run` got `{days:7}`.
  - `returns a failing tool as an error result` — `isError: true`, text from the outcome.
  - `refuses a request without the token, or with another server's token` — raw `fetch` POST → 401 both ways, `run` never called.
  - `two servers have different ports and tokens`.
  - `stops listening once closed` — after `close()`, `fetch(url)` rejects.
  - `keeps names Claude Code can prefix` — `exposedName('a'.repeat(30))` unchanged; `exposedName('x'.repeat(64))` has length 49, ends `_` + 8 hex, and is stable; a long-named tool is listed under its exposed name and calling that name runs the original.
- [ ] **Step 2: Run** `pnpm --filter @ghostaff/engine exec vitest run test/toolServer.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** with the low-level `Server` (our specs are JSON Schema already; `McpServer` wants zod) handling `ListToolsRequestSchema` and `CallToolRequestSchema`; one stateful transport (`sessionIdGenerator: randomUUID`) connected once; a Node `http` server that checks the bearer before `transport.handleRequest`; `close()` closes the transport, the MCP server and the HTTP server (`closeAllConnections` first).
- [ ] **Step 4: Run** the same command — Expected: PASS. Then `pnpm --filter @ghostaff/engine typecheck` — no errors.
- [ ] **Step 5: Commit** `feat(engine): a per-reply mcp server for an organisation's tools`

### Task 2: Claude Code with the tools

**Files:**
- Modify: `apps/engine/src/claudeWriter.ts` (header comment, `NO_TOOLS_LINE` removed, `claudeArgs`, `runOnce`)
- Test: `apps/engine/test/claudeWriter.test.ts`

**Interfaces:**
- Consumes: `startToolServer`, `MCP_SERVER_NAME` (Task 1).
- Produces: `export function claudeArgs(model: string, system: string, mcpConfigPath?: string): string[]` — with a path, appends `--mcp-config <path>` and `--allowedTools mcp__ghostaff`; `--tools ''` and `--strict-mcp-config` always.

- [ ] **Step 1: Write the failing tests** (replace `tells the agent it has no tools on this path…`):
  - `gives Claude Code the organisation's tools through a local MCP server` — the fake runner, while running, reads `<home>/mcp.json`, connects an SDK client with its URL and header, calls `calendar_list`; assert the tools' `run` got the call, the writer's `onTool` got the name, args contain `--mcp-config` `<home>/mcp.json` and `--allowedTools` `mcp__ghostaff`, `--tools` `''`, and no arg contains the token; the system prompt has no «no tienes las herramientas».
  - `starts no server when the organisation has no tools` — no `--mcp-config`, no `mcp.json`.
  - `closes the server when Claude Code fails` — fake runner records the URL then yields `result(true)`; after the rejection, `fetch(url)` rejects.
  - Keep the existing first test passing (no tools → `--tools ''`, `--strict-mcp-config`).
- [ ] **Step 2: Run** `pnpm --filter @ghostaff/engine exec vitest run test/claudeWriter.test.ts` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `runOnce`: when `tools.specs.length`, `startToolServer(tools, onTool)` (pass `onTool` into `runOnce`), write `mcp.json` (mode `0o600`) into `home.path`, pass its path to `claudeArgs`; close the server in the `finally` before removing HOME.
- [ ] **Step 4: Run** the same command, then `pnpm --filter @ghostaff/engine test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): agents on a claude subscription use the organisation's connected accounts`

### Task 3: The owner's order holds, and the app says so

**Files:**
- Modify: `apps/engine/src/chat.ts:318-321,378-386` (remove `orderForTools` and its call)
- Modify: `apps/engine/test/chat.test.ts` (tests of `orderForTools`, if any, replaced by: with tools, a subscription first in the owner's order answers first)
- Modify: `apps/mobile/lib/connections.ts:65`
- Modify: `docs/plans/ongoing/llm-connectors.md` (Progress: the subscription line no longer says «no tools yet»; a new line for this)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test** in `chat.test.ts`: `answers with the owner's first account even when it is a subscription and the agent has tools` — accounts `[claude, anthropic]`, tools with one spec; `writerFor` is called first with the `claude` account.
- [ ] **Step 2: Run** `pnpm --filter @ghostaff/engine exec vitest run test/chat.test.ts` — Expected: FAIL.
- [ ] **Step 3: Remove** `orderForTools`; use `await deps.chat.aiAccounts(agent.orgId)` directly. Replace the card's text at `connections.ts:65` with: `'Tus agentes usan con ella las apps que conectes (Google, Notion…), como con una clave.'`
- [ ] **Step 4: Run** `pnpm check` from the repo root — Expected: typecheck and every unit test PASS.
- [ ] **Step 5: Commit** `feat: the owner's order of ai accounts holds when an agent has tools`

### Task 4: Land and check on the beta

- [ ] `pnpm pr:land` from the worktree until it exits `0` (CI deploys the beta engine on merge to `develop`).
- [ ] Engine on beta at the merge commit: `gcloud run services describe engine --project ghostaff-beta --region europe-west1` image tag = merge sha; `/health` 200.
- [ ] Jaime asks «¿Qué tengo esta semana en el calendario?» in the beta app; the engine's log shows the reply 200 and the answer lists real events; then «Créame una hoja…» shows an «Aprobar» card.
