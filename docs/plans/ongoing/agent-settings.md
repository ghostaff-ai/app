# The main agent changes the app's settings

**Priority:** high. Álvaro (2026-11-23) wants this from the start: everything an organisation can configure, its agents can configure too
**Gate:** none
**Next:** try it on the beta: ask Secretaría to take Google away from one agent, approve the card, and check the agent's Herramientas screen. Then do the open steps below

## The idea (Álvaro, 2026-11-23)

Anything an owner can change in the app, the organisation's main agent (Secretaría) can change too, inside fixed limits, and every change is accepted as a decision. It is decision 16 of the product plan ([ghostaff-producto.md](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md)), next to «Ghostaff usa Ghostaff». This is configuration only. Changing the code is the developer agent's job ([developer-agent.md](../ideas/developer-agent.md)).

## Decisions (Álvaro, 2026-11-23, all the proposed picks)

1. **Configuration only.** Code changes go through the developer agent, as pull requests.
2. **Only the main agent**, Secretaría (`isMainAgent`: the role, `agents.is_main`). Other agents ask it.
3. **Every change waits for an owner's «Aprobar».** Reading the settings needs no OK. Later, each kind of change can earn autonomy like any other kind of decision (the product plan's autonomy ladder).
4. **The OK is asked where the person already is:** a card in the conversation when someone asked there; a decision in Hoy when the agent proposes on its own (not built yet: today the agent proposes only in chat).
5. **Hard limits, never allowed even with an OK:**
   - connecting or disconnecting accounts, or touching keys;
   - changing owners or roles, or removing people;
   - deleting the organisation, an agent or any data;
   - widening its own reach;
   - changing this list.
   It can prepare an invitation, as a member only.
6. **A rule, not a feature.** Every setting is defined once, and both the screen and the agent use that definition. A test fails when a setting has not been classified. AGENTS.md says so.
7. **First slice:** which connected accounts each agent may use (new, with its own screen), plus the settings that already exist.

## How it works

- **One catalogue:** `packages/shared/src/services/settings.ts`. `SETTING_TOOLS` holds the agent's tools, built on the same service functions the screens call. `DATABASE_FUNCTIONS` classifies every function in `supabase/migrations/`: `agent` (with its tool), `never` (with the reason) or `not_a_setting`. `apps/engine/test/settings.test.ts` fails on a function nobody classified, and on an `agent` entry without a tool that waits for approval.
- **No back door.** The engine never changes a setting with the service role. Reads run as the person who asked, so the agent sees what that person sees in the app. A change runs only after an owner approves it, with that owner's own session (`apps/engine/src/settings.ts`, `asPerson`). The database then checks it exactly as if the owner had made it on the screen. That the person's token takes precedence over the service key was checked against local Supabase on 2026-11-23: the same query returned rows with the service key and none with the person's token.
- **The card says what changes.** Each tool's `describe` writes the label and a «Ahora: … / Después: …» preview. Bad input never becomes a card: the agent hears why instead.
- **Its own reach.** `settings_agent_accounts` refuses the proposing agent itself.
- **Per-agent accounts:** `agents.accounts` (`20261123000000_agent_accounts.sql`, `set_agent_accounts`). null means every connected account, including later ones. In chat, `restrictTo` gives each agent only its own accounts. Screen: Equipo → agent → Herramientas. (`agents.tools` is something else: the Claude Code tools of a run on our own runner.)

## Done

- [x] Catalogue, parity test and AGENTS.md rule
- [x] Per-agent accounts: migration, pgTAP test, screen, used in chat
- [x] Secretaría's tools: read; add an agent; an agent's accounts; a member's access to an agent; the order and names of AI accounts; invite (as a member) and withdraw an invitation
- [x] Approval runs as the approving owner

## Open

- [ ] An «Deshacer» on a done settings card. The before state is already on the card.
- [ ] A settings change proposed on the agent's own initiative (a job), as a decision in Hoy
- [ ] The agent's own rules as settings, once they exist in the app; its timetable is [agent-routines.md](agent-routines.md)
- [ ] Agents on a runner (`ordago_job`, `ghostaff`) honour `agents.accounts` when they get connected accounts
