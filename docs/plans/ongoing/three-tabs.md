# Three tabs: Equipo, Decisiones, Empresa

**Priority:** high — the shape of the whole app
**Gate:** none
**Next:** try the deck on the phone (swipe was never tried on a phone: decision-deck.md); then step 3, the decision model, with its own written plan first

Álvaro asked (2026-11-23) to reorganise the app: no Hoy; **Equipo** as one row per agent that opens a single long chat with it, as in WhatsApp; **Decisiones** in the middle as one card at a time, Tinder style, to answer or leave for later; and decisions properly modelled. He then changed the third tab from Conexiones to **Empresa**, the organisation's own page with Conexiones one tap away. He took all my picks («go», 2026-11-23).

It reverses, on his word, app-design.md decisions 1 (Hoy · Equipo · Registro and the mic), 7 (no swipe) and 11 («Hecho sin ti» on Hoy), and team-chat.md decisions 2 (titled shared threads) and 10 (threads inside Equipo with a «Conversaciones» filter).

## Decisions (Álvaro, 2026-11-23, all my picks)

1. **Registro** stops being a tab and becomes a row in Empresa: the company's memory, beside its details.
2. **Hoy goes.** The organisation switcher moves to Empresa (its name on top); Secretaría is pinned first in Equipo; «tu equipo aún no puede trabajar» sits on top of Equipo. The greeting, «Hecho sin ti» and the mic go: what an agent did alone is in its chat, and every chat is one tap away.
3. **One chat per person with each agent**, private like a WhatsApp one-to-one: only that person and the agent see it. What it did on its own lands in that chat too (decision 12). The conversation is long to the person and bounded for the model: the engine reads the last 40 messages today; a running summary in the background comes when chats get long enough to need it. The shared titled threads of before stay readable on the agent's page, «Conversaciones anteriores»; nothing is migrated.
4. **Equipo is a flat list** ordered by the latest word, as in WhatsApp: ghost, name, last line, time, an orange dot while unread. No department headers.
5. **«Añadir agente»**, the last row of Equipo for owners, opens the jobs nobody does yet by department and «Agente a medida». The swipe-to-hire deck (swipe-to-hire.md) can live there later.
6. **The agent's name on top of its chat** opens its page: ghost, job, «Quién puede», «Herramientas», «Quitar del equipo», and the old conversations.
7. **The decision card** (step 2): the agent's ghost and name, the question, «Con el sí / Con el no» and its pick; three visible buttons, the recommended action, «No» and «Más tarde». Swipe right takes the recommendation, swipe left is «later», never «no» (swipe reads as destructive: decision-deck.md's research). Every answer can be undone; high-stakes cards can't be swiped. «Preguntar» opens the agent's chat with the decision quoted. Before building, 2–3 drawn versions for Álvaro to pick.
8. **The decision model** (step 3, with its own written plan first): each decision linked to the agent that asked (`agents.id`, not only `propone`'s text); 2–3 options with one marked as the pick, instead of only OK/No (a `por-decidir` format change, started in Órdago's README: AGENTS.md rule 4); a stakes level; a personal «Más tarde» that brings the card back the next morning; an agent raising a decision from its chat, the card showing both there and in the deck (team-chat.md, step 4).
9. **Three pull requests**, each landed when green: the tabs, Equipo as chats and Empresa (1–6, 10, 11); the deck (7); the model (8).
10. The third tab is called **Empresa**: short in the bar, and the app already says «Crear otra empresa». In a personal space it is **Perfil**, the same page (Álvaro, 2026-11-23; `packages/shared/src/spaces.ts`, welcome-and-spaces.md).
11. **Empresa** holds, top to bottom: the name (a tap opens the switcher) and «Firmas como…»; **Conexiones** first, with how many are connected; **Personas** and «Invitar a alguien»; **Registro**; then «Cambiar de organización» (or «Otra empresa» to create or join one) and «Cerrar sesión». The organisation sheet stays only as the switcher, with creating and joining; inviting and signing out moved here.

