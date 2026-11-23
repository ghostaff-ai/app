# An agent asks for the account it lacks, in the chat

**Priority:** high — Jaime (Trello, 2026-11-23): «que si el agente detecta que quiere usar una herramienta pida el acceso y el conector»
**Gate:** decision:Jaime's OK on the open questions below (recheck 2026-11-24)
**Next:** Jaime answers the open questions; then promote to ongoing with the task breakdown and build on `claude/connector-request-ac0b3c`

## Goal

In the middle of a conversation, when an agent needs an account the organisation hasn't given it (Google Calendar, Notion, Holded…), it says so with a card in its message, «Necesito acceso a Notion» and a «Conectar» button; once it is connected, the agent goes on with what it was asked, without the person repeating it.

Jaime picked the shape (2026-11-23): **a card in the chat**, not a decision in Hoy and not a link to Conexiones in the text.

## Context

- Today an agent with no account says «Todavía no tienes acceso…» (`reachLines` in `apps/engine/src/chat.ts`) and the person has to know to go to Empresa → Conexiones, find the card, connect, come back and ask again. Four screens for a non-technical person who only wanted their calendar read.
- What exists and is reused:
  - The catalogue, `CONNECTORS` in `packages/shared/src/connectors.ts`: 60-odd connectors with `id`, `name`, `reach`, `before`.
  - Connecting: `startAccountConnect` / `finishAccountConnect` (`apps/engine/src/accounts.ts`), with the flow in `conexiones/[id].tsx`. `returnTo` may be any path of the app's scheme (`allowedReturn`), so a chat can be the return address.
  - Cards in an agent's message: the approval card (`ActionPart`, `agent_actions`, `apps/engine/src/actions.ts`, `ActionCard` in `components/chat/Message.tsx`). A gated tool call in `writeReply` becomes a part; the same trick serves here.
  - Each agent's reach: `agents.accounts` (`restrictTo` in `tools.ts`), changed by an owner on the agent's tools page (`herramientas/[id]`) or by the main agent's `settings_agent_accounts`, which never touches its own reach.
  - Asking for an app we don't have: `request_connector` (`connector_requests`, 2026-11-20), counted per organisation and name.
- Since 2026-11-23 each person has their own private chat with each agent ([three-tabs.md](../ongoing/three-tabs.md), decision 3): an owner does not see a member's chat.

## Design

### How the agent knows it lacks something

A new tool, **`ask_for_account`**, given to every agent that answers with the model (an API key or the subscription through `toolServer.ts`; job agents are out of scope). Not named `request_connector` to keep it apart from the database function that counts requests for apps we don't have.

- Input: `{ connector: string, why: string }`. `connector` is a catalogue id, or the app's plain name when it is not in the catalogue. `why`: one line, in Spanish, for the card («Para ver tus citas de esta semana»).
- Its description carries the catalogue compactly (`id: Name`, one per line, ~60 lines), so the model picks the id itself. That costs tokens on every reply that has the tool; the alternative, a second tool to search the catalogue, costs a round trip instead. The list is cheaper and the model sees what exists.
- The system prompt replaces «Todavía no tienes acceso… dilo claramente» with: if what they ask needs an account you don't have, use `ask_for_account` instead of saying you can't; then end your message saying what you will do once it is connected.
- It never runs anything outside Ghostaff. In `writeReply` it is intercepted like a writing tool: it becomes a part of the message, and the model reads back «Tarjeta mostrada: quien puede conectar verá el botón. Termina el mensaje; no sigas hasta que esté conectada».

What the engine answers depends on the account's state for this organisation and agent:

| The account | The card | The model reads |
|---|---|---|
| In the catalogue, not connected | «Necesito acceso a Notion» · why · «Conectar Notion» | card shown |
| Connected but failing | «Notion ya no me da acceso» · «Volver a conectar» | card shown |
| Connected, working, but not given to this agent (`agents.accounts`) | «Notion está conectada, pero no la tengo» · «Darme acceso» (open question 2) | card shown |
| Connected and given to it | no card | an error: you already have it, use its tools |
| Not in the catalogue (Gmail reading, an app we lack) | «Todavía no podemos conectar Gmail» · «Pedirlo» (counts it with `request_connector`) | card shown; say we can't yet |

At most three cards per message, one per connector.

### The card

A new message part beside `ActionPart`, in `packages/shared/src/chat.ts`:

