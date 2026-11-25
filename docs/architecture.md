# Ghostaff's architecture

The high-level design of the platform: its parts, where each runs, who each part acts as, and how one organisation is kept apart from another. Read it before designing anything that touches the engine, the runner, a connector or a customer's systems.

It describes the platform as built, plus the target where one is decided and not yet built (marked **Target**). The work to get there lives in [plans](plans/); the reasons that outlive a plan, in [decisions](decisions/). When this file and the code disagree, fix one of them in the same change (AGENTS.md).

## The parts

```
 person ── app (Expo: iPhone, Android, web)
             │  Supabase session
             ▼
  ┌──────── Supabase (per environment) ───────┐      ┌── customer's systems ──────────────┐
  │ auth · Postgres with row-level security   │      │ record repo on GitHub              │
  └───────────────────────────────────────────┘      │ Google, Microsoft, makers' MCP     │
             ▲ service role                          │ Google Cloud (BigQuery, buckets…)  │
             │                                       │ AI accounts (Claude, Anthropic…)   │
  ┌──────── Google Cloud project (per environment) ──┴────────────────────────────────────┤
  │ engine        Cloud Run service: HTTP API, chat, connectors, runs, the tick           │
  │ agent-runner  Cloud Run job: one execution per agent run, the unmodified Claude Code  │
  │ vault         Secret Manager, EU only: every organisation's keys and tokens           │
  │ tick          Cloud Scheduler → POST /cron                                            │
  │ record store  Target: Forgejo on a VM, a repo per organisation, internal address only │
  └───────────────────────────────────────────────────────────────────────────────────────┘
```

