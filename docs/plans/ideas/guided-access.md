# A guide that walks a person through giving an agent access

**Priority:** high — Jaime (2026-11-24): «una parte super importante del producto que hay que trabajar muy mucho»: the agent will need access we never built a connector for, and a non-technical person has to be able to give it
**Gate:** none
**Next:** move to `ready/` and write the build plan for the WordPress case, starting with the block catalogue as types in `packages/shared`

## Goal

When an agent needs access that isn't a single «Conectar» button (a user in the customer's WordPress, a key from an app we don't have, making an Instagram account professional), it hands the person a **guide**: a short screen, step by step, in plain words, that adapts to what the person actually sees, takes a photo of their screen whenever they are lost, and ends with Ghostaff checking the access works and the agent going on with its task.

The value: the agent can ask for connections nobody planned for, and a person who has never seen an API key still gets it done.

## Context

- **What exists:**
  - [connector-in-chat.md](../ongoing/connector-in-chat.md) covers access that is one button away (kinds A and B): `ask_for_account`, the `AccountAskPart` card, `account_asks` and `POST /threads/:id/resume`.
  - [agent-access-requests.md](agent-access-requests.md) covers Google Cloud IAM for a technical owner, with commands and Terraform.
  - [connectors.md](../ongoing/connectors.md) kind C plans the forwarding address and file uploads.
- **The gap:** everything in the long tail that needs **the person to do something in another app's screens**. Today the agent can only say «Pedirlo», which counts the request and leaves the task stuck.
- **This builds on `account_asks`**, it doesn't replace it. A guide is one more `need` on the same card, with the same resume once the access is checked.

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
- **Every guide stores how to undo it** (remove the user, revoke the key), kept beside the grant, as [agent-access-requests.md](agent-access-requests.md) does for IAM.

### Guides that learn

- **The first time** an app comes up, the agent drafts the path from the maker's docs.
- **When a guide ends checked**, its path is saved, without the organisation's data or screenshots, as a **proven guide** for that app. The next organisation gets that path as the hint.
- **Signals from use:** the steps with the most «No me sale», and screenshots that no longer match the step (the maker changed its screens), flag a guide for review.
- **The most used ones** we polish by hand.

The long tail gets solved once per app, not once per customer. That is hard to copy, because it comes from real use.

### Someone else does it

Common in small businesses: «la web la lleva mi sobrino», «eso lo tiene la gestoría». **«Que lo haga otra persona»** sends that person a link to the same guide, with no Ghostaff account ([external-parties.md](external-parties.md)). The owner sees the progress, and the access arrives when the check passes.

### Phone and computer

Most of these tasks happen on a computer. The guide starts wherever the card is pressed. When a step needs a computer, it says so and offers a QR code or a link to carry on on the web ([desktop-web.md](desktop-web.md)), where the person can **share their screen** (`getDisplayMedia`) and be guided live instead of sending photos. The phone stays useful for photographing the monitor.

### Where it shows

The card in the chat is the same as connector-in-chat's, with a new `need: 'guided'`: «Necesito acceso a tu web» · the `why` line · «Empezar». It opens the guide full-screen. A guide in progress shows in Hoy as something waiting on the person, and resumes where it stopped.

## Rules

- **Ghostaff never asks for the person's own password**, and never opens or suggests a link outside the maker's own domains (an allow-list per app).
- **Least access:** the smallest role that does the job, read before write. The `scope` block says it before the person grants anything.
- **A member's grant waits for an owner** (decision 2): checked and stored, but unused until an owner approves it.
- **A guide only asks**: the access is granted by the person in their own tool. Writes the agent later makes still wait for approval, as today.
- **Screenshots belong to the organisation**: stored with its data in the EU, used for that guide only. They never go into a proven guide.

## First case: access to the customer's WordPress

Chosen because it forces the hard parts: hostings and themes show it differently, so the guide has to adapt, and people need photos. It also exercises the «invite the agent's email» path.

1. «¿Qué ves al entrar en tu web?»: `choice` (black bar on the left / menu at the top / none of these) plus the camera.
2. «Abre Usuarios»: bullets, and on «No me sale» the person's screenshot with «Usuarios» circled.
3. «Invita a Redes»: `copy_value` with the agent's email, the role «Editor», and `scope` («Podrá escribir entradas. No podrá tocar pagos ni usuarios»).
4. The agent accepts the invitation from its mailbox; `check` logs in and confirms the role; resume.

If the photo in step 1 shows another platform, the guide follows that one. That branch is the test that it is really dynamic.

## Decisions

1. **One email address per agent** (Jaime, 2026-11-24), `<agent>@<org>.ghostaff.ai`, not one per organisation. It reads like an employee, each agent's access stays apart (removing Redes's user in WordPress doesn't touch Finanzas), and the person sees in their own tool which agent can do what. Cost: an organisation that wants two agents in the same app invites two users, and the inbound mail (kind C) routes by agent, not just by organisation.

2. **Owners and members may complete a guide** (Jaime, 2026-11-24). The member the agent was talking to is often the one with the account (the person who runs the web), so the card's «Empezar» shows to them too, unlike connector-in-chat's decision 1 where only owners connect. What a member grants **waits for an owner's approval before the agent uses it**: the check still runs when the guide ends, the secret still goes to the vault, but the access stays `pending` and owners get a card, «Luis ha dado a Redes acceso a la web (Editor) · Aprobar». An owner completing a guide needs no second step. This keeps «which accounts an agent reaches is an owner's call» (`agents.accounts`, `settings_agent_accounts`) while letting the person with the account do the work. *(The approval step was part of the recommendation Jaime picked; confirm it if in doubt.)*

## Open questions

3. **Vision model and cost:** Claude's vision for reading screenshots and placing the mark, or a cheaper first pass. To be measured on real screenshots.
4. **Where the agent's own credentials for an invited user live** (the password it sets when accepting an invitation): the vault, per organisation and app, like any token.
5. **Live screen sharing on the web:** the same loop on a frame every few seconds or on demand. Privacy: what is on screen besides the app.

## Builds on

- [connector-in-chat.md](../ongoing/connector-in-chat.md): the card, `account_asks`, resume.
- [agent-access-requests.md](agent-access-requests.md): the same idea for Google Cloud IAM. Its request could be shown as a guide too.
- [connectors.md](../ongoing/connectors.md): kind C, the forwarding address, the vault.
- [external-parties.md](external-parties.md), [desktop-web.md](desktop-web.md), [voice.md](../ongoing/voice.md).
