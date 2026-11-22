# The way in, step by step, and your spaces

**Priority:** high — every new person goes through it, and Jaime's own first use (a personal assistant) has no way in today
**Gate:** none
**Next:** PR 1, the way in and the personal space

Jaime walked the way in on the web (2026-11-22, local Supabase, a phone-sized window) and found it poor: too much text, the buttons halfway down the screen, sheets you can't close, the organisation only visible on Hoy, and nothing for someone who wants Ghostaff for themselves. **His first use of Ghostaff is a personal assistant**, before any company. He took the mockups below («me gusta más, sí; usa los fantasmas», 2026-11-22). It builds on [entry-flows.md](../ideas/entry-flows.md) and answers its open question 1.

## What was there (2026-11-22)

1. **Bienvenida**: a form with a name (required) and two optional chip questions (what you do, how you heard of us). The answers are stored in `profiles` and read by nothing.
2. **Empezar**: «Hola, X / ¿Cómo quieres empezar?», then «Crear una empresa» or «Unirme a una empresa», and «Cerrar sesión» in the middle of the way in.
3. **Crear empresa**: four fields, with web, about and links optional. The button sits at the edge of the screen.
4. **Conectar IA** (owners only), then **Hoy**: «No te espera nada», with no next step.
5. Inside: the organisation's name and switcher only on Hoy. The `organizaciones` sheet opens full screen on the web with no way to close it. «Unirme» and the other modals show a back arrow, not a close.

The native app is not held back by the web: the tabs are the system's own (`NativeTabs`) and sheets are native `formSheet`s. The web is what degrades (a sheet becomes a page with no exit), so every screen here is checked on both.

## Goals

