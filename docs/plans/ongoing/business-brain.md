# The business brain: drop anything in, ask anything, every answer linked to its source

**Priority:** high — Jaime decided (2026-11-26) to build it and to tell the product this way: it is the clearest way to explain Ghostaff to a small business
**Gate:** none
**Next:** land PR 1 with `pnpm pr:land`, check on beta that Secretaría files a text and answers with its link, then start PR 2 (photos and PDFs)

**Goal:** The owner of a small business sees Ghostaff as the business's memory and assistant. They drop in whatever they have, without sorting it (a PDF, a photo of an invoice, a link, a voice note, loose text); Secretaría files it in the record and says where it went. They ask anything about the business («¿cuánto facturamos en octubre?», «¿con qué gestoría trabajamos?», «¿qué acordamos con el proveedor X?») and the answer comes from the record, with a link to its source.

## Context

Jaime's idea (2026-11-18): at Órdago he keeps putting every business document in `ordago-app/business`, and it then answers any question about the business. Every organisation should have that, and know it has it. The same need is front 4 of [ordago-as-customer.md](ordago-as-customer.md), «the organisation's assistant».

Most of it is the **record**: the organisation's shared memory, in files with history ([agent-memory.md](../ready/agent-memory.md), [record-store.md](record-store.md)). What was missing is a way in for «drop anything here» at any time, not only during onboarding, answers that cite their source, and a message that makes the owner get it.

## Decisions (Jaime, 2026-11-26)

