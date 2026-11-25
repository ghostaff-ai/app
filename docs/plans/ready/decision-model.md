# The decision model: options, stakes, the agent that asks, and decisions from the chat

**Priority:** high — step 3 of [three-tabs.md](../ongoing/three-tabs.md) (decision 8); the deck is only as good as what a decision can say
**Gate:** none — Álvaro took every pick (2026-11-25)
**Next:** pull request 3: the action cards as decisions (decision 6); and a chat agent acting on its own once its decision is answered (below)

Álvaro asked (2026-11-23) for decisions to be «really modelled in our system». As of `d80952f` (2026-11-24) a decision is a row copied from a `por-decidir/*.yaml` file in an organisation's record on GitHub, answered only OK or No, with the asking agent as free text (`proposed_by`). Three consequences:

- **An organisation without a record can never get a decision.** Only Órdago has a record connected; every new company, and every personal space, has an empty deck forever.
- **A decision can't offer a choice.** «¿Cuándo publico?» has to be squeezed into yes/no.
- **There are two kinds of OK.** Decisions (the deck), and the action cards an agent puts in its chat when a connected account is about to do something (`agent_actions`: «Publicar este reel», Aprobar / Rechazar). team-chat.md decision 5 already said an OK asked in a chat *is* the decision card.

## Progress

- **2026-11-25, decision 1 overtaken.** While this plan waited, [record-store.md](../ongoing/record-store.md) landed: every organisation gets a record in our own store when it is created (beta now; production with the first release). So decisions stay files in the record, as today (option b, without building it here), and «in the database» is not needed. Decision 5's tool commits the file to the organisation's record, whatever its host.
- **2026-11-25, the format.** Órdago's `por-decidir/README.md` has `opciones`, `recomienda` as the pick's id, `importancia: alta` and `respuesta.opcion` (ordago-app/business `3a0b7a9`).
- **Pull request 1** (decisions 2–4): the reader and writer (`porDecidir.ts`), the sync (options, stakes, the agent matched from `propone`, the option written back), the columns and `answer_decision(…, option_id)` (`20261126100000_decision_options.sql`, pgTAP `decision_options`), and the deck and the decision screen: each option a button, the pick the main one; a high-stakes card takes no swipe, shows «No / Sí» and reveals the pick only when you choose otherwise. An app from before this still answers: its OK takes the pick.
- **Pull request 2** (decisions 5, 7): a chat agent has `pedir_decision` (`apps/engine/src/decisionAsks.ts`): the engine writes the file into the organisation's record (`openDecision` in `recordSync.ts`), syncs it and points the row at the agent; the message carries a `decision` part, drawn as a card answered in place (`DecisionInChat.tsx`). The agent reads in its turns what became of its decisions. «Preguntar a …» on the decision screen opens the agent's chat with the decision above the box; the message carries it (`ask_about_decision`, a `decision_quote` part), and the deck says «Preguntaste». A runner agent still asks by writing the file itself, as its prompt says.
- **Open:** a chat agent learns an answer the next time someone writes to it; nothing wakes it when the decision is answered. That waits for the notifications work ([decision-notifications.md](../ideas/decision-notifications.md)) or a small trigger of its own.

## Decisions (Álvaro took all my picks, 2026-11-25)

1. **Where a decision lives when the organisation has no record.**
   a) In the database, written by the engine when an agent asks; an organisation with a record still gets its file, and the record wins there, as today. **← pick:** it unblocks every organisation now; a record for everyone is its own project.
   b) Give every organisation a record first (a git repo we host), and keep decisions file-only.
2. **Options instead of OK/No.** A decision carries 2 or 3 options, each a short verb phrase and what happens with it («Con esto…»), one marked as the agent's pick. Yes/no is two options. In por-decidir: `opciones: [{id, texto, con}]` and `recomienda: <id>`; files with only `recomienda`/`con_si`/`con_no` keep working as two options. The answer becomes the option's id, and «took the pick» is what counts towards earned autonomy. **← pick**
3. **Stakes.** An optional `importancia: alta`. A high-stakes card can't be swiped, and hides the agent's pick until you choose, then lets you keep yours or switch (the decision deck's research: «your pick first» cuts rubber-stamping, used only where it matters). **← pick.** The alternative: no swipe, pick shown.
4. **The agent that asks.** `decisions.agent_id`, the agent row: set by the engine when an agent asks from Ghostaff; matched from `propone` by the sync for a record's files (by name, then by ghost). The card shows that agent's ghost and name, and «Preguntar» opens *its* chat. **← pick**
5. **How an agent asks.** An engine tool, `pedir_decision` (question, options, pick, one quoted line, sources, due date, stakes), for chat agents and the runner. The card shows in the agent's chat, in the message where it asked, and in the deck; answering in either answers both. With a record, the engine also commits the file. **← pick**
6. **The action cards become decisions.** An `agent_actions` approval is a decision whose options are «Aprobar» and «No» and whose answer runs (or drops) the stored action. One card, one place to look: the deck and the chat. **← pick**, as the last of the three pull requests.
7. **«Preguntar»** opens the asking agent's chat with the card quoted above the box; your message carries the decision, so the agent answers in its context. A card you asked about shows «Preguntaste» in the deck. **← pick**
8. **Order of work:** three pull requests, each landed when green.
   1. The model and the format (1–4): Órdago's README first, then the sync, the database, the deck showing options and stakes.
   2. Agents asking (5, 7): the tool, the card in the chat, «Preguntar».
   3. Action cards as decisions (6).
   **← pick**

## What stays

- Órdago's panel keeps working with every file: the new fields are optional, and an answer to an option is also written as `decision: ok` when it is the pick and `no` otherwise, plus `opcion: <id>`, so its history CSV stays the same shape.
- A rule (`tipo: regla`) is still signed in its own words, on its own screen.
- «Más tarde» (step 2) is unchanged.