```ts
interface AccountAskPart {
  type: 'account_ask';
  askId: string;
  /** Catalogue id; absent when the app isn't in the catalogue. */
  connector?: AccountProvider;
  /** The app's name as the person reads it. */
  name: string;
  why: string;
  need: 'connect' | 'reconnect' | 'grant' | 'unsupported';
  status: 'open' | 'done' | 'requested';
  /** Who connected it (or asked for it), once it is. */
  doneBy?: string;
}
```

Drawn in `Message.tsx` as `AccountAskCard`, the same box as `ActionCard` (one main action, quiet text):

- The connector's logo (`ConnectorLogo`), «Necesito acceso a Notion», the `why` line, and the connector's `before` if it has one.
- **Owner:** the button. It runs the same connect as Conexiones, with the chat as `returnTo`; the flow in `conexiones/[id].tsx` moves into a hook, `useAccountConnect(orgId, provider, returnTo)`, used by both screens so there is one connect in the app.
- **Member:** no button; «Lo conecta quien es propietario: Ana, Jaime.» (open question 1).
- **Once done:** «Conectada por Ana» in muted text, and the agent's new message follows below it.

### Picking up the task

The engine, not the app, makes the agent go on, and only once:

1. A new table **`account_asks`** (`id`, `org_id`, `thread_id`, `message_id`, `agent_id`, `connector`, `name`, `need`, `status` open → done, `requested_by`, `done_by`, timestamps). Row-level security on with no policy (the engine writes it with the service role, the app reads the card in the message), and a pgTAP test that no member reads or writes it, as rule 2 asks.
2. **`POST /threads/:id/resume`** with `{ askId }`. The engine checks the caller may talk to the thread's agent, that the ask is this thread's and still open, and that the account is now connected, working and given to the agent; then claims it (open → done, a conditional update, so two presses resume once), updates the card, and writes a new reply.
3. That reply reads the conversation as today (`toTurns`), plus a closing turn in the person's voice: «He conectado Notion. Sigue con lo que te pedí.» The card is not text, so `toTurns` adds one line for it inside the agent's message («(Pedí acceso a Notion.)»), and the model sees where it stopped.
4. **Who calls it:** the chat screen, whenever its latest agent message has an open card whose account the app now sees as connected (`useConnections`). So it resumes right after the owner connects from the card, and also when an owner connected it from Conexiones and the person opens the chat later. The engine's check, not the app's view, decides.

Why not resume inside `finishAccountConnect`: the engine keeps the CPU only while a request is open, so it would hold the person's connect screen until the agent finished writing, and it would have to find every open ask across the organisation's chats.

Why not post a message as the person («He conectado Notion») from the app and let the usual reply answer: it puts words in the person's mouth they did not type, and it only works when they connect from the card itself.

### The rights it keeps

- Connecting stays an owner's act in the app, through the provider's sign-in. The agent can only ask; `connect_account` stays `never` in `settings.ts`.
- An agent never gives itself an account (`settings_agent_accounts` refuses its own reach). The «grant» card is an owner pressing a button in the app, not an agent's proposal (open question 2).
- The tool's input never reaches a URL or a query: the card builds the connect from the catalogue id.

## Open questions

1. **A member asks and no owner is in the chat.** The member's chat is private, so an owner doesn't see the card. Options: (a) the card only says who can connect it; (b) also mark the connector in Conexiones, for owners, «Lo ha pedido Luis para Redes», from `account_asks`; (c) a push to the owners (notifications are [their own plan](decision-notifications.md)). My pick: **(a) now, (b) as the next step** once Jaime sees it working; (c) when notifications exist.
2. **Connected but not given to this agent.** Options: (a) an owner's «Darle acceso» on the card sets `agents.accounts` for this agent through the same service function as its tools page; (b) the card only links to the agent's tools page. My pick: **(a)**: one tap, the same function, and it is the owner who presses. It is not the agent changing its own reach; the agent only asked.
3. **«Ahora no» on the card.** Without it, an open card simply stays; the next message moves on. My pick: **no button in v1** (one main action per screen); add it if people ask.
4. **Apps we can't connect yet** («Gmail», «Holded» on an engine without it): the card's «Pedirlo» counts it with `request_connector`. My pick: **yes**: it's the demand signal connectors.md wants, already built.

## Out of scope

- Agents that run as jobs (`ordago_job`, our runner): they report at the end of a run, not in a live reply. Later, the same part.
- Writes still wait for approval as today: a card to connect does not approve anything.
- Showing the asks to owners outside the chat (open question 1b).
