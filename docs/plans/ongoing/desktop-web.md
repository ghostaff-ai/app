# One ghostaff.ai: the website for visitors, the app on a desktop layout once you sign in

**Priority:** high — Jaime (2026-11-21): the web is a way in and where the product is sold, and today the app on a computer is the phone app stretched
**Gate:** decision:Jaime gives the go for step 3, one domain (recheck 2026-12-03)
**Next:** ask Jaime whether to start step 3 (Tasks, stage 2): the Expo web build on Firebase Hosting beside the Astro site, in a PR of its own

Jaime's request (2026-11-21), after seeing the app on `localhost:8083`: on a computer it is the phone app in a browser window, one 400-px column on a wide screen. He wants one web at `ghostaff.ai` that sells the product to a visitor and, once they sign in, gives them everything the app does, laid out for a computer. Sketches of the desktop screens (2026-11-21, before the three tabs): [Ghostaff en escritorio](https://claude.ai/artifact/AwAH4NaD8rFB8weuW6TUZA) (Hoy, Equipo, Conexiones).

It builds on [web.md](../ideas/web.md) (the marketing site, Álvaro 2026-11-21: Astro in `ghostaff-ai/web`, Firebase Hosting), [entry-flows.md](../ideas/entry-flows.md) (the way in), the calm-desk decisions in [app-design.md](app-design.md) and the three tabs of [three-tabs.md](three-tabs.md), and reopens none of them.

**Órdago's panel converges here** (Jaime, 2026-11-24). As Órdago's agents move onto Ghostaff, the panel (`ordago-apps/apps/ordago-panel`) stops launching them, and a web page where a customer follows what their agents are doing is part of the product, not a page each customer builds. Jaime also floated pages per subscription plan, one or several, as some builders offer; not designed yet.

## The idea

**For the person it is one web.**

| Who | What `ghostaff.ai` shows |
|---|---|
| A visitor without an account | The website: the film, the ghosts, the founders, «Entrar» / «Pedir acceso» |
| A signed-in person on a computer | Straight into the app, on a desktop layout, with everything the app does |
| On a phone | The native app; the same web also works in the phone's browser |

Linear and Notion work this way: the same domain sells the product to a visitor and is the tool once you are in.

**Under the hood it stays two pieces, served as one.**

1. **The website stays in Astro** (`ghostaff-ai/web`). It must load fast, be readable by Google and carry the scroll-driven film; Astro sends plain HTML and only loads JavaScript where a ghost or the film needs it. Built inside Expo, the visitor would download the whole app bundle (several MB) before seeing the first line.
2. **The app on the web comes from this repo's Expo code**, as today, so data, services, sign-in and tests stay shared with the phone. What changes is its layout on a wide screen (below).
3. **Firebase Hosting serves both at `ghostaff.ai`**: `/`, `/en/`, `/privacidad`, `/terminos`, `/precios` go to the Astro build; `/entrar`, the tabs (`/decisiones`, `/empresa`…), `/chat`… go to the Expo web build. A signed-in visitor opening `/` is sent into the app.

Considered and set aside: **everything inside Expo** (the website as a public route of the app). One project, but a heavy first load, weaker search results and a harder film, and it undoes web.md's decision 1.

## Same brand, a different layout

On a computer the purpose shifts: on the phone you come in for two minutes, decide what is yours and leave; at a desk you also set things up (Conexiones, who can talk to which agent), read the Registro, review what an agent made. So the desktop layout is not a different style, it is a different structure.

Since this was written, the phone's navigation changed ([three-tabs.md](three-tabs.md), Álvaro 2026-11-23): no Hoy and no mic; three tabs, Equipo · Decisiones · Empresa, with Conexiones and Registro inside Empresa. The desktop follows (decisions 4 and 5):

| | Phone (unchanged) | Desktop (≥ 1024 px, on the web) |
|---|---|---|
| Navigation | Three tabs (Equipo · Decisiones · Empresa), the space's name on top of each | A fixed sidebar: the space, Equipo, Decisiones, Empresa, and under Empresa, Conexiones and Registro |
| Equipo | The agents, then a chat, one screen each | The agents on the left, the open chat beside them |
| Decisiones | The deck, one card at a time | The same deck, centred |
| Conexiones | One column, then a connection's page | The list on the left, the open connection beside it |
| Input | Tap and swipe | Mouse, hover and keyboard |

Shared on both: the ghosts, the palette (`lib/palette.ts`), Rubik for headings, the copy and its tone, every rule of app-design.md.

