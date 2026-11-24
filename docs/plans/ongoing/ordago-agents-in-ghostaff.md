# Órdago's agents in Ghostaff: first the face, then the body, one agent at a time

**Priority:** high — Ghostaff uses Ghostaff: until Órdago's agents run through it, the platform is a chat with no work behind it
**Gate:** none
**Next:** move Legal for good: write `agentes/legal/AGENTS.md` in Órdago's record from its YAML `prompt` and what its README says about how it works (decision 2), make the runner read its instructions from that file instead of `agents.task` (`runner.ts`), then `org add-agents … --runner ghostaff --only legal` with its timetable and pause `ordago-legal` in `ordago-agents` in the same sitting

Álvaro asked (2026-11-21) how close Ghostaff is to running all of Órdago's agents, then to build what is missing. Where we stood that day: the app (sign-in, organisations, decision inbox, team chat, connectors, vault) is on the beta; the agents still run entirely in `ghostaff-ai/agents` (Claude Code in a container on Cloud Run Jobs in `ordago-agents`, on a timetable, working in `ordago-app/business`, reporting by Telegram), and the engine here only answers in chat. He took my picks with four changes («go», 2026-11-21).

## Decisions (Álvaro, 2026-11-21)

1. **The goal is that Ghostaff runs the agents itself** (in its own Google Cloud project, with its own record, keys and runner), not only that it is their face. Reached **incrementally**: first all twelve show in Ghostaff and are talked to there while they still run where they run; then they move one at a time, starting with one.
2. **The record lives in Ghostaff in the end** (product plan: one repo per organisation on storage we own, a live copy to Drive or GitHub). A record has one master, and today `ordago-app/business` is written by the twelve agents, the panel and people's own sessions, so **during the migration GitHub stays Órdago's master** and Ghostaff reads and writes it through a **GitHub record connector** (our GitHub App «Ghostaff Registro», installed on that repo only): the same connector any customer needs for the live copy on GitHub. **At the end the master flips**: the record moves into Ghostaff and GitHub becomes the copy. Organisation Ghostaff has its record in Ghostaff from day one.
3. **Telegram goes off as soon as Ghostaff works**: once every agent's replies and reports are checked arriving in the app on the beta.
4. **Five departments**: Dirección (Dirección, Correo), Finanzas (Finanzas), **Legal** (Legal), **Producto** (Producto, Desarrollo), Marketing (Comercial, Orgánico, SEO, Productor, La Mesa). `prueba` stays out.
5. **The first agent to move is Legal**: no outside account, no secret, only the record and the web, so it tests exactly the core (our runner, the org's Claude subscription, the record, decisions). Finanzas next, with the mail connector.
6. **Subscriptions in Conexiones**: «Claude · tu suscripción» first, by hosting the unmodified Claude Code's own sign-in (the narrow reading of Anthropic's terms, [llm-connectors.md](llm-connectors.md)); «ChatGPT · tu suscripción» through Codex next, only if OpenAI's terms allow hosting it for someone else. A warning when connecting; falling back to an API key when a subscription is refused.
7. **A job proves who it is with its own Google identity** (an ID token from Cloud Run for the engine's URL, checked against the agent's registered service account): no new key anywhere.

## How it fits together

- **The record connector.** An organisation's record is a GitHub repo reached through our GitHub App's installation, with a one-hour token the engine mints from the App's key in Secret Manager. Stored on the organisation: `record_repo` and `record_installation`.
- **One tick.** Cloud Scheduler calls the engine's `/cron` every five minutes as its own service account. Each tick syncs every organisation with a record (por-decidir → database, answers → record in one commit, through GitHub's API: no clone) and starts the agents run by Ghostaff that are due by their timetable.
- **Two runners while migrating.** An agent row says how it runs: `chat` (only answers in chat, today's agents), `ordago_job` (still a job in `ordago-agents`: the engine starts it with what the person wrote, as Telegram's webhook does), or `ghostaff` (our own runner job, `agent-runner` in `ghostaff-prod`).
- **Our runner** is the unmodified Claude Code in a container, like `ghostaff-ai/agents`' image: it fetches its run (prompt, tools, model, a record token, the org's Claude credential) once from the engine, proving who it is with its ID token and a one-time nonce, clones the record, runs `claude -p`, pushes, and reports.
- **Reports.** Every run of either runner ends with `POST /runs/report`: the answer to the person who asked lands in their thread; a scheduled run with something to say lands in the chat of each person who can see the agent (three-tabs.md, decision 12; it was a shared «Avisos» thread until then); every run is a row in `agent_runs`, which feeds «Hecho sin ti» on Hoy. A report also triggers that organisation's sync, so a decision an agent opens is in the inbox within a minute.

