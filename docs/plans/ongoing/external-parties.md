# External parties: the freelancers, companies and services an organisation works with

**Priority:** medium — the record and the agents get more useful once they know who does what outside, so they route work instead of asking every time
**Gate:** none
**Next:** pull request 2: `packages/shared/src/record/externos.ts` and the sync both ways in `syncOrg` (Tasks)

**Goal:** Each organisation keeps one list of the people, companies and services it works with outside, each with what it does for the organisation, the departments it works with and how to reach it. Owners add them in Empresa → «Con quién trabajáis»; any chat agent proposes the ones it sees in mail and invoices, and an owner confirms. The list is a folder of the record, `externos/`, and reaches the app through the database.

Álvaro's idea (2026-11-17); Jaime closed its open questions and the product details on 2026-11-26 (Decisions).

## Context

- The product plan's *Incorporación* agent already pulls «socios, clientes y proveedores que se ven» and «las cuentas y servicios que usa la organización» into the first record ([`ghostaff-producto.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#incorporación)). This gives that a proper home.
- The same section said that agent never makes «fichas de empleados o contactos». Jaime changed that rule on 2026-11-26 (ordago-app/business `e29bd28`, decision 1).
- **Órdago already keeps this by hand**: `suppliers/<slug>.md` (one Markdown file per freelancer: who, what they made, how they invoice) and `partners.md` in ordago-app/business. The format below follows that shape: one Markdown file per party, with the structured part on top so the app can read it.
- What the code does today (`develop`, `12b96ef`):
  - **The record → database pattern** exists twice: `por-decidir/` (rows in `decisions`, app answers written back on the tick, the record wins; `packages/shared/src/record/sync.ts`, `apps/engine/src/recordSync.ts`) and each agent's `agentes/<slug>/AGENTS.md` projected into `agents.task` (`projectInstructions`, read only). Both run in `syncOrg` on every tick, on GitHub records (Órdago) and on our record store (every other organisation, `record-store.md`).
  - **Rule 6 is built**: `packages/shared/src/services/settings.ts` holds `SETTING_TOOLS`, which run as a person; a tool that writes becomes an action card (`agent_actions`) that an owner approves, and the engine then runs it as that owner (`apps/engine/src/actions.ts`). Since the decision model's pull request 3, a pending action card is also a card in the deck (`my_pending_actions`), so this is the existing decision model's «an OK an agent asks for».
  - **Who gets which settings tools** (`apps/engine/src/chat.ts`, `reachOf`): the main agent every one; any other agent only its own routines (`ROUTINE_TOOL_NAMES`, filtered in `apps/engine/src/settings.ts`); **none in a turn nobody asked for** (a routine's), because the tools read as the person who asked.
  - **The record store's pre-receive hook** (`apps/engine/src/recordHook.ts`) decides what an agent may push.
  - **Empresa** (`apps/mobile/app/(app)/(tabs)/empresa/index.tsx`): Conexiones, Personas (+ Invitar), Registro, switching and signing out.

## Decisions (Jaime, 2026-11-26)

1. **People are allowed**, but only what they do for the organisation and how to reach them, added or confirmed by a person, never extracted behind anyone's back. The product plan's rule changed with it (ordago-app/business `e29bd28`, Incorporación, «Qué nunca hace»).
2. **Both ways in.** Owners add them by hand in the app, and agents propose the ones they see in mail and invoices, as an OK a person gives through the existing decision model: an action card in the agent's chat and in the deck (`agent_actions`, decision-model.md pull request 3).
3. **One list per organisation**, each party tagged with the departments it works with (`DEPARTMENTS` in `packages/shared/src/models`).
4. **The fields** are the basic ones: kind (person, company or service), name, what it does for the organisation (required), departments, and an optional email, phone and website. No free notes in the app.
5. **The screen** is a row «Con quién trabajáis» right under Personas in Empresa, which opens the list; adding and opening one happen from there.
6. **Only owners** add, change or remove one by hand and confirm an agent's proposal, like every setting (rule 6) and every action card: no new kind of approver. Every member sees the list.

## Design

### The file: `externos/<slug>.md`

New format, decided here before any code (AGENTS.md rule 4: the record's formats are ported or decided in a plan, not made up in code). Keys in Spanish, like `por-decidir/`:

```markdown
---
tipo: persona
nombre: Ana López
hace: Hace las ilustraciones de los carteles y de las redes
departamentos: [marketing]
email: ana@ejemplo.com
telefono: "+34 600 000 000"
web: https://analopez.es
alta:
  por: Jaime Rubio
  fecha: 2026-11-26 10:30
  propone: Marketing
---

Free Markdown, optional: what an organisation or Órdago writes by hand (what they made, how they invoice).
Ghostaff keeps it as it is and neither shows nor edits it.
```

- `tipo`: `persona` | `empresa` | `servicio`. `nombre` (1–120 characters), `hace` (1–300) and `tipo` are required; `departamentos` is a list of `DEPARTMENTS` ids, possibly empty; `email`, `telefono` and `web` are optional.
- `alta` is who added or confirmed it and when (Europe/Madrid minute, as `por-decidir/` answers), and `propone` the agent that proposed it, only when one did. It is how decision 1's «added or confirmed by a person» stays visible in the file itself, not only in git.
- `<slug>` is the name folded to `a-z0-9-` (accents dropped), with `-2`, `-3`… when taken. Chosen by the engine when it first writes the file; the name can change later and the file keeps its name.
- A file Ghostaff can't read (no front matter, a required key missing) is skipped and named in the tick's summary, as a bad `por-decidir/` file is; the rest still syncs.
- The reader and writer live in `packages/shared/src/record/externos.ts`, beside `porDecidir.ts`, with the same YAML library. The writer replaces the front matter and keeps the body byte for byte.

### The database: `external_parties`, a projection

The record is the master; the table is what the app and the chat read, as `decisions` is for `por-decidir/`.

| Column | |
|---|---|
| `id`, `org_id` | `org_id` references `organizations`, on delete cascade |
| `path` | `externos/<slug>.md`; null until the engine first writes it. Unique per organisation |
| `kind` | `person` \| `company` \| `service` |
| `name`, `role` | `role` is «what it does for the organisation» (`hace`) |
| `departments` | `text[]`, each in `DEPARTMENTS` |
| `email`, `phone`, `website` | nullable |
| `added_by`, `added_by_name`, `added_at` | the person who added or confirmed it |
| `proposed_by_agent`, `proposed_by_name` | the agent that proposed it, when one did |
| `content_hash` | sha-256 of the file as last read or written: how the sync knows the record moved under an app change |
| `pending` | `save` \| `remove` \| null: an app change not yet in the record |
| `updated_at` | |

- **Row-level security:** members read their organisation's rows, except those pending removal; nobody writes the table directly.
- **Writes** go through two `security definer` functions that check the caller is an owner of the row's organisation (decision 6):
  - `save_external_party(target_org, party, new_kind, new_name, new_role, new_departments, new_email, new_phone, new_website, proposed_by)`: creates (`party` null) or changes one; validates every field as the file does; sets `pending = 'save'`; on create, `added_by` is the caller, and `proposed_by` (an agent of the same organisation, or null) fills the agent columns. Returns the row's id.
  - `remove_external_party(party)`: a row never written to the record (`path` null) is deleted; any other gets `pending = 'remove'` until the engine deletes its file.
- **pgTAP** (`supabase/tests/database/external_parties.test.sql`): another organisation's member neither sees nor changes a row; a member sees but can't save or remove; an owner can; bad input is refused; a row pending removal is not listed.

### The sync, both ways

In `syncOrg`, after the decisions and the instructions, the plan worked out in `packages/shared/src/record/externos.ts` (pure, tested) and applied by `apps/engine/src/recordSync.ts`:

- **Record → database.** Each readable `externos/*.md` is upserted by `(org_id, path)` with its `content_hash`; a row whose file is gone, and that has no app change pending, is deleted.
- **Database → record**, one commit per tick for all of the organisation's pending rows, on top of the head it read («externos: cambios desde Ghostaff (…)»):
  - `pending = 'save'`: written on top of the file at head (body kept), or created at a free `externos/<slug>.md`.
  - `pending = 'remove'`: the file deleted.
  - **The record wins**: when the file at head no longer has the row's `content_hash` (someone changed it in the record meanwhile), the app's change is dropped, the row takes the file, and the summary says so, as a conflicting decision answer does.
  - A commit refused because the record moved waits for the next tick, as today.
- `RecordRepo.commit` learns to delete a file (`content: null`): GitHub's tree entry with `sha: null`, Forgejo's `delete` operation.
- An organisation whose record this engine can't reach keeps its rows pending: the app works the same, and they reach the record when it does.

### Agents

- **No agent writes `externos/` itself.** The record store's hook refuses it for every agent (recordHook.ts: «los externos los añade o confirma una persona desde Ghostaff»), so the only way in is an owner's OK. That is decision 1's «never extracted behind anyone's back», enforced by the store, not by a prompt.
- **Three settings tools, for every chat agent**, defined in `settings.ts` beside the others and calling the same service functions as the screens (rule 6):
  - `settings_read_external_parties` (reads): the list, optionally one department's.
  - `settings_save_external_party` (writes): add one or change one. Its card says what will be saved («Añadir a Ana López (persona): hace las ilustraciones…», or «Ahora / Después» for a change) and who proposes it; an owner approves it, and it runs as that owner with `proposed_by` set to the agent.
  - `settings_remove_external_party` (writes): the same, for removing one («ya no trabajamos con…»).
  
  `apps/engine/src/settings.ts` gives non-main agents these three beside their routines' (`EVERY_AGENT_TOOL_NAMES`). The tool descriptions tell the model when to use them: before suggesting who should do a piece of work, and when a mail or an invoice names someone the organisation works with who isn't on the list.
- **In a routine's turn** (nobody asked) chat agents get no settings tools today, so an agent reading the morning's invoices on a timetable can't propose one yet. Closing that needs `chat.ts` to give these three tools to a turn with no person, reading with the engine's store scoped to the organisation (every member may read the list, so it shows nothing a person in the organisation couldn't see). It is the last pull request, coordinated with the agent-context work in `chat.ts`.
- **Runner agents** (`ghostaff`) read `externos/` from their clone; the record's `AGENTS.md` (recordSeed) says what the folder is and that a person adds to it. They don't propose one: they have no settings tools, and that waits for them to get engine tools.

### The screens

- **Empresa**: a row «Con quién trabajáis» right under the Personas section, subtitle «Personas, empresas y servicios de fuera», with the count as its value. In a personal space (Perfil) too: it is the same page.
- **`/empresa/externos`**: the list, by name, each row its kind's icon, the name and what it does. An owner has «Añadir» at the end. Empty: «Aquí aparecerán las personas, empresas y servicios con los que trabajáis, y qué hace cada uno. Los agentes te propondrán los que vean en correos y facturas.»
- **`/empresa/externos/[id]`** (`nuevo` for a new one): the kind (three choices), name, «Qué hace para vosotros», departments (chips), email, phone, website; «Guardar» the main action, «Quitar» quiet and below, with a confirmation. A member sees the same fields read only. Who added it and when, and the agent that proposed it, in a quiet line at the end.
- A Maestro flow (`.maestro/flows/ci/external-parties.yaml`): an owner adds one, sees it in the list, opens and changes it.

## File Structure

| File | Pull request | What |
|---|---|---|
| `supabase/migrations/20261126800000_external_parties.sql` | 1 | Table, row-level security, `save_external_party`, `remove_external_party` |
| `supabase/tests/database/external_parties.test.sql` | 1 | pgTAP |
| `packages/shared/src/models/index.ts` | 1 | `ExternalParty`, `EXTERNAL_KINDS`, and `DEPARTMENT_NAMES` moved here from the app so a card can name departments |
| `packages/shared/src/services/externalParties.ts` (exported from `services/index.ts`) | 1 | `listExternalParties`, `getExternalParty`, `saveExternalParty`, `removeExternalParty`, `invalidExternalParty` (Spanish messages, shared by the screen and the tools) |
| `packages/shared/src/services/settings.ts` | 1 | The three tools, `EVERY_AGENT_TOOL_NAMES`, both functions classified `agent` |
| `apps/engine/src/settings.ts` | 1 | Non-main agents get `EVERY_AGENT_TOOL_NAMES` |
| `apps/engine/test/settings.test.ts`, `apps/engine/test/chat.test.ts` | 1 | The tools' cards and calls, through the shared service; every chat agent gets them |
| `packages/shared/src/record/externos.ts` (+ `record/index.ts`) | 2 | Read and write the file; `planExternalSync` |
| `packages/shared/test/externos.test.ts` | 2 | Format round trip, body kept, slugs, the plan's cases |
| `apps/engine/src/recordSync.ts`, `apps/engine/src/forgejo.ts` | 2 | The sync both ways; deleting a file on both hosts |
| `apps/engine/src/*Store*` (the sync's store) | 2 | `externalParties`, `applyExternal`, `markExternalWritten` |
| `apps/engine/src/recordHook.ts`, `apps/engine/src/recordProvision.ts` | 2 | Agents can't push `externos/`; the seed's `AGENTS.md` names the folder |
| `apps/engine/test/recordSync.test.ts`, `recordHook.test.ts` | 2 | |
| `docs/architecture.md` | 2 | `externos/` in what the record holds |
| `apps/mobile/app/(app)/(tabs)/empresa/index.tsx` | 3 | The row |
| `apps/mobile/app/(app)/(tabs)/empresa/externos/{index,[id]}.tsx`, `apps/mobile/lib/hooks/useExternalParties.ts` | 3 | The list and the form |
| `.maestro/flows/ci/external-parties.yaml` | 3 | The flow |
| `apps/engine/src/chat.ts` | 4 | The three tools in a turn nobody asked for |

## Tasks

- [x] **Pull request 1 — the data and the agents' tools.** Migration and pgTAP; the model and service; the three tools in `settings.ts`, classified, given to every chat agent; tests. Lands alone: an agent can propose and an owner approve, the rows wait for the sync.
- [ ] **Pull request 2 — the record.** `externos.ts` with its tests; the sync both ways in `syncOrg`; deleting files in `RecordRepo`; the hook and the seed; architecture.md.
- [ ] **Pull request 3 — the screens.** The Empresa row, the list, the form, the Maestro flow; reviewed against the UI rules and Vercel's guidelines on the web.
- [ ] **Pull request 4 — routines.** The three tools in a routine's turn (`chat.ts`), after agreeing the change with the agent-context session.
- [ ] Checked on beta: an owner adds one and it appears in the record's `externos/`; an agent proposes one in a chat, the card is in the deck, approving it adds it.

## Out of scope

- Moving Órdago's `suppliers/` and `partners.md` into `externos/` (their files have no front matter yet). Its own card, when Órdago's record moves.
- Contacting a party from Ghostaff (sending them a guide is [guided-access.md](guided-access.md)'s «Que lo haga otra persona»).
- Runner agents proposing parties.
