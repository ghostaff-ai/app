# Keys and passwords from the app, never from a terminal

**Priority:** high — Jaime (2026-11-27): «estamos apuntando a usuarios no técnicos»; today any tool without a sign-in button (a mailbox by IMAP, ElevenLabs, a Meta token) only reaches an agent through `org set-secret` in a terminal
**Gate:** decision:Jaime answers the open questions below
**Next:** Jaime answers the open questions; then write the tasks of slice 1 against `develop`

Found moving Órdago's agents ([ordago-agents-in-ghostaff.md](../ongoing/ordago-agents-in-ghostaff.md)): Correo, Finanzas, Productor and Orgánico needed four secrets (`correo-info`, `correo-gmail`, `elevenlabs`, `meta-token`), and the only way in was a hidden prompt in `pnpm --filter @ghostaff/sync org set-secret`, run by someone with `gcloud` and the service-role key. The map of every manual step and its in-app equivalent is in [ordago-as-customer.md](../ongoing/ordago-as-customer.md#what-we-did-by-hand-for-órdago-and-how-a-customer-will-do-it-jaime-2026-11-27).

**Goal:** an owner, on their phone, stores a key or an app password, sees which agents use it, replaces it and removes it; gives it to an agent or takes it away; and an agent that lacks one asks for it in its chat. Nobody opens a terminal, and the value never passes through a model, a message or the database.

## What exists today

The vault (Secret Manager of the environment, `apps/engine/src/vault.ts`) already holds four kinds of secret, each written its own way:

| Kind | Name in the vault | Written by | Read by |
|---|---|---|---|
| AI keys and the Claude subscription | `aiSecretName(org, connection)` | Conexiones › IA (`connections.ts`, `claudeSession.ts`) | the engine, to run the model |
| Connector tokens (Google…) | `accountSecretName(org, provider)` | the sign-in flow (`accounts.ts`) | the engine's tools |
| A guide's `secret` block | `guidedSecretName(org, guide)` | [guided-access.md](../ongoing/guided-access.md) (`guidedAccounts.ts`) | the check, then the agent's access |
| A runner agent's variables | `agentSecretName(org, name)` = `org-<org>-secret-<name>` | **only** `org set-secret` (CLI) | the runner: `agents.secrets` (`{"VARIABLE": "name"}`) → the run's spec → Claude Code's environment |

`agents.secrets` is filled only by `org add-agents` from a YAML's `secretos`. The app neither shows it nor changes it, and a chat agent (not a runner agent) has no way to use one.

## Proposal

1. **One kind for «a key or a password the organisation gives its agents»**: the runner's `org-<org>-secret-<name>`, with a row per secret in the database holding only metadata (name, label, the maker it is for, who stored it, when, last used, health), never the value. A guide's `secret` block writes the same kind, so what a guide gets is usable by a runner agent too.
2. **Conexiones › Claves** (owners): the list (label, maker's icon, which agents use it, stored by, when), «Añadir clave» (a secure field, sent from the app straight to the engine and the vault, as an AI key is today), replace, remove (asks first when an agent uses it, and names them). Masked afterwards, never shown again.
3. **An agent's Herramientas screen** lists its keys and lets an owner give or take one away: it writes `agents.secrets`, through the same owner check and settings rule as `agents.accounts` ([agent-settings.md](../ongoing/agent-settings.md), `settings_agent_accounts`), so the main agent can also do it with an approval card.
4. **An agent asks for a key it lacks**, in its chat: the runner already knows when a secret its row names is not stored (the prompt tells the agent), and [connector-in-chat.md](../ongoing/connector-in-chat.md)'s `ask_for_account` becomes able to ask for a key, with a card that opens the secure field or, when getting the key is not obvious, a guide ([guided-access.md](../ongoing/guided-access.md)). Done means checked: where the maker has a cheap call to try the key, Ghostaff tries it before the agent goes on.
5. **`org set-secret` stays** as the operator's way (migrations, support), writing the same row and the same secret.

Invariants: the value goes app → engine → vault and nowhere else; the model never reads it (a runner agent gets it as a variable, with the known gap in [architecture.md](../../architecture.md#known-gaps) until the proxy exists); a key pasted into a normal chat is taken out of the message and offered to the vault ([guided-access.md](../ongoing/guided-access.md)); only owners store, replace, remove or assign.

## Open questions (Jaime)

1. **Who stores a key:** only owners, or members too with an owner's approval before an agent uses it (as [guided-access.md](../ongoing/guided-access.md) decided for guides)? Recommendation: the same as guides, for one rule across the app.
2. **One key, many agents:** a key is the organisation's and any agent can be given it (Órdago's `correo-gmail` is used by Correo and Finanzas), or one key per agent? Recommendation: the organisation's, given per agent.
3. **Chat agents:** should a chat agent (answering with the model in the engine) be able to use a stored key, through a tool that calls the maker for it without the model seeing the value? Or only runner agents for now? Recommendation: runner agents first; chat agents when a maker needs it.

## Slices

1. The metadata table, Conexiones › Claves (add, replace, remove), and `org set-secret` writing the same row. Checked: Jaime replaces Órdago's `elevenlabs` from his phone on the beta and Productor's next run uses it.
2. Herramientas: give or take a key; the main agent's setting with its approval card.
3. The agent asks for a missing key in its chat; guides write the same kind; the check after storing.