1. **The way in is a sequence of full-screen steps**: one question per screen, a ghost on top, progress dots, and the main button pinned to the bottom (above the keyboard and the safe area).
2. **Ask less.** The name only, prefilled from Google or Apple. The two optional questions go.
3. **«Para mí» or «Para mi empresa»** is the second step. «Para mí» creates the person's personal space with no form. «Para mi empresa» asks only the name; web, about and links are added later.
4. **You always see where you are and can switch in one tap**: the space's name sits on top of every tab, and the switcher is a sheet with a close.
5. **Every sheet and modal has a close (X)**, on the phone and on the web.
6. **Secretaría starts on her own** (Álvaro's decision of 2026-11-21 in entry-flows.md, confirmed by Jaime 2026-11-22): every new space, personal or company, is created with her hired, and once its AI is connected she introduces herself. The first Hoy shows her at work, not «No te espera nada».

## Non-goals

- Keeping where you were going across sign-in, and invitation links that open the invitation (entry-flows.md, proposals 1–2): unchanged here.
- A personal catalogue of agents. A personal space shows the same team as a company for now.
- The desktop sidebar: it already shows the organisation and switches. It gets the personal space's look (initial, name) and nothing else.

## Anti-goals

- More text on any step. Each step has a title, at most one short line under it, and one main action.
- Anything that makes the phone feel like a web page to match the web.

## The design

### The steps

| # | Screen | Ghost | Title / line | Main button | Other |
|---|---|---|---|---|---|
| 1 | `bienvenida` | `base` | «¿Cómo te llamas?» / «Así firmarás lo que apruebes.» | Seguir (disabled until a name) | — |
| 2 | `empezar` | `base` | «¿Para qué vas a usar Ghostaff?» | Seguir (disabled until a choice) | Two option cards: «Para mí · Tu asistente personal», «Para mi empresa · Un equipo de agentes». An invitation waiting goes on top as a card that opens `unirme`. A text link «Unirme a una empresa» under the button. |
| 3 | `crear-empresa` (company only) | `incorporacion` | «¿Cómo se llama tu empresa?» / «La web y lo que hacéis, luego.» | Crear | — |
| 4 | `conectar-ia` (owners) | `base` | as today, shorter line | as today | Personal copy says «tu espacio», not «tu empresa». |
| 5 | Hoy | `secretaria` | — | — | First-day card (below). |

- Steps 1–3 share one layout component, `OnboardingStep`: safe area, progress dots (step i of n), the ghost in a fixed-height box (`GhostViewer`, one per screen), title, optional line, content, and a footer pinned to the bottom with the main button and an optional link. It keeps the footer above the keyboard (`KeyboardAvoidingView` on iOS, `lib/keyboard`). On a desktop the column is centred at `DESKTOP_PAGE` width and the footer sits at the bottom of the window.
- **Step count.** «Para mí» has 3 dots (name, purpose, AI); «Para mi empresa» has 4 (name, purpose, company name, AI). A member who joins doesn't see dots after step 2.
- **«Para mí»** calls `create_personal_space()` on Seguir, then `enter(id)` on `ActiveOrgContext` (as `crear-empresa` does today): the guards read that context, which doesn't refresh by itself. The guards then move on to `conectar-ia`.
- **«Para mi empresa»** pushes `crear-empresa` as a full-screen step on the way in (not a modal). Opened later from the switcher, `crear-empresa` is a modal with a close and the same single field. Its `presentation` is computed in `app/(app)/_layout.tsx` from whether the person has a space yet (`card` before, `modal` after): the same route, no copy.
- **`conectar-ia` takes `OnboardingStep` too**: the AI accounts become option cards, and the pinned button reads «Conectar {name}». The dots show only on the way in (the person has exactly one space); reached later (a second company created from «Tus espacios»), it has a close instead and no dots.
- **«Cerrar sesión»** leaves the way in's main screens. It stays reachable from step 2 as a small link at the top right («Salir»), because someone who signed in with the wrong account must have a way out.
- `bienvenida` drops `occupation` and `heard_from` from the UI. The columns and `save_profile`'s defaults stay: dropping them is a migration for no gain, and nothing writes them any more.

### The personal space

- **A personal space is an organisation of kind `personal`**: the same record, agents, connections and decisions as a company, with you alone in it. It reuses everything, and its separation is the organisations' own (invariant 1).
- Migration: `organizations.kind text not null default 'company' check (kind in ('personal', 'company'))`, and a unique partial index on `(created_by) where kind = 'personal'` (one personal space per person).
- `create_personal_space()`, `security definer`: requires a profile; returns the caller's personal space if it exists (idempotent, a double tap is harmless); otherwise inserts one named «Personal» with slug from `slug_for('personal')`, and the owner membership signed with the profile's name. It counts towards the ceiling of ten organisations.
- `create_organization` stays as is and creates `kind = 'company'`.
- pgTAP: another person can't see or change your personal space; a second call returns the same space; a second personal space can't be inserted.
- `Organization` / `MyOrganization` gain `kind`. `createPersonalSpace(client)` joins `@ghostaff/shared/services`.
- In a personal space: «Invitar» is hidden (you're alone in it). Copy that says «empresa» says «tu espacio» instead (conectar-ia, Hoy's no-AI notice).

### Where you are, and switching

- **`SpaceSwitcher`**: a row on top of every tab on the phone (Hoy, Equipo, Registro, Conexiones). It shows the space's initial in a round avatar (a person glyph for the personal space), its name and a caret, and opens `organizaciones`. Hoy keeps the mic beside it. The tabs' own titles («Equipo»…) stay under it. On a desktop the sidebar does this, so the row isn't drawn.
- **`organizaciones` becomes «Tus espacios»**: the spaces with their avatar and the waiting count (personal first, then by name); a check on the one open. Under them, «Invitar a {name}» (company owners only), then «Crear una empresa», «Unirme a una empresa», and «Crear tu espacio personal» if you have none. «Cerrar sesión» goes to a footer line with your email. A close (X) sits top right.
- **`CloseButton`**: one component, an X in a round button, used in every sheet's and modal's header (`headerRight` on the native stack's modals: `crear-empresa`, `unirme`, `invitar`, `nuevo-agente`; drawn in the screen on the header-less sheets: `organizaciones`, `contratar`). It calls `router.back()`, or `router.replace('/')` when there's no history (a sheet opened cold on the web).

### Secretaría starts on her own

- **Hired with the space.** `create_organization` and `create_personal_space` insert her agent (ghost `secretaria`, department `direccion`, name «Secretaría») in the same transaction as the space, so no space exists without her. Spaces created before this keep their team as it is.
- **She says hello once the AI is there.** Her first thread needs a working AI account, which a new space gets one step later (`conectar-ia`). So the first time an owner opens Hoy in a space whose AI can run agents and whose Secretaría has never spoken (no thread), the app calls `agentHello` for her once, as `contratar` does today. Hoy then shows her sentence and her thread. A failure leaves Hoy as it is and is tried again on the next visit.
- **Members** never trigger the hello (only owners hire); they see Hoy as today.

## Approaches

1. **Personal space as an organisation of kind `personal`** (chosen). It reuses the record, agents, connections and the guards. The cost is one column and one function.
2. A personal space named «Personal» with no `kind`: no migration. But nothing can tell it apart: «Invitar» shows, the copy says «empresa», and a second one is possible. It would have to be fixed later.
3. A separate personal mode outside organisations: duplicates agents, connections and decisions per person. It breaks the one model the app has.

For the way in, one stack of separate routes with a shared step layout (chosen) keeps the guards in `app/(app)/_layout.tsx` as the source of truth. A single wizard screen holding all steps in state would duplicate those guards and lose the deep links each step has today.

## Delivery

Two pull requests from one worktree, landed in order with `pnpm pr:land`:

1. **The way in and the personal space**: the migration and pgTAP, the shared model and service, `OnboardingStep`, `bienvenida`, `empezar`, `crear-empresa`, `conectar-ia`, and the end-to-end flows. `sign-in-email.yaml` and `create-company.yaml` change; a new `create-personal.yaml` covers «Para mí». `.maestro/scripts/connect-ai.js` finds the space by its owner's email, not by name: every personal space is called «Personal».
   Secretaría hired with the space is part of this PR's migration.
2. **Spaces and closes**: `SpaceSwitcher` on every tab, «Tus espacios», `CloseButton` on every sheet and modal, and Secretaría's hello on the first Hoy.

## Left to the builder

- Ghost sizes and the progress dots' exact look, within the existing tokens.
- Whether the option cards in step 2 reuse `Choice` with a selected state or are a new `OptionCard`.
- Test IDs for the new flows.