| Part | Code | Runs | Does |
|---|---|---|---|
| App | `apps/mobile` | Phones (EAS builds, over-the-air updates), web | Everything a person sees. Reads and writes only through `@ghostaff/shared/services`, which call Supabase (row-level security) or the engine |
| Database | `supabase/` | Supabase, Frankfurt | Auth, every organisation's operational data. The app writes only through `security definer` functions that check the caller |
| Engine | `apps/engine` | Cloud Run service `engine` | Connects AI accounts and outside accounts into the vault, answers in the team chat, starts and receives agent runs, syncs the record on the tick. The only holder of the service-role key and the vault |
| Runner | `apps/runner` | Cloud Run job `agent-runner` | One agent run: fetches its spec from the engine once, clones the record, runs `claude -p`, pushes, reports |
| Sync | `apps/sync` | By hand | The record's `por-decidir/` into the database from a checkout. The engine's `recordSync.ts` does the same on the tick through GitHub's API |
| Shared | `packages/shared` | Everywhere | Models, the record's file formats, the data services |
| Record store | **Target** | A Compute Engine VM per project | Forgejo: every organisation's record, the agents' instructions and memory. See [Target: the record](#target-the-record) |

### Environments

| | Branch | Google Cloud | Supabase | App |
|---|---|---|---|---|
| Beta | `develop` | `ghostaff-beta` | `ghostaff-beta` | `ai.ghostaff.app.beta` |
| Production | `main` | `ghostaff-prod` | `ghostaff-prod` | `ai.ghostaff.app` |

CI deploys each from its branch: migrations, runner, engine, app ([environments.md](plans/ongoing/environments.md)). Each project's Workload Identity provider accepts only its own branch, so a `develop` build can never deploy production. Values per environment are in `scripts/env.sh`; a project's one-time setup is `scripts/setup-env.sh`.

### The legacy engine

Until they move, Órdago's agents run in `ghostaff-ai/agents`: Claude Code in a container, one Cloud Run job per agent in Órdago's own project `ordago-agents`, each with its own service account, roles on `ordago-prod` and secrets, reporting by Telegram and to the engine. The engine knows them as agents with runner `ordago_job` and only starts their job and writes their report into the thread. They do **not** use the organisation's AI accounts from Conexiones: they read Órdago's Claude token from `ordago-agents`' Secret Manager. Moving them is [ordago-agents-in-ghostaff.md](plans/ongoing/ordago-agents-in-ghostaff.md).

## How an agent works

An agent row says how it runs (`agents.runner`):

| Runner | Where it thinks | Its AI | Its tools | Used by |
|---|---|---|---|---|
| `chat` | Inside the engine, one reply at a time | The organisation's AI accounts, in the owner's order, failing over to the next | Connected accounts' tools; a write waits for an owner's approval card | Agents created in Ghostaff |
| `ghostaff` | One execution of `agent-runner` | The first Claude subscription in the owner's order | Claude Code's own tools on a clone of the record | Órdago's Legal (on demand) |
| `ordago_job` | A job in `ordago-agents` (legacy) | Órdago's token in its own Secret Manager | Whatever its YAML gives it | Órdago's other agents |

**Routines** ([agent-routines.md](plans/ongoing/agent-routines.md)): whatever the runner, a person may give an agent routines, «cada viernes a las 9, mándame el resumen de ventas». On the tick, a due routine is a message the clock writes for its creator: the engine answers it in their chat with the agent as it would answer them, with a chat turn (`chat`) or a run (`ghostaff`); no settings tools, since nobody is there to read as. A team routine's answer is copied to everyone else who sees the agent; one with nothing to tell (`SIN NOVEDAD`) leaves nothing. `ordago_job` agents take none. An agent's own `schedule` (from its definition) still starts its usual task as below.

A run on our runner, end to end:

1. A person writes to the agent, or the tick finds its timetable or one of its routines due.
2. The engine records the run with the hash of a one-time nonce and starts an `agent-runner` execution with only the run id and the nonce.
3. The runner calls `POST /runs/:id/spec` with its Google ID token and the nonce. The engine checks both and hands over, once: the prompt, model, tools, turns, a one-hour GitHub token for the record only, and the organisation's Claude token from the vault.
4. Claude Code works on the clone as the unprivileged user `agente`, under a read-only constitution and a push guard.
5. The runner reports to `POST /runs/report`: the answer lands in the thread, or in each person's chat for a scheduled run with news; the decisions it opened reach the inbox through the sync; usage and limits go to the AI account's card.

### Target: the record

Decided 2026-11-24 ([agent-memory.md](plans/ready/agent-memory.md), [record-store.md](plans/ongoing/record-store.md)). The record store is being built: beta's VM is up, and the engine and runner use it once that plan's stage 2 lands; agents' instructions and memory in it are not built. The rule is invariant 4: what agents work on are files with history, and the app reads the database.

**What an agent is made of**, and where each part lives:

| Part | Lives in | The database keeps | Changed by |
|---|---|---|---|
| Its instructions | The record: `agentes/<slug>/AGENTS.md` | A projection (`agents.task`) for chat turns | Owners, in the app or through Secretaría after their OK; each change a commit |
| The organisation's memory («Empresa») | The record: `memoria/empresa/` | A projection (`memories`) | Secretaría; owners in the app |
| Its own memory | The record: `memoria/agentes/<slug>/` | A projection (`memories`) | That agent; owners in the app |
| What it knows about one person («Sobre ti») | **The database only**, row-level security to that person | It is the master | That agent in that person's private conversations; that person |
| Its timetable, tools, model, who may see it | The database: the agent row | It is the master | Owners (settings, rule 6) |
| Conversations | The database: `threads`, `messages` | It is the master | People and agents |

«Sobre ti» stays out of the record because every run of every agent clones it, so nothing in it can be private to one person. Access stays on the row because row-level security, not a file anyone with a clone could change, is what enforces it.

**Where the record is.** One Forgejo per environment, on a Compute Engine VM in the environment's project, with no public address: the engine and `agent-runner` reach it through Direct VPC egress. A repo is made for every organisation by the tick, within five minutes of its creation (`recordProvision.ts`). The engine is its admin (like the service-role key for the database); each agent is a Forgejo user with write on its organisation's repo only, and a run gets a token for that user, deleted when it reports. A server-side hook refuses, by pusher, what an agent may not write (Empresa unless Secretaría, another agent's memory, any `AGENTS.md`). An organisation that brings its own GitHub repo as master (Órdago, until its migration ends) is read and written through the same interface with the GitHub App; afterwards GitHub is only a push mirror, the live copy.

**What it adds to each environment's project**, and what it costs (estimated 2026-11-24 in `europe-west1`; check Google's pricing calculator before building):

| Resource | What for | A month |
|---|---|---|
| VM `record-store`, `e2-small` (2 shared vCPU, 2 GB), Forgejo's container | Every organisation's repo and Forgejo's SQLite database | about 13.5 $ |
| Its `pd-balanced` disk, 20 GB | The repos; resized without stopping the VM, about 1 $ per 10 GB more | about 2 $ |
| A snapshot schedule: daily, 30 days, stored in the EU; a monthly restore check | Backups | 1–2 $ |
| A firewall rule (the VPC only) and Direct VPC egress on `engine` and `agent-runner` | No public address | — |
| `FORGEJO_ADMIN_TOKEN` in Secret Manager (listed in `secrets/inventory.yml` when created) | The engine as Forgejo's admin | — |
| In Forgejo: a repo per organisation, a user per agent (`agent-<id>`), branch protection and the pre-receive hook on each repo | Separation and write rules | — |

About 16–18 $ per environment, 35 $ for beta and production, whatever the number of repos: Órdago's record (900 commits) is about 30 MB, so 20 GB holds some 600 of its size and thousands of new ones. Past that it grows by disk and by a larger machine (`e2-medium`, about 27 $), not per repo. Not covered: high availability (one VM, restarted by Compute Engine) and a person cloning the record (no public door yet).

**How a turn uses it.** A chat turn reads instructions and memory from the database's projection and writes memory through tools shaped like Anthropic's memory tool, which land in the projection and go back to the record as a commit. A runner turn has the record cloned and reads and writes the files directly. The sync is `por-decidir/`'s: the record wins; an edit made outside it is written back on top of the head it read.

## How a push reaches a phone

An agent's reply, and once a day the decisions that wait, reach a person who has the app closed. The path ([decision-notifications.md](plans/ongoing/decision-notifications.md)):

1. **Trigger.** `messages_notify` (`supabase/migrations/20261126400000_notifications.sql`) fires when an agent message becomes `done` or `failed` and writes one `push_outbox` row per person to tell, so every path that writes agent messages is covered without calling anything. Phones register in `device_tokens` through `register_device` and leave through `forget_device`, both `security definer`.
2. **Drain.** The engine (`apps/engine/src/notify.ts`) claims rows with `claim_pushes`, which closes replies older than an hour as `stale` instead of sending a backlog, and sends each through `apps/engine/src/push/`: APNs over HTTP/2 for iPhones, FCM v1 for Android, both with a 10 s timeout. A failed row is retried up to `MAX_ATTEMPTS` times, the two-minute reclaim of a claimed row being the backoff. A request that wrote an agent message waits at most 3 s for its pushes (`drainSoon`) before answering, because Cloud Run throttles CPU outside requests; the tick drains whatever that missed every five minutes and queues the daily push (`planDaily`, from `daily_push_candidates`, 09:00 in the phone's time zone).
3. **The phone.** `apps/mobile/lib/push/` asks for permission once, after the first message to an agent (`softAsk`), registers the token (`PushProvider`, `registeredToken`) and reads a tapped push (`pushClient`; on iOS from the trigger's `payload`, since direct APNs pushes don't fill `content.data`). The `(app)` layout opens the chat or Decisiones only once its gates (signed in, organisation chosen) pass.

**Only names travel.** A payload carries the agent's and the organisation's name and ids, never a message's or a card's text: Apple and Google see nothing of the record. One push per conversation replaces the last (`collapseId`).

**Configuration.** The engine's Google Cloud project sends FCM (`FIREBASE_PROJECT` in `scripts/env.sh`) and reads the APNs key from the Secret Manager secret `apns-auth-key` (`scripts/apns-key.mjs` writes it, `scripts/deploy-engine.sh` wires both). Without them the engine's pushes are off, and nothing else changes.

## Keeping organisations apart

Invariant 1 of the product: an organisation's record, data, documents and keys never mix with another's. Each layer enforces it on its own:

- **Database:** every table with an organisation's data has `org_id`, row-level security and a pgTAP test proving another organisation's member can neither see nor change it.
- **Vault:** one secret per organisation and connection (`org-<org>-ai-<connection>`, `org-<org>-account-<provider>`), replicated only in the EU. The key itself never reaches the database or the app.
- **Record:** the GitHub App «Ghostaff Registro» is installed by each organisation on its own repo; a token is minted per installation and limited to that repo. **Target:** a repo per organisation in our own Forgejo, each agent a user with write on its organisation's repo only ([Target: the record](#target-the-record)).
- **Runs:** one runner identity serves every organisation, so the per-run nonce is what ties a call to its run. Without it, one organisation's run could fetch another's spec.

## Identities

Who each part acts as, and what it may reach. The rule: **Ghostaff's own identities never hold access to a customer's data.** Access to a customer comes from a credential that belongs to that organisation only, handed to one run, short-lived wherever the provider allows it.

| Identity | Acts for | May reach |
|---|---|---|
| A person's Supabase session | That person | What row-level security allows their membership; the engine checks the same membership on every call |
| `engine@<project>` | The platform | Secret Manager (admin: it creates, rotates and deletes organisations' secrets), Vertex AI for dictation billed to Ghostaff, the service-role key |
| `runner@<project>` | Nothing on its own | No role at all. It proves who it is to the engine with its ID token |
| `scheduler@<project>` | The tick | Calling the engine's `/cron` |
| `deployer@<project>` | CI, through Workload Identity from its branch only | Build and deploy; no secret's value, no IAM on the project |

Per organisation, never shared:

| Credential | Comes from | Lives | A run gets |
|---|---|---|---|
| Claude subscription token | The owner's sign-in through the unmodified Claude Code (`claudeSession.ts`) | Vault | The token itself (see Known gaps) |
| Anthropic or OpenAI key | Pasted by an owner, checked with the provider | Vault | Used by the engine, never sent to a run |
| Record access | The organisation's installation of our GitHub App | GitHub | A one-hour token for that repo only |
| Record access, **Target** | A Forgejo user per agent, created by the engine with the agent | Our record store | A token for that agent's user, write on its organisation's repo only, deleted when the run reports |
| Outside accounts (Google, Microsoft, makers' MCP servers) | The owner's OAuth sign-in | Vault | Their tools, through the engine; a write waits for approval |
| Agent's own identity in a customer's tool | A person's guide ([Guided accesses](#guided-accesses)) | Vault | Nothing: the engine adds it to the agent's own requests |
| Customer's Google Cloud | The organisation's own service account, below | Their IAM | A one-hour token for that account (**Target**: today only the engine's Vertex calls use it) |

### A customer's Google Cloud

Built for Claude on Vertex AI in the chat; the agents' own access from a run is **Target**.

A customer wants an agent to read their BigQuery, write to their bucket, call their Vertex AI. Granting one shared Ghostaff service account across every customer would make our code the only thing keeping customers apart: if organisation A typed `ordago-prod` as its project and Órdago had granted the shared account, A's agent would read Órdago's data. Google would see the same identity both times and could not tell them apart (a «confused deputy»). Instead:

```
ghostaff-tenants-<env>                          customer's project
──────────────────────                          ──────────────────
org-<id>@ghostaff-tenants-<env>   ◄── roles ──  BigQuery dataViewer on their dataset,
  (one per organisation)                        jobUser on their project, …
        ▲ token creator, on this account only
engine@  ── mints a one-hour token as org-<id>@ ──►  the run
runner@  ── no role anywhere
```

1. **An account per organisation, created when its owner first connects Google Cloud** in Conexiones, not when the organisation is created. The engine creates `org-<first 24 hex digits of the id>@` through the IAM API, grants itself token creator on that account alone, and keeps its email in `cloud_accounts`, a table only the engine reads (`apps/engine/src/cloudAccounts.ts`).
2. **The customer grants roles to that account** in their own project, with the exact command the app shows. Ghostaff checks the grant **as that account**, not as the engine, so the check proves the access belongs to this organisation.
3. **Each run gets a one-hour token** for the organisation's account, in its spec, the way it gets the record's token. Claude Code's `gcloud` and `bq` use it. Queries are billed to the customer's project (`jobUser` there).
4. **The account lasts as long as the organisation**, so removing a connection and adding it again does not make the customer grant everything again. Deleting it with the organisation is still to build (there is no way to delete an organisation yet). A deleted account leaves the customer's grants pointing at a deleted principal, and one later created with the same name gets a new unique id and inherits nothing.
5. **The accounts live in a project of their own**, `ghostaff-tenants-beta` and `ghostaff-tenants-prod`, where the engine is admin of service accounts and of nothing else. In the main project that role would let the engine grant itself `engine@`'s, `runner@`'s or `deployer@`'s powers. A separate project also keeps the per-project quota of service accounts (100 by default, raised on request) away from the platform's own.

What this accepts: every agent of an organisation shares that organisation's grants (no per-agent least privilege yet); the token is readable by the agent during its hour, like the record's; a customer whose organisation policy restricts sharing to its own domain has to allow Ghostaff's tenants project first. Rejected: a shared account (the confused deputy above); customers' JSON keys (long-lived, and many organisations forbid creating them); an account per agent now (quota, and no customer has asked). Workload Identity Federation is the path for AWS or Azure customers, later. The work is [customer-cloud-access.md](plans/ongoing/customer-cloud-access.md).

Other secrets an agent needs (a mailbox password, a social network's token, a voice API key) follow the same shape: a secret per organisation in the vault, handed only to the runs of the agents that need it, and in the end a connector of their own rather than a loose variable.

### Guided accesses

For an app with an HTTP API and no connector (first case: a self-hosted WordPress), an agent gets **its own identity in the customer's tool**: a user or key made for it, never a person's. Its address is `<agent>@<org>.ghostaff.ai`, one per agent (decision 1 of [guided-access.md](plans/ongoing/guided-access.md)), so the customer's own audit log says which agent did what. An agent starts a guide, a person follows it and types the credential; the engine checks it before keeping it.

- **One generic landing**, so a new app needs a guide and no engine code: `auth` (`basic`, `bearer` or `header`), a `base` (the address the person typed, https only, plus the agent's suffix) and a `check` (a GET under `base` that must answer 2xx, optionally with one expected JSON field).
- **The credential lives in the vault** under one secret per guide (`guidedSecretName`) and is added by the engine to each request. The model never sees it, and it is cut out of what the app answers.
- **It belongs to one agent**: a `connections` row with `kind = 'guided'` and its `agent_id`. Only that agent gets the tool, whatever `agents.accounts` says.
- **One scoped tool, `<provider>_request`**: only paths under `base`, only public addresses (`fetchPublic`, so nothing inside a network), `_method` overrides refused. A GET reads and runs at once; every other method waits for an owner's approval like any write.
- **A member may do the guide; an owner approves it** before the agent uses it. Only an owner removes an access, which deletes the secret first and then the row (`DELETE /connections/guided/:id`). The guide's `undo` line tells the person how to remove the user in their own tool, since Ghostaff cannot.

### Principle: the agent asks a person for the access it lacks

Ghostaff will never have a connector for every system a customer uses, and it does not need one (Jaime, 2026-11-24). An agent that hits a wall it cannot pass (a 403 from BigQuery, a bucket it cannot write, an API that answers 401) does not fail and stop: it works out the least access that would let it go on, and **asks a person for it**, with the organisation's identity already filled in and the grant written out in the form that fits (commands, console steps, or Terraform for a customer who keeps IAM in code). An owner in the conversation is asked there; anyone else is told an owner has been asked; a scheduled run asks the owners in their own chats and waits. Once granted, Ghostaff checks the access **as the organisation's identity** and the work resumes where it stopped. Every grant asked for is kept: what, for which agent, why, by whom granted, so it can be reviewed and withdrawn.

**The agent proposes, the customer grants. Ghostaff never grants itself anything**, and never asks for a role that would let it (IAM admin on a customer's project). That is what lets this work for any system without a connector for it. Built connectors stay worth having for what is common, as fewer steps, not as the only way in. The design is [agent-access-requests.md](plans/ideas/agent-access-requests.md).

## Known gaps

- **The Claude token is readable inside a run.** It sits in Claude Code's environment, so the agent can print it with Bash, and so can anyone who can talk to the agent. Accepted while only Órdago's own agents use the runner; the fix is a local proxy that holds it out of the agent's reach (`apps/runner/src/lib.ts`, `agentEnv`).
- **The engine is Secret Manager admin on the whole project**, so a bug in it can read any organisation's secret. Its own code is the boundary there.
- **Target: the engine is the record store's admin**, as it holds the service-role key: a bug in it can read or write any organisation's record. Its own code is the boundary there; an agent's run never gets more than its own user.
- **The record's default branch has no protection** on GitHub's free plan; the runner's push guard is only a net. Our own record store closes it with branch protection and a server-side hook ([Target: the record](#target-the-record)).