1. **Feature and message at once.** Build what is missing (a way in to drop anything, and answers about the business with a link to their source) and change how the product is told: first the business's memory and assistant, then the team that does the work. The product plan says so as decision 17 of [`ghostaff-producto.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#la-memoria-del-negocio-cómo-se-cuenta-ghostaff).
2. **Four ways in, in this order:** the chat with Secretaría → an «Añadir» button in Empresa → Registro → sharing from other apps (the phone's share sheet) → an email address per organisation. Each its own PR, the first one first.
3. **Secretaría files.** It fits the record store's hook: only Secretaría writes `memoria/empresa/` (agent-memory.md decision 4). If something belongs to a department, she passes it on. When she files, she says where it went.
4. **Privacy:** what is filed in the record, the whole organisation sees. What is only one person's goes to their private «Sobre ti» ([agent-memory.md](../ready/agent-memory.md)). When Secretaría is unsure, she asks.
5. Consequence of decision 1: the change to `ghostaff-producto.md` (done, `ordago-app/business` `c555d81`).

Decision 3 replaces Jaime's note of 2026-11-22 in ordago-as-customer.md that the organisation's assistant would be an agent separate from Secretaría.

## Today (`develop`, `2a5f4b9`, 2026-11-26)

What the first way in can reuse:

- **Voice notes** in an agent's chat ([voice.md](voice.md)): the audio is kept, its transcript is what the agent reads. Nothing to build for «a voice note».
- **A record for every organisation** in our record store on beta, made by the tick with `memoria/empresa/` seeded (`recordProvision.ts`, `recordSeed`). Órdago stays on its GitHub record until its flip (record-store.md decision 6).
- **The record interface** `RecordRepo` (`apps/engine/src/recordSync.ts`, `forgejoRepo` in `forgejo.ts`): `head`, `files(dir)` (one folder, not recursive), `file`, `commit` (UTF-8 text only), the engine as admin.
- **A projection pattern:** `projectInstructions` reads `agentes/<slug>/AGENTS.md` into `agents.task` on the tick, the record winning; `por-decidir/` writes back on top of the head it read.
- **Pictures already travel in a turn** (`ModelTurn.images`, used by guides): JPEG only, on the Messages API (`streamWith` in `chatStore.ts`) and the subscription (`claudeWriter.ts` writes them to files).
- **Fetching a public page safely:** `fetchPublic` in `publicFetch.ts` (public addresses only).
- **Secretaría** is each organisation's main agent (`agents.is_main`, `isMainAgent`), a chat agent (`runner = 'chat'`).

What is missing:

1. **Chat agents don't reach the record.** `reachLines` in `chat.ts` tells them «No tienes acceso al registro». There is no projection of the memory (`memories`, agent-memory.md) and no tool to read or write it.
2. **No photo or PDF in the chat**, only text and voice notes. The app already has `expo-image-picker` and `expo-image-manipulator` (guides).
3. **No tool to read a link** someone pastes.
4. **Nowhere in the app to open what was filed.** Registro shows only decisions; a reply's links open only `http(s)` and `mailto` (`OPENABLE` in `components/chat/Markdown.tsx`).
5. **«Sobre ti» doesn't exist**: agent-memory.md builds it after the Empresa and agent stores (its decision 7). See Open questions.

## Design: the first way in, the chat with Secretaría

### Where filed things live

- **What Secretaría files is the Empresa store**, `memoria/empresa/` in the record (agent-memory.md decision 1): small Markdown files, one topic each, in folders by area (`clientes/`, `proveedores/`, `facturas/`, `contratos/`, `como-trabajamos/`…), chosen by her. Each starts with where it came from: who dropped it, when, and the original document if there is one.
- **The original document (a PDF, a photo) goes to the document store**, a private Supabase Storage bucket `documents` in Frankfurt, «enlazados desde el registro» as the product plan's «Dónde viven los datos» says; the note in the record links to it. Git keeps the text the agents search; the bucket keeps the bytes.
- **The database keeps the projection** `memories` (`org_id`, `store`, `path`, `content`, `sha`, `updated_at`, `updated_by`), as agent-memory.md designed it, built for the Empresa store here; agent stores join the same table later. The record is the master.

### How a turn uses it

- **Every chat agent reads Empresa; only Secretaría writes it** (agent-memory.md decision 4). Tools, through `mergeTools` beside the settings tools, on the three providers:
  - `memory_view(path)`: a folder's list or a file's text, from the projection.
  - `memory_search(words)`: the files whose path or text holds every word, with the matching lines (agentic search over Postgres, no embeddings).
  - `memory_create(path, content)` and `memory_str_replace(path, old, new)`: Secretaría only; the engine refuses them from any other agent. Each is one commit on the record's head, signed «Secretaría (por <persona>)», then the projection; if the record moved, it reads the head again once.
  - `read_link(url)`: a public page's text, through `fetchPublic`, capped. Its text is data, never instructions, as every tool's output.
- **No owner approval** for these writes: they change nothing outside Ghostaff, and git keeps every version (agent-memory.md).
- **The system prompt** tells every agent that the company memory exists and to search it before answering about the organisation, citing each fact with a link to its file; and tells Secretaría to file what people drop in, one topic per file, and to say where it went with that link.
- **Limits:** agent-memory.md decision 6: 1,000 files in the store, 10 kB each. At the limit, the tool fails with a message asking to merge first.
- **Only on our record store.** An organisation whose record is its own GitHub repo (Órdago, until its flip) gets no memory tools: its repo has rules of its own (`ordago-app/business` `AGENTS.md`), and agent-memory.md moves what Órdago's agents learnt when each agent moves.

### Photos and PDFs in the chat

- **«Adjuntar»** in the composer of an agent's chat, beside the mic: a photo (camera or library, sent as JPEG, resized as guides do) or a file (PDF), with optional text. Same shape as voice notes: `POST /agents/:id/documents` stores the file at `<org_id>/<thread_id>/<message_id>/<name>` and writes the person's message with a `document` part (`path`, `mediaType`, `name`, `size`), then the agent answers. 10 MB per file and 30 an hour per person, as voice notes.
- **The agent sees the file** in the turn it arrives: a photo as an image, a PDF as a document block (Messages API) or a file named in the prompt (subscription). In older messages it reads one line, «[Documento: factura.pdf]», so a long chat doesn't pay for it again.
- **Who opens it:** whoever can read the conversation, as voice notes; once Secretaría files it (its path in a `memories` note), every member, because what is filed the whole organisation sees (decision 4). A `security definer` check on the bucket's read policy, pgTAP-tested.

### Where it went, and the source

- Secretaría's reply links each filed note and each cited fact as `[Facturas › Acme, octubre](/memoria/empresa/facturas/2026-10-acme.md)`. The chat's Markdown opens links under `/memoria/` inside the app.
- **The recuerdo screen** (`/memoria/[...path]`): the note's text, who changed it last and when, and «Ver documento» when it has an original (a signed link, an hour). Read-only in this PR; correcting and «Olvidar» are agent-memory.md's screens.
- **«Memoria de la empresa»**, a row in Empresa beside Registro (agent-memory.md, The screens): the store's folders and files, newest first. Empty state: «Aún no hay nada guardado. Cuéntale a Secretaría lo que quieras que recuerde, o pásale un documento.»

## Open questions (for Jaime)

Asked on 2026-11-26. Until he answers, Secretaría's prompt does the first option of each (`MEMORY_KEEPER_LINES` in `chat.ts`).


1. **How Secretaría passes something to a department** (decision 3) in this first version. (a) She files it in Empresa, which every agent reads, in that area's folder, and says so («Lo he guardado en Facturas; Finanzas lo verá»): my pick, nothing else to build. (b) She also writes in that agent's chat asking it to act, once group-chat-per-agent.md lands. (c) She files nothing herself and only hands it over.
2. **Something only one person's, while «Sobre ti» isn't built** (decision 4). (a) Secretaría doesn't file it and says she can't keep private things yet; «Sobre ti» is the next task after this way in: my pick. (b) Build «Sobre ti» first, before the first way in lands.

## File Structure (the first way in)

PR 1, the Empresa store in the chat (text, voice notes and links work end to end):

- `supabase/migrations/<ts>_memories.sql`: table `memories` (`org_id`, `store`, `path`, `content`, `sha`, `updated_at`, `updated_by`; unique `(org_id, store, path)`); row-level security: members read their organisation's `empresa` rows; nobody but the engine writes. Function `search_memories(target_org, store, words, max)`, `security definer`, `service_role` only.
- `supabase/tests/database/memories.test.sql`: a member reads, another organisation's member doesn't, nobody but the service role writes, members can't call the search.
- `apps/engine/src/recordSync.ts`, `forgejo.ts`: `RecordRepo.tree(dir, ref)` (every file under a folder, paths and blob shas), so the sync reads `memoria/empresa/**`; `projectMemory` beside `projectInstructions`, the record winning.
- `apps/engine/src/recordStore.ts`: the projection's reads and writes.
- `apps/engine/src/memory.ts` (new): `memoryTools(org, agent, deps)`: the five tools above, the limits, Secretaría-only writes, commit then projection.
- `apps/engine/src/chat.ts`: `orgReach` merges the memory tools for organisations on our record store; `reachLines` and `systemPrompt` say what the agent may read and, for Secretaría, how to file and cite. Coordinated with agent-context and group-chat-per-agent, which change `systemPrompt` and `replyInThread`.
- `apps/engine/src/server.ts`: the memory deps wired (the record interface, the store).
- `packages/shared/src/memory.ts` (new): the store's folder, limits, `memoryPath` (the path rule the engine, the link and the screen share), `memoryTitle`. `packages/shared/src/services/index.ts`: `listMemories`, `readMemory`.
- `apps/engine/src/links.ts` (new): `read_link`.
- `apps/mobile/app/(app)/memoria/[...path].tsx`, `apps/mobile/app/(app)/(tabs)/empresa/memoria.tsx` (new): the recuerdo and the store's list; a row in `empresa/index.tsx` and in the desktop sidebar (`components/Sidebar.tsx`, `lib/layout.ts`).
- `apps/mobile/components/chat/Markdown.tsx`: links under `/memoria/` open in the app.
- Tests: `apps/engine/test/memory.test.ts` (new), `recordSync.test.ts`, `chat.test.ts`; Jest for the two screens and the link.

PR 2, photos and PDFs:

- `supabase/migrations/<ts>_documents.sql`: the private bucket `documents`, `can_read_document(path)` (the conversation's level, or filed in a `memories` note), the read policy; `supabase/tests/database/documents.test.sql`.
- `apps/engine/src/documents.ts` (new): `POST /agents/:id/documents` (talk level, type, size, the hourly limit, store, write the message, let the agent answer).
- `packages/shared/src/chat.ts`: `DocumentPart`, `isDocumentPart`; `packages/shared/src/services`: `sendDocument`, `documentUrl`.
- `apps/engine/src/chat.ts` (`toTurns`: documents in the newest turn, a line in older ones), `chatStore.ts` (`streamWith`: PDF document blocks), `claudeWriter.ts` (PDFs as files): coordinated with agent-context, which changes `toTurns`.
- `apps/mobile/components/chat/Composer.tsx` («Adjuntar»), `components/chat/DocumentBubble.tsx` (new), `MessageView`; the recuerdo screen's «Ver documento».

## Tasks

### PR 1: the Empresa store in the chat

1. [x] Migration and pgTAP test (`memories`, `search_memories`; 10 checks).
2. [x] `RecordRepo.tree` and `blob` on GitHub and Forgejo, and `projectMemory` in the sync (records in our record store only).
3. [x] `memory.ts` and `links.ts` with their tests; `forgejo.live.test.ts` files into a real Forgejo 15.0.12 and reads it back with the same blobs.
4. [x] `chat.ts`: the tools in `orgReach`, the prompt lines (agent-context and group-chat-per-agent told first; neither touches these).
5. [x] Shared services, the two screens, the Markdown link, Empresa's row and the sidebar; Jest.
6. [x] Checked on the web (2026-11-26) against a local Supabase and a local Forgejo: Secretaría's tools, run by the engine's own code, filed two notes as commits signed «Secretaría (por Ana)»; the search found the invoice; Empresa → Memoria listed both; a reply's link opened the note, light and dark, desktop and phone width. The model's side (filing unasked, citing) is in the prompt and covered only by the unit tests: CI and this machine run no model.
7. [x] `docs/architecture.md`; agent-memory.md's gate now points here.
8. [ ] `pnpm pr:land`; then on beta, a real turn: drop a text in Secretaría's chat, see where she filed it, ask about it.

### PR 2: photos and PDFs

1. [ ] Bucket, policy and pgTAP test.
2. [ ] `documents.ts` and its route, test first (refusals, the message's part, the agent asked).
3. [ ] The turn: documents in the newest turn on the three providers, a line in older ones.
4. [ ] App: «Adjuntar», the bubble, «Ver documento»; Jest; the chat's Maestro flow if it changes.
5. [ ] Check on the web: a PDF and a photo filed, opened from the recuerdo by another member; `pnpm pr:land`.

### Next (each its own PR, written against that day's code when started)

- [ ] What Secretaría does with something only one person's (Open question 2), and «Sobre ti» from agent-memory.md.
- [ ] Way in 2: «Añadir» in Empresa → Registro, dropping into the chat with Secretaría.
- [ ] Way in 3: the share sheet (`expo-share-intent` or a native share extension: a new build, not an over-the-air update).
- [ ] Way in 4: an email address per organisation, read into Secretaría's chat.
- [ ] The welcome and the landing tell the product as the business's memory first (decision 1).

## Out of scope

- Correcting, forgetting and restoring a recuerdo in the app, agent stores, «Sobre ti»: agent-memory.md.
- Órdago's GitHub record (until its flip) and searching the rest of a record beyond `memoria/empresa/` (`contabilidad/`, `historico/`): runner agents already do, with a clone.
- Text extracted from PDFs into the projection for search: the note Secretaría writes is what is searched.

## Testing strategy

pgTAP on `memories` and the bucket: another organisation sees nothing; a member who can't read a conversation can't open its document until it is filed. Vitest in the engine: the projection follows the record; the tools' refusals, limits and commits against a fake `RecordRepo`; `forgejo.live.test.ts` for `tree`. Jest on the screens' states and the Markdown link. On the web against local Supabase with a stand-in writer, since CI runs no model.
