# A guide that walks a person through giving an agent access

**Priority:** high — Jaime (2026-11-24): «una parte super importante del producto que hay que trabajar muy mucho»: the agent will need access we never built a connector for, and a non-technical person has to be able to give it
**Gate:** none
**Next:** Task 1 of [the first slice](#build-the-first-slice-a-self-hosted-wordpress), in a worktree off `develop`: the guide's shapes and their validation in `packages/shared/src/guides.ts`

## Goal

When an agent needs access that isn't a single «Conectar» button (a user in the customer's WordPress, a key from an app we don't have, making an Instagram account professional), it hands the person a **guide**: a short screen, step by step, in plain words, that adapts to what the person actually sees, takes a photo of their screen whenever they are lost, and ends with Ghostaff checking the access works and the agent going on with its task.

The value: the agent can ask for connections nobody planned for, and a person who has never seen an API key still gets it done.

## Context

- **What exists:**
  - [connector-in-chat.md](../ongoing/connector-in-chat.md) covers access that is one button away (kinds A and B): `ask_for_account`, the `AccountAskPart` card, `account_asks` and `POST /threads/:id/resume`.
  - [agent-access-requests.md](../ideas/agent-access-requests.md) covers Google Cloud IAM for a technical owner, with commands and Terraform.
  - [connectors.md](../ongoing/connectors.md) kind C plans the forwarding address and file uploads.
- **The gap:** everything in the long tail that needs **the person to do something in another app's screens**. Today the agent can only say «Pedirlo», which counts the request and leaves the task stuck.
- **This builds on connector-in-chat's pattern**, it doesn't replace it: a tool the reply intercepts, a card in the message, a row the engine trusts, and the same resume once the access is checked. A guide carries more state than an ask (its steps, who completed it, an owner's approval), so it gets its own table and part rather than one more `need` on `account_asks` (see [the build](#build-the-first-slice-a-self-hosted-wordpress)).

## Design

### Treat the agent as a new employee

When you hire someone, you give them an email and invite them to your tools. Every shop owner knows how to do that. So:

- **Each agent has its own email address** (`redes@acme.ghostaff.ai`; decision 1).
- Many accesses then stop being «create an API key» and become **«invite this email as a user, with this role»** in Shopify, WordPress, Analytics, Holded or Meta Business. That is one instruction anyone can follow, and the person keeps control in their own tool (they can see the user and remove it).
- The same address receives invitations, verification mails and forwarded documents (kind C's forwarding address).

**The agent always picks the highest way in that exists:**

1. our connector or the maker's MCP (one button, connector-in-chat);
2. invite the agent's email as a user with the least role that does the job;
3. a key or token the app issues for this purpose;
4. forwarding or exporting a file;
5. **never** the person's own password.

### A fixed shell, dynamic content

The screen is always the same **shell**:

- **At the top:** the goal in one line («Acceso a tu web») and the progress.
- **At the bottom, always visible:** a big **«Enséñame tu pantalla»** button (camera or screenshot) and the microphone ([voice.md](../ongoing/voice.md)). The photo is the main way to ask for help, not a fallback hidden in a menu.
- **A way out:** «Que lo haga otra persona» and «Más tarde».

What goes inside each step, the AI decides, but only from a **closed catalogue of blocks**:

| Block | What it shows |
|---|---|
| `title` | One sentence, at most ~6 words |
| `bullets` | One to three short points |
| `choice` | «¿Qué ves?» with options that each carry a drawing or reference image |
| `annotated_shot` | The person's own screenshot with a circle or an arrow drawn on it |
| `copy_value` | A value to copy (the agent's email, a role name) |
| `secret` | A field whose value goes straight to the vault (below) |
| `confirm` | «Ya está» / «No me sale» |
| `check` | Ghostaff tries the access and says whether it works |
| `scope` | One line on what the agent will and won't be able to do |

**Why a closed catalogue and not free generated UI:** free UI is more flexible, but every screen risks drifting from the design, and text the agent reads (the customer's own web page, a mail) could get it to draw a form that asks for a password. With fixed blocks the look is always the same, a secret can only travel through `secret`, and adding a block is our decision, not the model's. Tradeoff: a step the catalogue can't express has to wait for a new block.

**Text rules:** no paragraphs. A title plus at most three bullets per step. Every technical word has a tap-to-explain line. The tone is the product's Spanish: «Pulsa», «Abre», never «Haga clic».

### The loop: a goal, not a script

A guide is a **goal** («Redes can publish on the web»), a **check** for it, and the steps so far. After each answer or photo the model picks the **next step**, with the person's screenshot and the history in view. There is no fixed script:

- First step, almost always: «¿Qué ves?» or «Enséñame tu pantalla». The answer decides the path. If the photo shows Wix instead of WordPress, the guide changes course with nobody having written that case.
- **«No me sale» → a photo.** A vision model finds where to press on *their* screen and returns that screenshot with the mark drawn on it. When it isn't sure, it says so and asks for another photo rather than inventing an arrow.
- If a proven guide exists for this app (below), it is given to the model as a hint, not followed blindly.

### What the person hands back

- **`secret`**: the value goes from the app to the engine and into Secret Manager (invariant 3). The model never reads it, it is never stored in a message, and it only shows masked afterwards. A format check where the app has one (length, prefix).
- **Pasted in the normal chat by mistake:** the engine spots a key-shaped string, removes it from the message, offers to keep it in the vault, and says so.
- **Done means checked:** the `check` block tries the access as the agent would (log in with the invited user, call the API with the key). If it works, the ask turns `done` and the existing resume picks the task up. If not, the guide says what is still missing and goes on from there.
- **Every guide stores how to undo it** (remove the user, revoke the key), kept beside the grant, as [agent-access-requests.md](../ideas/agent-access-requests.md) does for IAM.

### Guides that learn

- **The first time** an app comes up, the agent drafts the path from the maker's docs.
- **When a guide ends checked**, its path is saved, without the organisation's data or screenshots, as a **proven guide** for that app. The next organisation gets that path as the hint.
- **Signals from use:** the steps with the most «No me sale», and screenshots that no longer match the step (the maker changed its screens), flag a guide for review.
- **The most used ones** we polish by hand.

The long tail gets solved once per app, not once per customer. That is hard to copy, because it comes from real use.

### Someone else does it

Common in small businesses: «la web la lleva mi sobrino», «eso lo tiene la gestoría». **«Que lo haga otra persona»** sends that person a link to the same guide, with no Ghostaff account ([external-parties.md](../ideas/external-parties.md)). The owner sees the progress, and the access arrives when the check passes.

### Phone and computer

Most of these tasks happen on a computer. The guide starts wherever the card is pressed. When a step needs a computer, it says so and offers a QR code or a link to carry on on the web ([desktop-web.md](../ideas/desktop-web.md)), where the person can **share their screen** (`getDisplayMedia`) and be guided live instead of sending photos. The phone stays useful for photographing the monitor.

### Where it shows

A card in the chat drawn like connector-in-chat's (its own `GuidePart`): «Necesito acceso a tu web» · the `why` line · «Empezar». It opens the guide full-screen. A guide in progress shows in Hoy as something waiting on the person, and resumes where it stopped.

## Rules

- **Ghostaff never asks for the person's own password**, and never opens or suggests a link outside the maker's own domains (an allow-list per app).
- **Least access:** the smallest role that does the job, read before write. The `scope` block says it before the person grants anything.
- **A member's grant waits for an owner** (decision 2): checked and stored, but unused until an owner approves it.
- **A guide only asks**: the access is granted by the person in their own tool. Writes the agent later makes still wait for approval, as today.
- **Screenshots belong to the organisation and are not kept**: a photo goes to the engine with the step it asks about, to the model, and is dropped. The app keeps the last one on the device to draw the mark. None ever goes into a proven guide.

## First case: access to the customer's WordPress

Chosen because it forces the hard parts: hostings and themes show it differently, so the guide has to adapt, and people need photos. It also exercises the «add the agent as a user» path.

1. «¿Qué ves al entrar en tu web?»: `choice` (black bar on the left / menu at the top / none of these) plus the camera.
2. «Abre Usuarios»: bullets, and on «No me sale» the person's screenshot with «Usuarios» circled.
3. «Añade a Redes»: `copy_value` with the agent's email, the role «Editor», and `scope` («Podrá escribir entradas. No podrá tocar pagos ni usuarios»).
4. «Crea su contraseña de aplicación», on that user's page; the person pastes it into a `secret` block, with the web's address and the user's name.
5. `check` calls the web as that user and confirms the role; resume.

If the photo in step 1 shows a site on WordPress.com (or Wix), the guide hands over to that connector's own button. That branch is the first test that it is really dynamic. Why an application password and not an invitation the agent accepts: [the build](#build-the-first-slice-a-self-hosted-wordpress).

## Decisions

1. **One email address per agent** (Jaime, 2026-11-24), `<agent>@<org>.ghostaff.ai`, not one per organisation. It reads like an employee, each agent's access stays apart (removing Redes's user in WordPress doesn't touch Finanzas), and the person sees in their own tool which agent can do what. Cost: an organisation that wants two agents in the same app invites two users, and the inbound mail (kind C) routes by agent, not just by organisation.

2. **Owners and members may complete a guide** (Jaime, 2026-11-24). The member the agent was talking to is often the one with the account (the person who runs the web), so the card's «Empezar» shows to them too, unlike connector-in-chat's decision 1 where only owners connect. What a member grants **waits for an owner's approval before the agent uses it**: the check still runs when the guide ends, the secret still goes to the vault, but the access stays `pending` and owners get a card, «Luis ha dado a Redes acceso a la web (Editor) · Aprobar». An owner completing a guide needs no second step. This keeps «which accounts an agent reaches is an owner's call» (`agents.accounts`, `settings_agent_accounts`) while letting the person with the account do the work. *(The approval step was part of the recommendation Jaime picked; confirm it if in doubt.)*

## Open questions

3. **Vision cost:** the first slice uses the organisation's own AI accounts (Claude reads the photo). Whether a cheaper first pass is worth it is measured on real screenshots once guides run.
4. **Mail to the agents' addresses:** the first slice needs none (the application password replaces an invitation). Receiving mail at `<agent>@<org>.ghostaff.ai` waits for kind C's inbound mail in [connectors.md](../ongoing/connectors.md).
5. **Live screen sharing on the web:** the same loop on a frame every few seconds or on demand. Privacy: what is on screen besides the app.

## Builds on

- [connector-in-chat.md](../ongoing/connector-in-chat.md): the card, `account_asks`, resume.
- [agent-access-requests.md](../ideas/agent-access-requests.md): the same idea for Google Cloud IAM. Its request could be shown as a guide too.
- [connectors.md](../ongoing/connectors.md): kind C, the forwarding address, the vault.
- [external-parties.md](../ideas/external-parties.md), [desktop-web.md](../ideas/desktop-web.md), [voice.md](../ongoing/voice.md).

## Build: the first slice, a self-hosted WordPress

### What it delivers

Ana tells Redes «Publica un borrador en mi web». Her web is a WordPress she pays a hosting for. Redes has no access, so it calls `start_guide` and its message carries a card, «Necesito acceso a tu web». Ana, or Luis (the member who runs the web), presses «Empezar». The guide asks what they see, circles «Usuarios» on their photo, and walks them through adding a user with Redes's address and making an application password for it. They paste the web's address, the user's name and the password. Ghostaff checks them against the web. If Ana did it, the access works at once. If Luis did it, Ana approves it from the card. Redes then goes on by itself and proposes the draft (a write, so an approval card, as today).

A site on WordPress.com takes the other branch: the guide hands over to the catalogue's WordPress.com button.

### Why an application password, not an invitation

WordPress (5.6 and later) has **application passwords**: one per user and use, revocable on their own, valid only for its REST API, and the user's normal password does not work there. An administrator creates the user (any address, nobody has to confirm it) and the application password for it, from the same screens. So the first slice needs **no mailbox** for the agent: its address is its identity in WordPress (decision 1), not yet something that receives mail. The guide says to untick sending the notice to the new user.

Known walls the guide will meet and must say plainly, not get stuck on: the web is not on https (WordPress refuses application passwords), or a security plugin or the hosting turned them off. The guide then ends as «bloqueada» with the reason, and the agent hears it.

### Where the access lands: one shape for any app with an API

The steps are dynamic; where the access lands has to be fixed, so the engine can check it and the agent use it without ever seeing it. One generic **landing** covers any app with an HTTP API, so the next app with a key needs a guide and no engine code:

- **`auth`:** `basic` (a user and a password), `bearer` (a token) or `header` (a key in a named header).
- **`base`:** the address the person types, normalised (https only, no path after it), plus a suffix the agent gives (`/wp-json`).
- **`check`:** a GET path under `base` that must answer 2xx, and optionally one expectation: a top-level JSON field that must include a value (`roles` includes `editor`).

The agent proposes the landing when it starts the guide. What the guide may ask the person for follows from `auth`, and nothing else: `basic` → `base_url`, `username`, `password`; `bearer` → `base_url`, `token`; `header` → `base_url`, `key`. A `secret` block can only be `password`, `token` or `key`.

Once the access is there, the agent gets **one tool for it**, `<provider>_request` (`method`, `path`, `query`, `body`). It reaches only paths under `base`, only public addresses (`fetchPublic`), with the credential added by the engine. GET reads. Any other method writes, so it waits for an owner's approval like every other write. The answer is clipped like any tool's.

**A guided access belongs to one agent.** It is that agent's identity in the customer's tool, so only that agent gets the tool, whatever `agents.accounts` says.

### The guide's model

- **One model call per step**, through the organisation's AI accounts in the same order as a reply (`aiAccounts`, `writerFor`). Nothing new to pay for or set up.
- **The step comes as a tool call.** The model has one tool, `show_step`, whose input is the step. `parseGuideStep` checks it against the catalogue and its limits: a title of at most 60 characters, at most three bullets of at most 90 each, a `secret` only for a field the landing allows, a mark inside the photo (0–1). If the step is invalid, the model is asked once more with the error. If it is still invalid, the guide shows the fallback step, «Enséñame tu pantalla».
- **What it reads:** the goal, the app, the landing, the agent's address, and the steps and answers so far. It never reads a secret: secret values never leave the screen until the check.
- **The photo:** only the latest one, as an image. On an API or Google Cloud account it is an image block (`ModelTurn` gains `images`, which `streamWith` maps). On a subscription, Claude Code gets the photo as a file in its throwaway HOME and may use only its `Read` tool, on that one file.
- **No links in v1.** The catalogue has no link block, so a guide cannot send anyone to a page it chose. That closes the phishing door until an allow-list per app exists.
- **Its prompt** carries the text rules (Spanish, «Pulsa», no paragraphs, never the person's own password) and the walls above.

### Data

- **`guides`**, one row per guide: `id`, `org_id`, `thread_id`, `message_id`, `agent_id`, `app` (≤80), `goal` (≤200), `why`, `landing` (jsonb), `history` (jsonb: the steps shown and the answers given, never a secret), `status`, `blocked_reason`, `undo` (how to remove the access, written by the model on the last step), `started_by`, `completed_by`, `decided_by`, `resumed_at`, timestamps.
  - `status` moves `open → checked → done | rejected` when a member completes it, `open → done` when an owner does, and `open → blocked | handed_over` (a wall, or the catalogue's button took over).
  - Row-level security on and no policy: the engine reads and writes it, and the app goes through the engine. A pgTAP test proves no member reads or writes it.
- **`connections`** grows a kind: `kind = 'guided'`, `method = 'guided'`.
  - `provider` is `x` plus the app's slug (`xwordpress`). No catalogue id starts with `x`, and a test in `connectors.test.ts` keeps it that way.
  - A new nullable `agent_id`, required for `guided` and null otherwise; unique on (`org_id`, `agent_id`, `provider`) where `kind = 'guided'`.
  - `hint` is the user's name or the key's last four characters. `settings` is `{ base, auth, headerName?, app, guideId }`.
  - Members read it through the existing policy, as they read every connection.
- **The vault:** `guidedSecretName(orgId, guideId)` holds `{ username?, password? | token? | key? }` from the moment the check passes. It is removed on rejection and when the access is removed.

### Engine

- **`start_guide`**, a tool every model-answering agent has, intercepted in `writeReply` like `ask_for_account`. Its input: `{ app, goal, why, auth, base_suffix?, header_name?, check_path, expect?: { field, includes } }`. One guide per message. It records the row and adds a `GuidePart`. The model reads back: «Guía mostrada: termina el mensaje diciendo qué harás cuando tengas el acceso».
- **The prompt line:** use `ask_for_account` when the app is in the catalogue and connects with a button; use `start_guide` when it needs the person to do something in the app (a user, a key), for example a WordPress that is not on WordPress.com.
- **`GET /guides/:id`:** what the screen needs: status, app, goal, the current step, the landing's `auth`, the agent's address, and whether the caller may approve.
- **`POST /guides/:id/step`** `{ answer?, photo? }` returns the next step and saves it to the history. `photo` is `{ mediaType: 'image/jpeg', data }`, base64, refused above 2 MB. Anyone who may write in the thread may call it (decision 2).
- **`POST /guides/:id/check`** `{ values }` runs the check, through `fetchPublic` with a 15-second timeout:
  - It passes: the secret goes to the vault. If the caller is an owner, the guide is done (connection row, status `done`). If not, it becomes `checked` and the card asks owners to approve.
  - It fails: plain Spanish, next to the field that caused it. 401: «Esa contraseña no vale: tiene que ser la de aplicación». 404 on the base: «No encuentro tu WordPress en esa dirección». The expectation is unmet: «El usuario no tiene el rol Editor». A private or unreachable address: «Esa dirección no se abre desde internet».
  - Claims are conditional updates, so two presses finish once.
- **`POST /guides/:id/approve`** and **`/reject`**, owners only. Approving writes the connection. Rejecting removes the secret and tells the agent in the card's line.
- **`POST /threads/:id/resume`** takes `{ guideId }` beside `{ askId }`. The guide must be `done` and not resumed yet; `resumed_at` is claimed conditionally. The agent reads «<who>: Ya tienes acceso a <app>. Sigue con lo que se te pidió.», as with an account.
- **`DELETE /connections/guided/:id`**, owners only: removes the row and the secret. The app shows the guide's `undo` text, so the person also removes the user in their own tool.

### App

- **`GuideCard`** in `Message.tsx`, drawn like `AccountAskCard`:
  - `open`: «Empezar» for anyone who may write in the thread.
  - `checked`: «Aprobar» and «Rechazar» for owners; «Falta que lo apruebe Ana» for everyone else.
  - `done`: «Hecho por Luis · aprobado por Ana».
  - `blocked`: the reason.
  - `handed_over`: the catalogue's connect button (`useAccountConnect`).
- **The guide screen**, `app/(app)/guia/[id].tsx`, is the shell:
  - The goal and progress dots at the top. Dots for the steps done plus the current one, since the total is unknown.
  - The blocks in the middle (`components/guide/GuideBlocks.tsx`, one component per block type).
  - At the bottom, always: «Enséñame tu pantalla».
- **Photos:** camera or library on the phone (`expo-image-picker`); on the web, a file picker and paste. Each is resized to 1,568 px on the long side and JPEG 0.7 (`expo-image-manipulator`). Adding both is a native change: the next beta is a new build, which `beta.yml` already does.
- **`AnnotatedShot`** draws the mark the model returns (a box in 0–1 coordinates and a short label) over the last photo the device sent.
- **Secrets** stay in the screen's state, in a masked field, until the check. They are never logged and never sent with a step.
- **Services** in `@ghostaff/shared/services`: `getGuide`, `guideStep`, `checkGuide`, `approveGuide`, `rejectGuide`, `resumeAfterGuide`, `removeGuidedAccess`.
- **The chat resumes** a done guide that has not resumed yet, as it does for asks (`guidesToResume`, beside `asksToResume`).
- **Conexiones** lists guided accesses under «Accesos de tus agentes» (app, agent, hint), each with «Quitar», which shows the `undo` text first.

### Out of this slice

The library of proven guides, «Que lo haga otra persona», live screen sharing, voice inside the guide, showing open guides in Hoy, the agents' mailboxes, apps with no HTTP API, two accesses to the same app for one agent, and job agents.

### Review focus

The inputs no task's happy path covers, most likely first. Each has its test in the task that owns it.

1. **The web's address as people type it:** `miweb.com`, `http://miweb.com`, `https://miweb.com/wp-admin/users.php`, a trailing space. Normalised to `https://miweb.com`. Plain `http` is refused with a reason, not silently upgraded (Task 1).
2. **The person's own password in the password field:** WordPress refuses it on the REST API, so the check returns the 401 message about the application password and the guide does not end (Task 3).
3. **A step the model gets wrong:** an unknown block, four bullets, a `secret` for a field the landing doesn't allow, a mark outside 0–1, text instead of the tool. Rejected, one retry, then the fallback step (Tasks 1 and 4).
4. **An address that points inside a network:** `https://192.168.1.10`, `localhost`, a name that resolves to a private address. The check fails with «no se abre desde internet» and nothing is fetched (Task 3).
5. **Two people on one guide, or a double press:** check, approve and resume each happen once. A member's check after an owner already finished is refused as done (Task 5).

### File structure

- **Create** `packages/shared/src/guides.ts`, `packages/shared/test/guides.test.ts`.
- **Modify** `packages/shared/src/chat.ts` (`GuidePart`, `isGuidePart`), `packages/shared/src/index.ts`, `packages/shared/src/services/index.ts`, `packages/shared/test/connectors.test.ts` (no id starts with `x`).
- **Create** `supabase/migrations/20261126100000_guides.sql`, `supabase/tests/database/guides.test.sql`.
- **Create** `apps/engine/src/guidedAccounts.ts` (the request tool, the check, the store over Supabase), `apps/engine/src/guideModel.ts` (one step from the model), `apps/engine/src/guides.ts` (`start_guide`, the routes' logic, finishing and approving), and their tests in `apps/engine/test/`.
- **Modify** `apps/engine/src/chat.ts` (interception, the prompt line, the tool for every agent, guided tools for their agent in `orgReach`, resume with `guideId`, `ModelTurn.images`), `apps/engine/src/chatStore.ts` (`streamWith` maps images), `apps/engine/src/claudeWriter.ts` (the photo as a file, `Read` on it only), `apps/engine/src/vault.ts` (`guidedSecretName`), `apps/engine/src/app.ts` (routes), `apps/engine/src/server.ts` (wiring).
- **Create** `apps/mobile/app/(app)/guia/[id].tsx`, `apps/mobile/components/guide/{GuideBlocks,AnnotatedShot,ShotButton}.tsx`, `apps/mobile/components/chat/GuideCard.tsx`, `apps/mobile/lib/hooks/useGuide.ts`, `apps/mobile/__tests__/guide.test.tsx`.
- **Modify** `apps/mobile/components/chat/Message.tsx`, `apps/mobile/lib/hooks/useAccountAsks.ts` (resume guides too), `apps/mobile/app/(app)/(tabs)/empresa/conexiones/index.tsx`, `apps/mobile/package.json`.
- **Modify** `docs/architecture.md`: the agent's own identity in a customer's tool, and guided accesses beside connectors.

## Tasks

Each task lands green on its own (`pnpm check`; `pnpm db:test` for Task 2) and in order. A task's tests are named here with what they prove; the implementer writes them first.

- [ ] **1. Shared shapes** (`guides.ts`).
  - Types: `GuideBlock` (the nine blocks of [the catalogue](#a-fixed-shell-dynamic-content), plus `use_connector { connector }`), `GuideStep { blocks: GuideBlock[]; done?: { undo: string }; blocked?: string }`, `GuideAnswer` (`choice`, `confirm`, `text` values; never a secret), `GuideField` (`base_url`, `username`, `password`, `token`, `key`), `GuidePhoto { mediaType: 'image/jpeg'; data: string }`, `GuideLanding`, `GuideStatus`, and `GuidePart` in `chat.ts`.
  - Functions:
    - `parseLanding(raw: unknown): GuideLanding | { error: string }`
    - `fieldsFor(auth): readonly GuideField[]`
    - `parseGuideStep(raw: unknown, landing: GuideLanding): { step: GuideStep } | { error: string }`
    - `normaliseBase(input: string, suffix?: string): { base: string } | { error: string }`
    - `guidedProvider(app: string): string` (`'x' + slug`, at most 31 characters)
    - `agentEmail(orgSlug: string, agent: { slug: string | null; name: string }): string`
  - Tests:
    - **normaliseBase:** the four inputs of Review focus 1 give `https://miweb.com/wp-json` with suffix `/wp-json`; `http://` gives the error «Tu web tiene que empezar por https».
    - **parseGuideStep:** each limit of [the guide's model](#the-guides-model) rejected with its error; a valid WordPress step accepted.
    - **fieldsFor:** `secret` allowed only for `password` with `basic`.
    - **agentEmail:** `agentEmail('panaderia-ana', { slug: null, name: 'Redes Sociales' })` is `redes-sociales@panaderia-ana.ghostaff.ai`.
    - **connectors.test.ts:** no catalogue id starts with `x`.
- [ ] **2. Database.**
  - The `guides` table, row-level security with no policy.
  - `connections`: `kind` and `method` allow `guided`; `agent_id` (references `agents`, cascade); a check that `agent_id` is set exactly when the kind is `guided`; the unique index.
  - pgTAP: no member reads or writes `guides`; a member reads a guided connection of their organisation and not another's; a guided row without an agent is refused.
- [ ] **3. Guided accesses** (`guidedAccounts.ts`).
  - `checkLanding(landing, values, f: typeof fetch): Promise<{ ok: true } | { ok: false; field?: GuideField; message: string }>`
  - `guidedToolsFor(store: GuidedStore, vault: Vault, orgId: string, agentId: string, f?: typeof fetch): Promise<AgentTools>`
  - `guidedSecretName` in `vault.ts`; `supabaseGuidedStore(admin)`.
  - Wire into `orgReach`: merged only for the agent the access belongs to.
  - Tests:
    - each failure message of the check route, against a fake fetch, including Review focus 2 (401);
    - Review focus 4 with the real `fetchPublic` (nothing fetched);
    - `path` with `://`, `..` or a leading `//` refused;
    - GET reads and POST is reported as a write (`writes()`);
    - the tool is absent for another agent of the same organisation;
    - the credential never appears in the tool's output or step line.
- [ ] **4. The guide's model** (`guideModel.ts`).
  - `nextStep(deps: GuideModelDeps, guide: GuideState, answer?: GuideAnswer, photo?: GuidePhoto): Promise<GuideStep>`, where `GuideState` is `{ app, goal, landing, agentEmail, history }` (defined here; Task 5 builds it from the row) and `GuideModelDeps` is `aiAccounts` and `writerFor` from `ChatDeps`.
  - `ModelTurn.images?: { mediaType: 'image/jpeg'; data: string }[]`, mapped by `streamWith`; the subscription path in `claudeWriter.ts`.
  - Tests with a fake writer:
    - the photo reaches the writer as an image on the last turn only;
    - an invalid step, then a valid one, gives the valid one;
    - two invalid steps give the fallback;
    - no secret value is in any turn;
    - `claudeArgs` with a photo allows `Read` and nothing else.
  - **Real check, by hand:** one WordPress screenshot through a real API account places the mark on «Usuarios».
- [ ] **5. Starting, checking and finishing** (`guides.ts`, `chat.ts`, `app.ts`).
  - `start_guide` intercepted in `writeReply`, and the routes of [Engine](#engine).
  - Tests:
    - one guide per message;
    - a member's check gives `checked` and no connection;
    - an owner's check gives `done` and a connection for that agent;
    - approve and reject only by owners;
    - Review focus 5: a double check, a double approve and a double resume each happen once;
    - resume refused while `checked`;
    - `use_connector` gives `handed_over`.
- [ ] **6. The app: card, screen and photos.**
  - `GuideCard`, the guide screen, `AnnotatedShot`, `ShotButton`, `useGuide`, the services, and resuming guides from the chat.
  - Add `expo-image-picker` and `expo-image-manipulator` with `npx expo install`.
  - `guide.test.tsx`:
    - each card state shows the right action for an owner and for a member;
    - the secret field's value is not in the step request;
    - the mark is drawn at the box's position.
  - Then on the web against local Supabase with a stand-in model: light and dark, phone and desktop width. Review against the Web Interface Guidelines (AGENTS.md).
- [ ] **7. Removing an access, and the docs.**
  - `DELETE /connections/guided/:id` and «Accesos de tus agentes» in Conexiones, with the `undo` text before removing.
  - Tests: only owners remove; the secret goes with the row.
  - `docs/architecture.md` updated.
- [ ] **8. Proven for real.**
  - On beta, a public WordPress test site (needs one: a cheap hosting or a throwaway site; Jaime picks).
  - Run the whole guide with photos from a phone, as a member, then approve as an owner.
  - Redes resumes and proposes a draft; approving it publishes the draft on the site.
  - Write what was seen in Progress, then move this plan to `ongoing/`.
