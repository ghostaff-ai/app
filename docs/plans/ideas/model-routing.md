# Model routing: the engine picks the model for each task, the customer never does

**Priority:** medium — AI is the biggest variable cost of the product, and today everything runs on the strongest model; nothing is at scale yet, so there is room to do it right
**Gate:** decision:Álvaro accepts routing by task with abstract tiers (open question 1)
**Next:** Álvaro answers the open questions; then phase 0 (cost and outcome per run) joins the engine's agent runs as they are built

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

Jaime (2026-11-18): an organisation must be able to bring its provider subscription as well as an API key. What each provider allows, and what is built, is in [llm-connectors](../ongoing/llm-connectors.md). This section is how those accounts meet the policy above.

**Each way in carries its own way of running the agent:**

| Account | Status | Runs on | What routing saves |
|---|---|---|---|
| Ghostaff's own (default) | Works | Claude on Vertex AI in the EU, through the Agent SDK | Ghostaff's money |
| The organisation's API key (Anthropic, OpenAI) or its own Vertex project | Built; not yet tried with a real key on the beta | The Agent SDK; the key comes from the vault | The organisation's money |
| Claude subscription | Decided, grey zone, not built | Only the unmodified `claude` program, with the user signed in through Anthropic's flow; the Agent SDK is not allowed | The plan's usage limits, not money |
| ChatGPT plan | On OpenAI's waitlist | The Responses API only; the Agent SDK cannot drive it | The plan's limits |
| OpenRouter | Planned | One-click OAuth key, then like an API key | The organisation's money |

**The shape:**

1. **An account resolver per organisation.** It orders the accounts the organisation has: its subscription, then its own key, then Ghostaff's Vertex EU. When one is refused or runs out, it moves to the next and tells the owner, never silently. `aiAccount` in `apps/engine/src/chatStore.ts` already picks Vertex before an Anthropic key; it grows into this.
2. **`ModelPolicy` resolves a tier on that account.** `light` / `standard` / `deep` become the model that account offers: Vertex EU ids, Anthropic ids, or, on a subscription, the `--model` and per-subagent model Claude Code takes.
3. **Interchangeable runners behind one interface:**
   - **Agent SDK runner** for Ghostaff's account, API keys and Vertex. Full control of model, effort and budget. This is the main path and the first to build.
   - **Claude Code runner** for Claude subscriptions: the `claude` program in a job per organisation. Built when subscriptions are switched on, not before.
   - **A Responses API runner** for ChatGPT plans, only if the engine goes multi-provider (that decision is still the product plan's).
4. **Agent definitions stay neutral.** Prompts, tools as MCP servers, and skills work the same in the Agent SDK and in Claude Code, so every runner reads one definition of each agent instead of one per provider.

**Data in Europe.** A Claude subscription or an Anthropic key sends the organisation's data to Anthropic, mostly in the US. The connect screen already says so; the resolver must not fall from an EU account to a non-EU one without the owner having chosen that account.

**The tradeoff:** every runner is code to keep and test against the same agents. One runner (Agent SDK) until a subscription is actually switched on keeps that cost where it pays.

## Open questions

1. **Is this the approach?** Routing by task family with abstract tiers, built in the engine, rather than renting a router or a learned per-prompt router from the start. Recommendation: yes; renting fails on EU residency, on organisations' own keys or on maturity, and a learned router needs data we do not have yet.
2. **Organisations with their own key pay their own AI.** Do they get the same cost-driven policy, a quality-first one, or a setting (in plain words, never model names)? Recommendation: same policy by default, since it is meant to lose no quality.
3. **Is Haiku 5.5 available on Vertex's EU multi-region?** Unconfirmed. Without it, `light` falls back to Sonnet for organisations on Vertex.
4. **Do the old engine's 11 agents get the same review now?** They run on a subscription (limits, not money), so it matters less, but they are the cheapest place to try phase 1's method on real work.
5. **Which account goes first when an organisation has several?** The order above (subscription, own key, Ghostaff) spends what the organisation already pays for first. A subscription is the least reliable (Anthropic can cut it without warning) and leaves the EU, so the alternative is own key first and the subscription only when the owner asks for it.
6. **Where do the evals live?** In this repo next to the engine, or with each organisation's record. Likely here for the families every organisation shares, since the test cases come from Ghostaff's own organisation first ("Ghostaff uses Ghostaff").
