# Órdago's agents in Ghostaff: first the face, then the body, one agent at a time

**Priority:** high — Ghostaff uses Ghostaff: until Órdago's agents run through it, the platform is a chat with no work behind it
**Gate:** none
**Next:** Álvaro creates the GitHub App (`node scripts/github-app-registro.mjs`) and runs the two deploys; then the agents import (`org add-agents`) and a first real message to Legal from the app

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
- **Reports.** Every run of either runner ends with `POST /runs/report`: the answer to the person who asked lands in their thread; a scheduled run with something to say lands in the agent's «Avisos» thread; every run is a row in `agent_runs`, which feeds «Hecho sin ti» on Hoy. A report also triggers that organisation's sync, so a decision an agent opens is in the inbox within a minute.

## Steps

1. **Record connector and the sync on a schedule.** Organisation fields, the GitHub App (a script that creates it from a manifest and puts its key straight into Secret Manager), `/cron`, Cloud Scheduler.
2. **The twelve agents in Equipo**, five departments, runner fields; `org add-agents` imports them from `proyectos/ordago/agentes/`. Writing to one starts its job; the reply comes back to the thread. In `ghostaff-ai/agents`: the arranque reports to the engine, the engine's service account goes in `lanzan`.
3. **Reports, «Avisos» and «Hecho sin ti».** Then Telegram off.
4. **Claude subscription in Conexiones.** Then ChatGPT if allowed.
5. **Legal moves**: our runner, its timetable and task in its agent row, run on Órdago's subscription, the old job deleted.
6. **Ghostaff's own record store** with organisation Ghostaff in it; then the rest move one at a time, and Órdago's master flips last.

## What only Álvaro does

- Run the deploy scripts (the agents' classifier blocks Google Cloud tokens).
- Create the GitHub App with the script (two clicks in Chrome) and install it on `ordago-app/business`.
- Connect Órdago's Claude subscription in Conexiones once it exists.

## Progress

- [x] Step 1, built (#25): `organizations.record_repo`/`record_installation`, `apps/engine/src/githubApp.ts`, `recordSync.ts`, `POST /cron`, Cloud Scheduler `tick` in `scripts/deploy-engine.sh`, `scripts/github-app-registro.mjs`. Waits on the App and a deploy.
- [x] Step 2, built: five departments and runner fields (`20261121100000_agent_runners.sql`), `org add-agents`, `apps/engine/src/jobs.ts` (a message starts the job; `POST /runs/report` answers in the thread). In `ghostaff-ai/agents`: `arranque/ghostaff.py`, the engine in `lanzan`. Waits on both deploys.
- [ ] Step 3: reports, «Avisos» and «Hecho sin ti» built with step 2 (`agent_runs`, a run that dies without reporting closed after three hours on the tick); Telegram off once checked on the beta.
- [ ] Step 4
- [ ] Step 5
- [ ] Step 6
