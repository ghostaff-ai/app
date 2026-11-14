# AI connectors: an organisation brings its own AI account

**Priority:** high — Álvaro (2026-11-14): connectors are a crucial part of the app, and AI accounts come first
**Gate:** none for API keys; OpenAI's acceptance for ChatGPT plans
**Next:** Álvaro tries a real key on the beta; then a beta build

## Goal

An organisation connects its own AI account, an API key or a subscription, so its agents run on that account and the AI bill is in its name. The default is still that Ghostaff provides the AI ([product plan, «Quién pone la IA»](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#quién-pone-la-ia)).

## What each provider allows (researched 2026-11-14)

| Provider | API key | Subscription |
|---|---|---|
| Anthropic | Yes, also through Google Cloud (Vertex AI, EU regions), Amazon Bedrock and Microsoft Foundry | Only by signing in to an **unmodified Claude Code** that we host, through Anthropic's own sign-in. Not through the Agent SDK, and not by collecting tokens ourselves (see below) |
| OpenAI | Yes | "Sign in with ChatGPT" (since DevDay, 2026-09-29): Go, Plus, Pro and Business users let an app spend their plan, with a weekly cap they set. A limited trial: a paid, hosted app like ours joins a waitlist ([interest form](https://openai.com/form/sign-in-with-chatgpt-interest/)). Responses API only, `store: false` and `stream: true`, no Files API or hosted tools |
| Google Gemini, Mistral, others | Yes | No sharing scheme exists |
| OpenRouter | One-click connect (OAuth PKCE): the user signs in to OpenRouter and we get a key on their account, no copying | — |

Sources: [Anthropic, Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance); [OpenAI, Sign in with ChatGPT docs](https://developers.openai.com/siwc/quickstart) and [help article](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites); [OpenRouter OAuth PKCE](https://openrouter.ai/docs/use-cases/oauth-pkce).

### Anthropic's wording on subscriptions

The authentication section (read 2026-11-14) says, in Anthropic's words:

- "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication."
- "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens."
- But it does not "prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code". Hosting Claude Code needs the Commercial Terms, the binary unmodified with all its sign-in methods left in, and each user billed on their own account.
- "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage", and Anthropic "may enforce these restrictions without prior notice". Since January 2026 it has blocked subscription tokens in third-party tools.

**Álvaro's decision (2026-11-14): build Claude subscriptions anyway, until Anthropic says otherwise.** He reads it as a grey zone. The narrowest way to build it is the hosted-Claude-Code exception: the subscription run calls the `claude` program itself (not the Agent SDK), and the user signs in through Anthropic's flow inside it. Still grey: in a job that starts fresh each run, the sign-in has to be kept between runs, which comes close to "store … session tokens", and a team of agents is not "individual usage". The risk falls on the user: Anthropic can cut off their subscription without warning. So the app shows a warning when they connect, and the engine falls back to an API key or Ghostaff's account when the subscription is refused.

## Decisions (Álvaro, 2026-11-14)

1. **First: API keys** for Anthropic and OpenAI, plus Google Cloud credentials for Claude in the EU. OpenRouter's one-click connect comes after.
2. **Apply to Sign in with ChatGPT now**, as a hosted app, through the interest form.
3. **Claude subscriptions are built**, as above, and dropped if Anthropic objects.
4. **Claude only in the engine for now.** The engine is the Claude Agent SDK ([build-first-version](build-first-version.md)), so a connected key replaces Ghostaff's own Claude access. Making the engine run several providers' models is a separate decision, for the product plan.

## How keys are kept (built 2026-11-14)

Decisions (Álvaro, 2026-11-14: "pick the best option long term"):

- **The key travels through the engine, never the database.** The app sends it once to `apps/engine`, a Cloud Run service in `europe-west1` that becomes the engine's always-on service. Not a Supabase function (not pinned to the EU, and our Google credentials would live in Supabase), not Supabase's vault (keys next to the data).
- **Secret Manager in `ghostaff-prod`**, one secret per organisation and provider (`org-<uuid>-ai-<provider>`), replicated only in `europe-west1`. A reconnect adds a version and destroys the old ones; removing deletes the secret.
- **The database keeps only that it exists** (`public.connections`): provider, method, last 4 characters, who and when. Members read their own organisation's rows; nobody writes from the app (pgTAP: `connections.test.sql`).
- **Owners only** connect or remove; the engine checks the membership, and a stranger gets the same refusal as a member.
- **Checked before saved:** listing models with the key (Anthropic, OpenAI), or asking Google whether our service account holds `aiplatform.endpoints.predict` on the customer's project.
- **Claude in the EU through the customer's Google Cloud with no file:** they grant our service account (`engine@ghostaff-prod.iam.gserviceaccount.com`) the role Vertex AI User, and type the project and an EU region (`europe-west1` or `europe-west4`).
- In the app: Organizaciones → «Conexiones de …», section IA, one card per option saying where the data goes.

## Progress

- [x] `public.connections` with row-level security and its pgTAP test.
- [x] `apps/engine`: `POST /connections/ai`, `DELETE /connections/ai/:provider`, `GET /identity`; unit tests; image builds; checked end to end against the local stack (owner, member, stranger, a key the real Anthropic and OpenAI reject).
- [x] The Conexiones screen.
- [x] Deployed 2026-11-14 by Álvaro running `bash scripts/deploy-engine.sh` (the agent's classifier blocks Google Cloud tokens, so he runs it): https://engine-664656500315.europe-west1.run.app, service account `engine@ghostaff-prod.iam.gserviceaccount.com`. Refuses unsigned calls (checked).
- [x] The migration on `ghostaff-beta` (2026-11-14, `supabase db push --remote` after Álvaro's one `supabase login` on this machine).
- [x] The beta's engine URL pinned in `app.config.ts` (public, like the EAS project id), so no EAS variable.
- [ ] A beta build.
- [ ] Tried with a real key on the beta.
- [ ] The engine reads the organisation's connection when it runs an agent (once the engine runs agents).
- [ ] Then: OpenRouter's one-click connect; ChatGPT plans once OpenAI accepts us; Claude subscriptions.

## Data in Europe

With the organisation's own Anthropic or OpenAI key, its data goes to that provider, mostly in the US: Anthropic's own API has no confirmed EU-only option yet (`inference_geo` offers `us` and `global`). Claude through Vertex AI in an EU region keeps it in the EU. The connect screen says this plainly for each option (invariant 2).

## Open

- `[unknown: how Claude Code's sign-in survives between Cloud Run Jobs without us storing the token]`
- `[unknown: OpenAI's terms for a hosted, multi-tenant app on Sign in with ChatGPT; the docs cover only open-source and local apps]`
- `[unknown: whether OpenRouter's EU routing is available to us, and on which plan]`