## Moving all of them, and Telegram off (Jaime, 2026-11-24)

Jaime lifted his gate of 2026-11-22: Órdago moves onto Ghostaff now, as its first customer, and what it lacks gets built into the platform for every customer. It started from La Mesa failing on a weekly limit after Jaime added a Claude account in Conexiones: the legacy jobs never read Conexiones, they read `ordago-claude-token` in `ordago-agents` ([architecture.md](../../architecture.md#the-legacy-engine)). When every agent runs on our runner, Telegram goes off and people talk to the agents only in Ghostaff and the panel.

### What each agent needs

From the YAMLs in `ghostaff-ai/agents/proyectos/ordago/agentes/` (2026-11-24). Our runner today gives a run the record, the web and the organisation's Claude subscription, and nothing else.

| Agent | Repos beyond the record | Google Cloud | Secrets | Other |
|---|---|---|---|---|
| Legal | — | — | — | Ready |
| Comercial | — | BigQuery: `ordago-prod.agentes.organizadores` | — | |
| SEO | `ordago-apps` | BigQuery: `ordago_bi.mart_weekly_web_traffic`; act as `search-console-reader@ordago-prod` | — | |
| Producto | `ordago-apps` | BigQuery: 19 `ordago_bi.mart_weekly_*` views | — | |
| Dirección | `ordago-apps` | BigQuery: `ordago_bi`; reads the other agents' transcripts | — | Transcripts kept by Ghostaff |
| Correo | — | — | Mailbox passwords for info@ and Gmail | No web tools |
| Finanzas | — | — | Gmail password | No web tools |
| La Mesa | `ordago-apps` | BigQuery: `ordago_bi.digest_snapshots`; Vertex in `ordago-media`; bucket `ordago-podcast`; act as `podcast-publisher@ordago-prod`; Pub/Sub `ordago-prod/notify` | — | Posts the episode as audio |
| Productor | `ordago-apps` | Bucket `ordago-agents-podcast`; `ordago-media` | ElevenLabs | Posts audio |
| Orgánico | `ordago-reels`, pushing to `main` | Firestore read in `ordago-prod`; buckets `ordago-agents-reels`, `ordago-prod-reels-publicacion`; BigQuery `agentes.altas_diarias`; runs the job `reels-publisher` in `ordago-prod` | Meta, ElevenLabs | |
| Desarrollo | `ordago-apps`, opening PRs | — | — | `ritmo` (at most 3 runs a day, CI queue), 3-hour runs, no web tools |

### What Ghostaff builds for it

1. **The organisation's Google Cloud** ([customer-cloud-access.md](customer-cloud-access.md)): one service account per organisation, a one-hour token per run, `gcloud` and `bq` in the runner. Órdago grants its account the union of the column above.
2. **More repos per run.** The GitHub App installed on `ordago-apps` and `ordago-reels` too; the spec lists the repos an agent may clone and push, each with its own token; `gh` in the image for pull requests.
3. **Secrets per agent.** An organisation's secret in the vault, named on the agent row, handed only to that agent's runs. Mail and Meta become connectors when those exist.
4. **What the legacy start-up does and our runner doesn't:** a per-agent timeout and size (Desarrollo needs 3 hours), forbidden tools, `ritmo` and its metrics, never two runs of one agent at once, «tell only if there is news» (`SIN NOVEDAD` covers it), transcripts kept per run for Dirección.
5. **Audio from an agent** in a thread shared by the people who should hear it (La Mesa for both founders), with the player the voice notes already have.
6. **A second Claude account** in Órdago's failover order: twelve agents on one subscription is exactly the weekly limit La Mesa hit.
7. **The prompt is a file of Órdago's record.** Each agent's instructions become `agentes/<slug>/AGENTS.md` in `ordago-app/business`, written once from its YAML's `prompt` and from what its `agentes/<a>/README.md` says about how it works; its «Indicaciones» and «Aprendizajes» become recuerdos in `memoria/agentes/<slug>/` ([agent-memory.md](../ready/agent-memory.md#the-agents-instructions-live-beside-its-memory)). Our runner reads the file from its clone; `agents.task` becomes the file's projection, read by the record sync, and editing it in the app (an owner, or Secretaría after an owner's OK: a setting in `packages/shared/src/services/settings.ts`, rule 6) is a commit to the record. The timetable, tools, model and access stay on the agent row.
8. **Órdago into production** with the first release: the organisation, its people, agents and connections made again in the production Supabase (the vault is per project, so the Claude sign-in, the GitHub App's installation and the Google Cloud grant are redone, not copied).

### Order

Fewest needs first, each one moved with `org add-agents --runner ghostaff --only <agent>` and its Cloud Scheduler job paused in `ordago-agents` in the same sitting: Legal → Comercial → SEO, Producto, Dirección → Correo, Finanzas → La Mesa, Productor → Orgánico → Desarrollo. Then Telegram off: the webhook deleted, `telegram` removed from `proyecto.yaml`, the jobs in `ordago-agents` deleted, and `ghostaff-ai/agents` archived.

### Decisions (2026-11-24)

1. **Beta now, production with the first release** (Jaime left it to me). Órdago's organisation, its Claude sign-in and its record connection already live on the beta, and the production app is not on anyone's phone yet; waiting for production would hold the move on the first release. The cost: a broken beta stops Órdago's agents, and the organisation is made again in production later (item 8).
2. **The prompt lives in the organisation's record**, `agentes/<slug>/AGENTS.md`, beside the agent's memory (Jaime, 2026-11-24; it replaces «on the agent row», decided earlier that day). The YAMLs are imported once and stop being a source: no customer will have a YAML in `ghostaff-ai/agents`, and each thing keeps one master. The record is the one repo per organisation, so the agent's instructions, skills and memory travel together, with git's history; the agent row keeps a projection for the chat and the settings people can't hold in a file (item 7).
3. **The panel stops launching agents** (Jaime): starting a run and seeing its state live only in Ghostaff, and `ordago-panel/lib/ejecuciones.ts` goes when the jobs do. A web page where a customer follows their agents is wanted as part of the product, later, converging with [desktop-web.md](../../ideas/desktop-web.md).

## Steps

1. **Record connector and the sync on a schedule.** Organisation fields, the GitHub App (a script that creates it from a manifest and puts its key straight into Secret Manager), `/cron`, Cloud Scheduler.
2. **The twelve agents in Equipo**, five departments, runner fields; `org add-agents` imports them from `proyectos/ordago/agentes/`. Writing to one starts its job; the reply comes back to the thread. In `ghostaff-ai/agents`: the arranque reports to the engine, the engine's service account goes in `lanzan`.
3. **Reports, «Avisos» and «Hecho sin ti».** Then Telegram off.
4. **Claude subscription in Conexiones.** ChatGPT is not built (2026-11-21): OpenAI lets a person use Codex with their own plan, but a hosted service running it for others needs OpenAI's approval through the «Sign in with ChatGPT» waitlist. Revisit once OpenAI approves Ghostaff ([OpenAI help](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan), [Codex discussion](https://github.com/openai/codex/discussions/8338)).
5. **Legal moves**: our runner, its timetable on its agent row and its instructions in `agentes/legal/AGENTS.md` (item 7), run on Órdago's subscription, the old job deleted.
6. **Ghostaff's own record store** ([record-store.md](../ongoing/record-store.md)) with organisation Ghostaff in it; then the rest move one at a time, and Órdago's master flips last.

## What only Álvaro does

- Run the deploy scripts (the agents' classifier blocks Google Cloud tokens).
- Create the GitHub App with the script (two clicks in Chrome) and install it on `ordago-app/business`.
- Connect Órdago's Claude subscription in Conexiones once it exists.

## Progress

- [x] Step 1, built (#25): `organizations.record_repo`/`record_installation`, `apps/engine/src/githubApp.ts`, `recordSync.ts`, `POST /cron`, Cloud Scheduler `tick` in `scripts/deploy-engine.sh`, `scripts/github-app-registro.mjs`. Waits on the App and a deploy.
- [x] Step 2, built: five departments and runner fields (`20261121100000_agent_runners.sql`), `org add-agents`, `apps/engine/src/jobs.ts` (a message starts the job; `POST /runs/report` answers in the thread). In `ghostaff-ai/agents`: `arranque/ghostaff.py`, the engine in `lanzan`. Waits on both deploys.
- [ ] Step 3: reports, «Avisos» and «Hecho sin ti» built with step 2 (`agent_runs`, a run that dies without reporting closed after eight hours on the tick); Telegram off once checked on the beta.
- [ ] Step 4
- [x] Step 5, built (our runner): `apps/runner/` (image: node 22, the unmodified Claude Code 2.1.330 as the user `agente`, a read-only constitution with the push guard; the entry fetches its spec once, clones the record through a credential helper on 127.0.0.1, runs `claude -p`, lists the decisions it opened and reports), `apps/engine/src/runner.ts` (a message or the timetable starts `agent-runner` with a run id and a one-time nonce, stored hashed; `POST /runs/:id/spec` once per run, `POST /runs/:id/record-token` for a run longer than the token's hour; the runner reports only with its run's nonce; the tick starts each agent once per fire time, Europe/Madrid, `croner` pinned), `20261121300000_ghostaff_runner.sql` (task, model, tools, turns, `last_scheduled_at`; runs' `nonce_hash`, unreadable from the app), `scripts/deploy-runner.sh`, `RUNNER_IDENTITY` in `scripts/deploy-engine.sh`, `org add-agents --runner ghostaff --only legal`. Waits on: both deploys (runner first), the Claude subscription connector (step 4) with Órdago's subscription connected, the record connector live, then the import. **When Legal flips, pause the old `ordago-legal` job's schedule (or remove `legal.yaml`) in ghostaff-ai/agents in the same sitting, so it never runs twice**; Legal only runs on 15 January, so there is time. **Done 2026-11-22:** Órdago's Claude subscription connected on the beta (the sign-in fix: Enter sent on its own, #40), `org add-agents --runner ghostaff --only legal` run, Cloud Scheduler `ordago-legal` in `ordago-agents` paused. **2026-11-23, Álvaro: both in parallel instead**, so as not to move ahead of Jaime's gate: `ordago-legal` resumed (old job on its timetable, as before), and Ghostaff's Legal imported `--on-demand` (no timetable; it runs only when written to in the chat). A redeploy of `ghostaff-ai/agents` (`desplegar.py`) updates that schedule: check it stays `PAUSED` after one (`gcloud scheduler jobs describe ordago-legal --project=ordago-agents --location=europe-west1`). A Telegram message to Legal still starts the old job until Telegram is off.
  - **Before Legal moves, confirm GitHub branch protection on the record's default branch** (`ordago-app/business`: no force push, no deletion). The runner's push guard is only a net: the run's record token can write any branch through GitHub's API. Checked 2026-11-21: `ordago-app` is on GitHub's free plan, where a private repo has no branch protection or rulesets (403 «Upgrade to GitHub Pro»). Álvaro accepts the risk (2026-11-21): no upgrade; a bad force push is recovered from a clone. Revisit before a customer organisation uses the runner.
  - **Known gap before any customer organisation uses the runner:** the organisation's Claude subscription token is in Claude Code's environment (`CLAUDE_CODE_OAUTH_TOKEN`), so the agent can read it with Bash, and anyone who can talk to the agent could get it printed. Acceptable while only Órdago's own agents run here; the fix is a local proxy that holds the token outside the agent's reach (`apps/runner/src/lib.ts`, `agentEnv`).
- [ ] Step 6
