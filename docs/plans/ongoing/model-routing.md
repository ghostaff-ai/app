# Model routing: the engine picks the model for each task, the customer never does

**Priority:** medium — AI is the biggest variable cost of the product, and today everything runs on the strongest model; nothing is at scale yet, so there is room to do it right
**Gate:** none
**Next:** land phase 0 (branch `feat/model-routing-phase0`, Tasks below): every usage row tied to its reply or run with its effort, «Editar» on action cards, and `ai_reply_outcomes`

Jaime's concern (2026-11-18), researched the same day. A small company does not know what Sonnet or Opus are and should never choose one. Something in the engine has to choose for it: the cheapest model that does the task well, never the strongest for everything.

## Goal

Every agent run gets the model, effort level and spending cap that its kind of task needs, chosen by the engine from evidence (our own evals and outcomes), so cost goes down without the customer noticing worse work.

## Context

- **Today the engine's chat uses one model for everything:** `claude-opus-5-5` at effort `low` (`CHAT_MODEL` in `apps/engine/src/chatStore.ts`, overridable with `ENGINE_CHAT_MODEL`), through Vertex when the organisation has it.
- **The old agent engine (`ghostaff-ai/agents`) pins one model per agent in YAML:** 9 agents on Opus 5.5, 2 on Sonnet 5.5 (`finanzas`, `correo`). It runs on a Claude subscription, so there a cheaper model saves usage limits rather than money. In this repo's engine (API key or Vertex) every token is billed.
- **Prices per million tokens, Anthropic API** (input / output): Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50 for prompts up to 100K tokens; Vertex's multi-region endpoints add 10% ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)). For example, classifying a 3,000-token email costs about $0.016 on Opus and $0.0004 on Haiku, 40 times less.
- **The engine is the Claude Agent SDK**, which already takes a model, an effort and a budget (`maxBudgetUsd`) per agent and per subagent ([subagents](https://code.claude.com/docs/en/agent-sdk/subagents)). Anthropic does not support routing the SDK to non-Claude models through a gateway ([LLM gateway](https://code.claude.com/docs/en/llm-gateway.md)), so under the SDK the choice is Haiku, Sonnet or Opus.

### What the research found (2026-11-18)

- **Every "Auto" mode has converged on the same shape:** filter the eligible models (region, capabilities, what the customer allows), pick the cheapest within a small quality margin of the best, fail over, and record which model answered. Microsoft Foundry's model router is the clearest description ([how it works](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-router-how-it-works)); Cursor trains its router on whether users accept or correct the agent's work ([Cursor](https://cursor.com/blog/router)); GitHub Copilot escalates from a cheap draft to a strong model when a quality check fails ([Copilot Fusion](https://github.blog/changelog/2026-10-28-route-and-orchestrate-models-with-github-copilot-fusion)).
- **They switch models only where the prompt cache allows it**, per session or at cache boundaries, never per message ([Copilot](https://docs.github.com/en/copilot/concepts/auto-model-selection)). The cache is per model, and in an agent loop about 84% of the input comes from it; without it the same work costs 3 to 7 times more ([Anthropic, optimizing for cost](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence.md)).
- **Routers trained on other people's traffic do not know our tasks.** RouteLLM trained on generic chat is close to random on domain tasks until it gets ~1,500 domain examples ([RouteLLM](https://arxiv.org/html/2406.18665v3)). Where tasks fall into known families, a lookup by family does as well as a learned router ([arXiv 2610.19198](https://arxiv.org/html/2610.19198)). Ghostaff's tasks come in families by construction: each agent and each skill is one.
- **Nothing rentable fits today.** OpenRouter's Auto router runs only in its global region ([docs](https://openrouter.ai/docs/guides/routing/routers/auto-router)); Azure Foundry's router is in preview, has no Sonnet 5.5 and ignores the customer's own Anthropic or Vertex key; Requesty's Auto routing is in beta. Every savings figure (Cursor 30–60%, Azure up to 50%, Requesty 42%) is the vendor's own.
- **Some levers cut more than any router and do not change the model:** caching, effort, the Batch API (−50% for work that can wait up to 24 hours), code execution for tables instead of pasting them into the prompt, and a spending cap per run for the few runs that cost most. In Anthropic's tests, Opus 5.5 at effort `low` cost and scored about the same as Sonnet 5.5 at `high`, and an orchestrator on Opus with Sonnet subagents cost a third less for a similar score.
- **The counter-example is OpenAI.** GPT-5's automatic router was seen as a downgrade and OpenAI gave users their choice back. Our users never choose, so ours must fail upwards on anything a person reads.

## The idea

1. **A `ModelPolicy` module in `apps/engine`**, not a separate service. In: organisation, agent, task family, the AI accounts available. Out: tier, model, effort, `maxBudgetUsd`, failover chain and the reason. It runs **once when a session or subagent starts**, never per message, so the cache survives.
2. **Agents and skills declare abstract tiers, not model ids:** `light` (Haiku 5.5 today), `standard` (Sonnet 5.5, or Opus 5.5 at `low`, whichever the evals say), `deep` (Opus 5.5 at `medium` or `high`). The policy resolves a tier to a model for the organisation's account: Vertex EU by default, or its own key. A new model generation becomes a change to one table plus a rerun of the evals.
3. **Hard rules:**
   - Eligibility before cost: EU residency, the capabilities the task needs, and the models the account actually offers.
   - Failover only to EU endpoints. Anthropic's own API documents only US inference, so falling from Vertex EU to it would break invariant 2.
   - Never answer worse in silence because of a rate limit or an exhausted budget: tell the owner instead, as Claude Code does.
   - Every run records which model answered and why.
4. **In four phases, each one only if the previous one shows it is worth it:**
   - **Phase 0, measure and apply the levers that do not change the model.** Record per run: cost, cached against uncached tokens, the tier, and the outcome. The outcome is what a person did next: accepted the draft as it was, edited it, asked again, or took over. Then stable prompt prefixes for caching, Batch for scheduled work, and a budget cap per run.
   - **Phase 1, a table from task family to tier, set by evals.** For each family (categorise expenses, triage mail, draft a post, prepare a decision for Dirección), a few hundred real cases with a success test: deterministic where possible, an LLM judge checked against human labels where not. Run 2 or 3 tiers on each and always compare with "everything on Opus" and "everything on the cheapest". In the team chat, the saving comes from **delegating bounded work to cheaper subagents**, not from lowering the orchestrator's model mid-conversation.
   - **Phase 2, cascades where a cheap, exact check exists.** For example, Haiku categorises the month's bank movements in a batch; a check confirms each account exists in the organisation's chart of accounts, the amounts add up and the output is valid; whatever fails is redone on Sonnet. Without such a check (Marketing, Dirección's chat) there is no cascade, only the phase 1 table.
   - **Phase 3, a learned classifier**, only once there are tens of thousands of runs labelled by outcome, and only if it beats the table on held-out real cases. It picks a tier per conversation from its first message, for open chat that fits no family.
5. **What stays defensible is the evals and the outcome data, not the router.** The same data tells us when a new model generation is safe to adopt, and, if multi-provider ever comes, which subtasks could go elsewhere.

## Where the models run: accounts and runners

Jaime (2026-11-18): an organisation must be able to bring its provider subscription as well as an API key. What each provider allows, and what is built, is in [llm-connectors](llm-connectors.md). This section is how those accounts meet the policy above.

**Each way in carries its own way of running the agent:**

| Account | Status | Runs on | What routing saves |
|---|---|---|---|
| Ghostaff's own (default) | Works | Claude on Vertex AI in the EU, through the Agent SDK | Ghostaff's money |
| The organisation's API key (Anthropic, OpenAI) or its own Vertex project | Built; not yet tried with a real key on the beta | The Agent SDK; the key comes from the vault | The organisation's money |
| Claude subscription | Decided, grey zone, not built | Only the Claude Code CLI (`claude -p`), never the Agent SDK: the same way Órdago's agents already run on a subscription in `ghostaff-ai/agents` | The plan's usage limits, not money |
| ChatGPT plan | On OpenAI's waitlist | The Responses API only; the Agent SDK cannot drive it | The plan's limits |
| OpenRouter | Planned | One-click OAuth key, then like an API key | The organisation's money |

**The shape:**

1. **An account resolver per organisation.** It orders the accounts the organisation has: its subscription, then its own key, then Ghostaff's Vertex EU. When one is refused or runs out, it moves to the next and tells the owner, never silently. `aiAccount` in `apps/engine/src/chatStore.ts` already picks Vertex before an Anthropic key; it grows into this.
2. **`ModelPolicy` resolves a tier on that account.** `light` / `standard` / `deep` become the model that account offers: Vertex EU ids, Anthropic ids, or, on a subscription, the `--model` and per-subagent model Claude Code takes.
3. **Interchangeable runners behind one interface:**
   - **Agent SDK runner** for Ghostaff's account, API keys and Vertex. Full control of model, effort and budget. This is the main path and the first to build.
   - **Claude Code CLI runner** for Claude subscriptions, always through the CLI (Jaime, 2026-11-18). It reuses what `ghostaff-ai/agents` already does for Órdago: a Cloud Run Job runs `claude -p` with `CLAUDE_CODE_OAUTH_TOKEN` (made with `claude setup-token`, kept in Secret Manager) and refuses to start if `ANTHROPIC_API_KEY` is set, since that would win and bill per token. The model per agent and subagent goes in as `--model` and the subagents' own settings. Built when subscriptions are switched on, not before. Keeping a customer's token between runs is the grey part [llm-connectors](llm-connectors.md) already names.
   - **A Responses API runner** for ChatGPT plans, only if the engine goes multi-provider (that decision is still the product plan's).
4. **Agent definitions stay neutral.** Prompts, tools as MCP servers, and skills work the same in the Agent SDK and in Claude Code, so every runner reads one definition of each agent instead of one per provider.

**Data in Europe.** A Claude subscription or an Anthropic key sends the organisation's data to Anthropic, mostly in the US. The connect screen already says so; the resolver must not fall from an EU account to a non-EU one without the owner having chosen that account.

**The tradeoff:** every runner is code to keep and test against the same agents. One runner (Agent SDK) until a subscription is actually switched on keeps that cost where it pays.

## Decisions

1. **Our own routing, by task family, with abstract tiers, in the engine** (Álvaro, 2026-11-21, in the decision deck, chosen before he saw the recommendation). Not a rented router, not a learned per-prompt router from the start: renting fails on EU residency, on organisations' own keys or on maturity, and a learned router needs data we do not have yet.
2. **Organisations with their own key get the same policy as everyone else** (Jaime, 2026-11-26). The policy is meant to lose no quality, so there is no quality-first variant and no setting.
3. **Haiku 5.5 is on Vertex's EU multi-region** (checked 2026-11-26; a fact, not a decision). Google Cloud's [Claude Haiku 5.5 model page](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/haiku-5-5) lists `eu` (Europe multi-region) under supported regions, with 1,500 requests and 15M input tokens a minute, the same regions as Sonnet 5.5 and Opus 5.5. Anthropic's [Vertex page](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed) lists `claude-haiku-5-5` and sends per-region availability to Google's pages; the `claude-api` skill's `shared/platform-availability.md` covers features per platform, not models per region. Regional endpoints (`europe-west1`) serve only Sonnet 4.6 and older, so the EU endpoint for every current model is the multi-region `eu`, at 10% over global. So `light` is Haiku 5.5 on Vertex EU, with no fallback to Sonnet.
4. **The old engine's 11 agents are phase 1's test bench** (Jaime, 2026-11-26). Their real tasks in `ghostaff-ai/agents` (Órdago, on a subscription) are run on 2 or 3 tiers, and an agent's model in its YAML changes where a cheaper one does as well. On a subscription that saves usage limits, not money, but it is real work to try the method on before this engine's own agents have history.
5. **With several accounts, the default order is the subscription first, then the organisation's own key, then Ghostaff's account** (Jaime, 2026-11-26). The owner can reorder them ([multiple-ai-accounts](multiple-ai-accounts.md)). Jaime chose this over the recommendation (own key first, the subscription only when the owner asks). The tradeoff he accepts: a subscription is the least reliable account (Anthropic can cut it without warning) and sends the data out of the EU, so an organisation whose subscription goes first leaves Vertex EU for most of its work. Still to reconcile with decision 6 of multiple-ai-accounts (Jaime, 2026-11-23: «a new account stays last»): whether a subscription added after other accounts goes first or last. Not phase 0's; it belongs to the account resolver.
6. **The evals live in this repo, next to the engine** (Jaime, 2026-11-26). The cases come from Ghostaff's own organisation first ("Ghostaff uses Ghostaff") and from the old engine's agents (decision 4).
7. **The customer never sees or picks a tier** (Jaime, 2026-11-26). For the agents an owner creates by talking with Secretaría ([agent-builder](agent-builder.md)), **Secretaría assigns the tier internally** when it drafts the agent, from what the agent will do; the outcome data adjusts it later. The tier is never shown on the draft's card or anywhere else in the app.
8. **The outcome of a chat reply is linked now and classified later** (Jaime, 2026-11-26). Phase 0 ties each usage row to the reply it paid for; the next message a person writes in that conversation, and how long after, are read from the database, not stored again. Classifying that message as accepted, asked again or took over is phase 1's, in a batch on Haiku checked against human labels. No new buttons in the chat.
9. **«Editar» on action cards** (Jaime, 2026-11-26). Before approving what an agent wants to do outside Ghostaff, the person who decides it can change its text (a review reply, a caption, a mail's body). That is the «edited» outcome. Recommended against for phase 0 (a product and UI change), chosen anyway, because «edited» is the outcome that says most about a draft's quality and nothing measured it.

## Phase 0: measure

What already exists (multiple-ai-accounts): `ai_usage` keeps one row per reply or run, with its account, agent, source (`chat` or `run`), outcome (`ok`, `limited`, `refused`, `failed`), model, uncached input, output, cache-read and cache-write tokens, and the estimated cost (null on a subscription). [agent-context](agent-context.md) adds prompt caching to chat turns and logs how much each read from the cache; it does not change what `ai_usage` stores. Phase 0 does not duplicate that measurement. It adds what a row lacks for routing:

- **Which reply or run it paid for** (`message_id`, `run_id`), so its outcome can be joined to it.
- **The effort and the tier.** Effort today is `low` everywhere (`streamWith`, `subscriptionWriter`); it becomes one constant, `CHAT_EFFORT`, which the writers report with their usage. `tier` is null until phase 1 resolves one; a null tier is «not routed».
- **The outcome**, as the view `ai_reply_outcomes` (security invoker, so row-level security applies), one row per successful reply with:
  - `accepted`, `edited` or `rejected` when its message carries an action card a person decided: approved as drafted, approved after «Editar», or rejected;
  - otherwise `followed_up`, with the next person's message and the seconds to it, for phase 1 to classify (decision 8);
  - otherwise `none`.
  Decisions keep what they already record (the option chosen against the one recommended); tying a decision to the run that opened it is not phase 0's.
- **«Editar» on action cards** (decision 9). A tool that writes declares which of its input's text fields a person may edit (`editable` on the tool's definition: a review reply's `comment`, a post's `caption`, a draft's `subject` and `body`). The card carries those fields and their values; «Editar» turns them into text boxes, and «Aprobar» sends the changes with the approval. The engine accepts only declared fields, as strings, within the tool's own limits, keeps the agent's draft in `agent_actions.drafted_input`, runs the edited input, and marks the card `edited`. Settings changes, guided requests and makers' MCP tools declare none in this phase, so their cards approve or reject as today. The deck's OK card does not edit: «Editar» is in the chat's card only.

The rest of the original phase 0 (stable prompt prefixes, the Batch API for scheduled work, a spending cap per run) is not in this change: caching is agent-context's, and Batch and the cap come once the data shows where the cost is.

### File Structure

- Create `supabase/migrations/<ts>_model_routing_phase0.sql`: `ai_usage` gets `message_id` (→ `messages`, on delete set null), `run_id` (→ `agent_runs`, on delete set null), `effort` (`low` … `max`), `tier` (`light` | `standard` | `deep`, null), and an index on `message_id`; `agent_actions` gets `drafted_input jsonb`; the view `ai_reply_outcomes`.
- Create `supabase/tests/database/ai_reply_outcomes.test.sql`: another organisation's member sees none of an organisation's outcomes; a member sees an outcome only for a conversation they see; the outcome is `accepted`, `edited`, `rejected`, `followed_up` or `none` as above.
- Modify `apps/engine/src/chatStore.ts`: `CHAT_EFFORT`; `streamWith` reports it; `recordAiUse` writes `message_id`, `run_id`, `effort`.
- Modify `apps/engine/src/claudeWriter.ts`: `--effort` from `CHAT_EFFORT`, reported with its usage.
- Modify `apps/engine/src/chat.ts`: `Writer.onUsage` carries `effort`; `AiUse` gets `messageId`, `runId`, `effort`; `recordUse` takes the reply's id; the action card part gets the tool's editable fields.
- Modify `apps/engine/src/jobs.ts`: a run's usage row carries its `run_id` and message.
- Modify `apps/engine/src/tools.ts`: `ToolDef.editable` and `AgentTools.editable(name)`.
- Modify the writing tools' definitions: `googleBusiness.ts`, `instagram.ts`, `tiktok.ts`, `google.ts`, `microsoft.ts`.
- Modify `apps/engine/src/actions.ts` and `apps/engine/src/app.ts`: approving takes `edits`, checks them against the tool's editable fields and limits, stores the draft, runs the edited input, rewrites the card's preview.
- Modify `packages/shared/src/chat.ts` (`ActionPart.editable`, `ActionPart.edited`) and `packages/shared/src/services/index.ts` (`decideAction` sends edits).
- Modify `apps/mobile/components/chat/Message.tsx` (`ActionCard`: «Editar», the text boxes, «Aprobar» with the changes) and the screens that pass `onDecide`.
- Tests: `apps/engine/test/chat.test.ts`, `jobs.test.ts`, `actions.test.ts`; `apps/mobile/__tests__/ActionCard.test.tsx`.
- Modify `docs/architecture.md`: what a usage row records and the edited approval.

### Tasks

Stage 1, measure (rebased on agent-context's PR, which changes the same `recordUse` calls):
- [ ] Migration: the `ai_usage` columns and index, `agent_actions.drafted_input`, `ai_reply_outcomes`; pgTAP.
- [ ] Engine: `CHAT_EFFORT` reported by both writers; every chat reply's and runner run's usage row carries its message, run and effort; tests.

Stage 2, «Editar» on action cards:
- [ ] Engine: `editable` on the writing tools; the card part lists the fields; approve with `edits` validated, the draft kept, the card marked `edited`; tests, including a field not declared and a value over the tool's limit refused.
- [ ] Shared and app: `ActionPart.editable` / `edited`, `decideAction(…, edits)`, the card's «Editar»; component tests.
- [ ] Architecture: usage rows and the edited approval.

After phase 0: read a week of `ai_reply_outcomes` on beta and Órdago's runs before phase 1 starts.