12. **No «Avisos»** (Jaime, 2026-11-23, Trello «Por qué hablas con avisos y no con los agentes»; it replaces the shared «Avisos» thread of decisions 2 and 3). What an agent does on its own (a scheduled run with something to say, a report, a run that failed) is a message from it in the private chat of **every person who can see the agent** (`agent_level_for` not `none` at that moment: the same people who saw «Avisos»), opening that chat if it doesn't exist. Each person has their own unread mark, and when they answer, the agent has the message in the 40 it reads. The existing «Avisos» threads are migrated, not kept: each message is copied with its date into the chat of every person who can see the agent, then the threads and `threads.notices` go. Someone who joins later doesn't get the past ones.

## Progress

**Step 1, the tabs** (branch `feat/three-tabs`, 2026-11-23):

- [x] `supabase/migrations/20261123200000_personal_chats.sql`: `threads.personal_of`, one per person and agent; someone else's chat is invisible to everyone, owners included (the thread, its messages, writing, read marks); `chat_with(agent, body)` opens it with the first message; `my_threads` says which thread is the person's chat and which the agent's «Avisos». pgTAP: `personal_chats.test.sql`.
- [x] The engine's «hello» for a new agent writes in the hiring person's chat (`personalChat` in `apps/engine/src/chatStore.ts`).
- [x] Tabs Equipo · Decisiones · Empresa, with the count of waiting decisions on Decisiones; the desktop sidebar the same.
- [x] Equipo (`(tabs)/index.tsx`), the chat (`chat/[agent].tsx`, the person's thread and «Avisos» merged live), «Añadir agente» (`anadir-agente.tsx`), the agent's page with the old conversations.
- [x] Decisiones as the list of before, without the greeting: the deck is step 2.
- [x] Empresa (`(tabs)/empresa/`), with Conexiones and Registro in its own stack.
- [x] The mic, `conversacion/nueva`, «Hecho sin ti» on Hoy and `lib/hoy.ts` removed.
- [x] Maestro flows `create-company` and `create-personal` walk the new tabs.
- Checked on the web against local Supabase (a seeded bakery: Equipo's order and unread dot, the chat with «Avisos», writing opens the chat, the agent's page, Decisiones, Empresa, Conexiones, «Añadir agente»). Not yet on a phone.

**Step 2, the deck** (branch `feat/decision-deck`, 2026-11-24). Álvaro picked version A of the [three drawn cards](https://claude.ai/artifact/68aL77Yj9kP4qfiesmGLjf): a stack, three buttons.

- [x] `supabase/migrations/20261124600000_decision_snoozes.sql`: «Más tarde» per person (`decision_snoozes`, `snooze_decision`, `unsnooze_decision`), only the person reads or changes theirs, within 30 days. pgTAP: `decision_snoozes.test.sql`.
- [x] The deck (`components/DecisionDeck.tsx`, `lib/deck.ts`, `useDeck`): the card with ghost, due date, question, quote, «Con el sí / Con el no» and the pick; «Más tarde», «No» and the named pick; swipe right takes the pick, left is tomorrow at 8:00; a rule can't be swiped (it is signed on its own screen); a tap opens the whole decision, with «Preguntar»; «Deshacer» for six seconds after each move; reduced motion skips the fly-off. Built with React Native's own PanResponder, so it ships over the air with no new native module.
- [x] Empty: «Nada que decidir», with «Verlas ahora» for what was put aside, else «Ver lo decidido».
- [x] The tab's count and the sidebar's follow every answer at once.
- Not yet: high-stakes cards (no stakes field until step 3); «Preguntar» still goes through the decision's own screen, not straight into the agent's chat with the card quoted.
- Checked on the web against local Supabase, light and dark: drag, swipe, undo, later, no, a rule opening its screen, the empty state. Not on a phone.

**Step 3, the decision model** — not started.

**No «Avisos»** (decision 12, branch `claude/remove-avisos-7bec6b`):

- [x] `supabase/migrations/20261123300000_no_notices.sql`: `post_to_personal_chats(agent, body)` (service role only) writes the agent's message in the chat of every member who may see it, opening the chats; the «Avisos» threads are copied into those chats with their dates and read marks, then deleted with `threads.notices`; `my_threads` loses `notices`. pgTAP: `no_notices.test.sql`. The move checked on a throwaway Postgres with an «Avisos» thread, a chat that existed and one that didn't.
- [x] Engine: scheduled reports and runs that fail before starting go through `postToPersonalChats`; the scheduled run's prompt no longer names «Avisos».
- [x] App: the chat is only the person's thread; Equipo's row is that chat.
