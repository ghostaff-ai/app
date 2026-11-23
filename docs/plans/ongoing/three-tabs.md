# Three tabs: Equipo, Decisiones, Empresa

**Priority:** high — the shape of the whole app
**Gate:** none
**Next:** step 2, the decision deck (decision 7): first 2–3 drawn versions of the card for Álvaro to pick, then build it on today's decisions with «Más tarde»

Álvaro asked (2026-11-23) to reorganise the app: no Hoy; **Equipo** as one row per agent that opens a single long chat with it, as in WhatsApp; **Decisiones** in the middle as one card at a time, Tinder style, to answer or leave for later; and decisions properly modelled. He then changed the third tab from Conexiones to **Empresa**, the organisation's own page with Conexiones one tap away. He took all my picks («go», 2026-11-23).

It reverses, on his word, app-design.md decisions 1 (Hoy · Equipo · Registro and the mic), 7 (no swipe) and 11 («Hecho sin ti» on Hoy), and team-chat.md decisions 2 (titled shared threads) and 10 (threads inside Equipo with a «Conversaciones» filter).

## Decisions (Álvaro, 2026-11-23, all my picks)

1. **Registro** stops being a tab and becomes a row in Empresa: the company's memory, beside its details.
2. **Hoy goes.** The organisation switcher moves to Empresa (its name on top); Secretaría is pinned first in Equipo; «tu equipo aún no puede trabajar» sits on top of Equipo. The greeting, «Hecho sin ti» and the mic go: what an agent did alone is in its chat («Avisos»), and every chat is one tap away.
3. **One chat per person with each agent**, private like a WhatsApp one-to-one: only that person and the agent see it. The agent's «Avisos» (what it did on its own) stays shared and shows inside every chat with it. The conversation is long to the person and bounded for the model: the engine reads the last 40 messages today; a running summary in the background comes when chats get long enough to need it. The shared titled threads of before stay readable on the agent's page, «Conversaciones anteriores»; nothing is migrated.
4. **Equipo is a flat list** ordered by the latest word, as in WhatsApp: ghost, name, last line, time, an orange dot while unread. No department headers.
5. **«Añadir agente»**, the last row of Equipo for owners, opens the jobs nobody does yet by department and «Agente a medida». The swipe-to-hire deck (swipe-to-hire.md) can live there later.
6. **The agent's name on top of its chat** opens its page: ghost, job, «Quién puede», «Herramientas», «Quitar del equipo», and the old conversations.
7. **The decision card** (step 2): the agent's ghost and name, the question, «Con el sí / Con el no» and its pick; three visible buttons, the recommended action, «No» and «Más tarde». Swipe right takes the recommendation, swipe left is «later», never «no» (swipe reads as destructive: decision-deck.md's research). Every answer can be undone; high-stakes cards can't be swiped. «Preguntar» opens the agent's chat with the decision quoted. Before building, 2–3 drawn versions for Álvaro to pick.
8. **The decision model** (step 3, with its own written plan first): each decision linked to the agent that asked (`agents.id`, not only `propone`'s text); 2–3 options with one marked as the pick, instead of only OK/No (a `por-decidir` format change, started in Órdago's README: AGENTS.md rule 4); a stakes level; a personal «Más tarde» that brings the card back the next morning; an agent raising a decision from its chat, the card showing both there and in the deck (team-chat.md, step 4).
9. **Three pull requests**, each landed when green: the tabs, Equipo as chats and Empresa (1–6, 10, 11); the deck (7); the model (8).
10. The third tab is called **Empresa**: short in the bar, and the app already says «Crear otra empresa».
11. **Empresa** holds, top to bottom: the name (a tap opens the switcher) and «Firmas como…»; **Conexiones** first, with how many are connected; **Personas** and «Invitar a alguien»; **Registro**; then «Cambiar de organización» (or «Otra empresa» to create or join one) and «Cerrar sesión». The organisation sheet stays only as the switcher, with creating and joining; inviting and signing out moved here.

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

**Step 2, the deck** — not started.

**Step 3, the decision model** — not started.
