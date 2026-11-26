# The agents as a world, not a chat: a friend who tells you things

**Priority:** medium — how people take in what the agents do is the heart of the app; the world itself comes once the agents do real work
**Gate:** decision:Jaime — what the world is (open question 1) and whether it replaces Equipo's list or sits on top of it
**Next:** draw 2–3 versions of Equipo as a world (as claude.ai pages, on a phone frame) for Jaime to pick from

Jaime's idea (2026-11-26), after a reel he shared ([instagram.com/reel/DfSeN1qSWYh](https://www.instagram.com/reel/DfSeN1qSWYh/)): the agents shouldn't only be a chat but **a world**, gamified to that level, where an agent is **a friend who talks to you**, and where **the information is easier to take in**. «Que los agentes, en vez de ser un chat, sean también como un mundo… gamificarlo hacia ese nivel… que es un amigo que te está hablando… y que la información sea también un poco más consumible».

Written down loosely on purpose, as with [gamification.md](gamification.md): nothing here is decided. The reel couldn't be opened from the agent's session that wrote this, so what it shows is only what Jaime said; add a line on what it shows when someone has it at hand.

## Today (`develop`, 2026-11-26)

- **Equipo is a flat list of chats**, as in WhatsApp: ghost, name, last line, time ([three-tabs.md](../ongoing/three-tabs.md), decision 4). Tapping a row opens the chat; the agent's name on top opens its page.
- **Each agent already has a character:** the glowing 3D ghost, one per job, with its own shape, props and a signature move; expressions come from the eye shape ([gamification.md](gamification.md)). Only one live ghost is drawn at a time, to keep the phone light.
- **What an agent does on its own** is a message from it in the chat (three-tabs.md, decision 12). It is text, as long as the agent writes it.
- **People can speak to the agents** with voice notes; the agent always answers in text ([voice.md](../ongoing/voice.md)).
- **Decisions are cards**, one at a time, to swipe or tap ([decision-deck.md](../ongoing/decision-deck.md)).
- **The direction so far is «a calm desk»**: open the app for a couple of minutes, take what is yours, leave ([app-design.md](../ongoing/app-design.md)). The gamification plan said «no game layer yet» and asked how much of a game a business user wants.

## The idea, in three parts

### 1. A world, not a list

Equipo becomes a place where the ghosts live and you can see them work: an office, a small town, a room per department (open question 1). What each ghost is doing tells you its state without reading anything:

- **Working** on a run: at its desk, with its props (Finanzas with the calculator).
- **Needs you:** comes to the front, waves, holds up the card. That is the way into the decision.
- **Done something** worth telling: celebrates, or waits with news.
- **Idle**, or blocked (a tool disconnected, no access): asleep, or looking at a broken prop.

Tap a ghost to talk to it: its chat, as today. The world is a way in to what already exists, not a second app.

### 2. A friend who talks to you

The agent comes to you, speaks first, and sounds like someone you know, not a report:

- **Short, spoken-style messages** with its own personality per job, instead of long blocks of text. «Ya he cuadrado octubre. Faltan dos facturas de Iberdrola, ¿te las pido?».
- **It can talk out loud**: the ghost says the update with a voice of its own (voice.md today only goes one way, person to agent).
- **It remembers you**: it picks up where you left off, knows what you care about ([agent-memory.md](../ready/agent-memory.md)).

### 3. Information you can consume

Everything the team did, in bites instead of walls of text:

- **A «stories» strip** of the day: one card per thing that happened, tapped through in a few seconds, each with the ghost that did it.
- **One headline, then the detail on demand**: the message leads with the one line that matters; the rest folds.
- **Pictures over paragraphs** where they help: a small chart on Finanzas's clipboard, a before/after, a number that grew.
- **Listen instead of read**: a spoken summary of the day, for the car.

## How it ties to the game

The world is where [gamification.md](gamification.md)'s pieces would live: an agent's **level** (the autonomy it has earned) shows in its ghost and its space; **tools** are props it carries; the company's **milestones** (first customer, first invoice) are events in the world everyone sees.

## Open questions

1. **What the world is:** one office with everyone, a room per department, a town that grows with the company, or something else. And whether it is 2D, 3D, or the 3D ghosts on a flat stage.
2. **Replace or add:** does the world replace Equipo's list, or is it a view on top with the list one tap away? The list is what you need for «who wrote last».
3. **The calm desk:** app-design.md wants a calm app you leave quickly; a world invites staying. Can it be both (calm by default, the world when you want it), and can a business user turn the game off?
4. **Phones:** today only one live ghost is drawn at a time. A world with several moving needs either lighter models (Berto's hand-made base body, gamification.md), rendered loops, or 2D.
5. **The agent's voice:** a spoken voice per agent means text-to-speech in the EU (invariant 2) and its cost per message.
6. **Personality:** how much each agent jokes or chats, and whether the organisation can tune it (AGENTS.md rule 6: a setting the main agent can change too).