**How it is built:** one breakpoint read with `useWindowDimensions` (`lib/layout.ts`, web only: a tablet keeps the phone's tabs); above it, the `(app)` layout swaps the tab bar for the sidebar, and on Equipo's and Conexiones' routes a list column stands between the sidebar and the screen, so the list stays put while its detail changes. `.web.tsx` only where a screen differs on the web for another reason than width. No second app, no fork of the services.

## Order

1. **The website** (web.md), already under way: the platforms' reviews need its home page and legal pages first.
2. **The desktop shell**: the sidebar, and Equipo and Conexiones in two columns, behind the breakpoint. The phone does not change.
3. **One domain**: the Expo web build deployed to Firebase Hosting beside the Astro site, the routes split as above, the redirect for a signed-in visitor. A pull request of its own after step 2's, touching `ghostaff-ai/web` too; it starts only once Jaime says so.

## Decisions

1. **Before launch, «Entrar» is for people who already have an account or an invitation** (Jaime, 2026-11-26). A visitor without one goes to the waiting list, «Pedir acceso», as web.md has it; there is no open sign-up from the website yet.
2. **One domain, `ghostaff.ai/…`, not `app.ghostaff.ai`** (Jaime, 2026-11-26). Firebase Hosting splits the routes between the Astro site (`ghostaff-ai/web`) and this repo's Expo web build, as in «The idea».
3. **The same screens on the phone and the desktop; only the layout changes** (Jaime, 2026-11-26). No screen exists only on the desktop: managing who reads or talks to each agent, or the record's files, are screens of the app on both, when they come.
4. **The sidebar is the space, Equipo, Decisiones and Empresa, with Conexiones and Registro as direct entries under Empresa** (Jaime, 2026-11-26). It mirrors the three tabs; Conexiones and Registro are one click away because the desk is where things are set up. No «Hablar con Secretaría»: she is pinned first in Equipo.
5. **Decisiones stays the deck on the desktop, centred; two columns only in Equipo (the agents and the chat) and Conexiones (the list and the connection)** (Jaime, 2026-11-26). It keeps three-tabs.md decision 7 (Álvaro) as it is.

## File Structure

Step 2, against `develop` at `1cc4d4f` (2026-11-26). Already there from 2026-11-21 and the three tabs: the breakpoint (`lib/layout.ts`), the sidebar with the space, Equipo, Decisiones and Empresa (`components/Sidebar.tsx`), no tab bar on a desktop (`(tabs)/_layout.tsx`), `SpaceSwitcher` hidden there, and a phone's measure for a connection's page (`DESKTOP_PAGE`). All paths under `apps/mobile/`.

- Modify `lib/layout.ts`: which sidebar entry and which list column a path belongs to (`desktopSection`), the list column's width, and opening a detail beside its list (`useReplacesBeside`: push from the list's own screen, replace when a detail is already open, so the stack doesn't grow).
- Modify `components/Sidebar.tsx`: Conexiones and Registro under Empresa; the active entry from `desktopSection`. An agent's «Herramientas» belongs to Equipo, not Empresa.
- Create `components/DesktopListColumn.tsx`: the column between the sidebar and the screen, Equipo's or Conexiones' list by the path.
- Modify `app/(app)/_layout.tsx`: the list column on a desktop; no back arrow on the chat and a conversation there (the list is the way back).
- Create `components/team/TeamList.tsx`: Equipo's list (the no-AI notice, one row per agent and conversation, «Añadir agente»), out of `(tabs)/index.tsx`, with the open one marked.
- Modify `app/(app)/(tabs)/index.tsx`: the phone renders `TeamList`; the desktop shows what to do in the empty detail («Elige con quién hablar»).
- Create `components/connections/ConnectionsList.tsx`: Conexiones' list (IA with its order, Cuentas, «Accesos de tus agentes», «Pendientes de aprobar», «Añadir conexión»), out of `(tabs)/empresa/conexiones/index.tsx`, with the open one marked.
- Modify `app/(app)/(tabs)/empresa/conexiones/index.tsx`: the phone renders `ConnectionsList`; the desktop, the empty detail.
- Modify `app/(app)/(tabs)/empresa/_layout.tsx`: on a desktop no header on Conexiones and a connection's page (the list column carries the title).
- Modify `components/ui.tsx`: `ListRow` gets `selected` (the open row in a list column) and `href`/`replace` (a link on the web).
- Modify `components/connections/PendingGuides.tsx`: always the grouped list (the grid of three was for the old one-column desktop page).
- Modify `__tests__/layout.test.ts`: `desktopSection` for every route family.
- The chat (`chat/[agent].tsx`, `conversacion/[id].tsx`) is not touched: group-chat-per-agent.md is changing it; only its header options change, from the layout.
- `.maestro/flows/ci/` runs on Android, whose screens don't change: no flow changes.

## Tasks

### Stage 1: the desktop shell (step 2, PR `feat/desktop-shell`)

- [x] `desktopSection` and `useReplacesBeside` in `lib/layout.ts`, with tests
- [x] Sidebar: Conexiones and Registro under Empresa
- [x] `ListRow` `selected`, and `href` so a row that opens something is a link on the web (Cmd-click opens a new tab)
- [x] Equipo: `TeamList` out of the tab screen; the list column and the chat beside it; the empty detail
- [x] Conexiones: `ConnectionsList` out of the screen; the list column and the connection beside it; the empty detail
- [x] No back arrow on a detail opened beside its list
- [x] Review against Vercel's Web Interface Guidelines
- [x] Check with `pnpm app:web` below and above 1024 px (900, 1024, 1280) and on a phone width; `pnpm check`
- [ ] Land with `pnpm pr:land`

Found on the way, not in this PR: an AI account's row in Conexiones is a `<button>` holding its up and down `<button>`s, which React warns about on the web (it was so before); the list column doesn't follow new messages live, it reads them again when another chat opens.

### Stage 2: one domain (step 3, its own PR, waits for Jaime's go)

- [ ] Ask Jaime before starting
- [ ] The Expo web build (`pnpm --filter ghostaff-mobile export:web`) deployed to Firebase Hosting beside the Astro site, in `ghostaff-ai/web`'s `firebase.json` or a shared site config
- [ ] Rewrites: the Astro pages (`/`, `/en/`, `/privacidad`, `/terminos`, `/precios`) to Astro, everything else to the Expo build's `index.html`
- [ ] «Entrar» on the website to `/entrar`; «Pedir acceso» to the waiting list (decision 1)
- [ ] A signed-in visitor opening `/` is sent into the app
