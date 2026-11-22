# One ghostaff.ai: the website for visitors, the app on a desktop layout once you sign in

**Priority:** high — Jaime (2026-11-21): the web is a way in and where the product is sold, and today the app on a computer is the phone app stretched
**Gate:** decision:either founder on the shape (open questions 1–3)
**Next:** Álvaro reviews the sketches and the open questions with Jaime; then the desktop shell (sidebar and two columns) behind a width breakpoint

Jaime's request (2026-11-21), after seeing the app on `localhost:8083`: on a computer it is the phone app in a browser window, one 400-px column on a wide screen. He wants one web at `ghostaff.ai` that sells the product to a visitor and, once they sign in, gives them everything the app does, laid out for a computer. Sketches of the desktop screens: [Ghostaff en escritorio](https://claude.ai/artifact/AwAH4NaD8rFB8weuW6TUZA) (Hoy, Equipo, Conexiones).

It builds on [web.md](web.md) (the marketing site, Álvaro 2026-11-21: Astro in `ghostaff-ai/web`, Firebase Hosting), [entry-flows.md](entry-flows.md) (the way in) and the calm-desk decisions in [app-design.md](../ongoing/app-design.md), and reopens none of them.

## The idea

**For the person it is one web.**

| Who | What `ghostaff.ai` shows |
|---|---|
| A visitor without an account | The website: the film, the ghosts, the founders, «Entrar» / «Pedir acceso» |
| A signed-in person on a computer | Straight to Hoy, on a desktop layout, with everything the app does |
| On a phone | The native app; the same web also works in the phone's browser |

Linear and Notion work this way: the same domain sells the product to a visitor and is the tool once you are in.

**Under the hood it stays two pieces, served as one.**

1. **The website stays in Astro** (`ghostaff-ai/web`). It must load fast, be readable by Google and carry the scroll-driven film; Astro sends plain HTML and only loads JavaScript where a ghost or the film needs it. Built inside Expo, the visitor would download the whole app bundle (several MB) before seeing the first line.
2. **The app on the web comes from this repo's Expo code**, as today, so data, services, sign-in and tests stay shared with the phone. What changes is its layout on a wide screen (below).
3. **Firebase Hosting serves both at `ghostaff.ai`**: `/`, `/en/`, `/privacidad`, `/terminos`, `/precios` go to the Astro build; `/entrar`, `/hoy`, `/equipo`, `/registro`, `/conexiones`… go to the Expo web build. A signed-in visitor opening `/` is sent to `/hoy`.

Considered and set aside: **everything inside Expo** (the website as a public route of the app). One project, but a heavy first load, weaker search results and a harder film, and it undoes web.md's decision 1.

## Same brand, a different layout

On a computer the purpose shifts: on the phone you come in for two minutes, decide what is yours and leave; at a desk you also set things up (Conexiones, who can talk to which agent), read the Registro, review what an agent made. So the desktop layout is not a different style, it is a different structure:

| | Phone (unchanged) | Desktop (≥ 1024 px) |
|---|---|---|
| Navigation | Three tabs (Hoy · Equipo · Registro) and the mic | A fixed sidebar: organisation, Hoy, Equipo, Registro, Conexiones, «Hablar con Secretaría» |
| Hoy | One decision card after another | The list on the left, the open decision beside it, «Hecho sin ti» folded under the list |
| Equipo | Agents → threads → conversation, one screen each | Agents, threads and the conversation side by side |
| Conexiones | One column of cards | A grid by area with search, and the selected connection's detail beside it (account, what the team can do with it, which agents use it) |
| Input | Tap and swipe | Mouse, hover and keyboard shortcuts (approve, next) |

Shared on both: the ghosts, the palette (`lib/palette.ts`), Rubik for headings, the copy and its tone, every rule of app-design.md.

**How it is built:** one breakpoint read with `useWindowDimensions`; above it, the `(app)` layout swaps the tab bar for the sidebar, and the screens that gain a second column (Hoy, Equipo, Conexiones) render their list and detail together. `.web.tsx` only where a screen differs on the web for another reason than width. No second app, no fork of the services.

## Order

1. **The website** (web.md), already under way: the platforms' reviews need its home page and legal pages first.
2. **The desktop shell**: the sidebar, and Hoy, Equipo and Conexiones in two columns, behind the breakpoint. The phone does not change.
3. **One domain**: the Expo web build deployed to Firebase Hosting beside the Astro site, the routes split as above, the redirect for a signed-in visitor.

## Open questions

1. **Where «Entrar» leads before launch:** straight to sign-up in the app, or to a waiting list («Pedir acceso», as web.md has it)?
2. **Path or subdomain:** `ghostaff.ai/hoy` (one domain, the routing above) or `app.ghostaff.ai` (simpler to deploy; a visitor sees the jump). The proposal is one domain.
3. **Screens only on the desktop:** do some exist only there (managing who can read or talk to each agent, the record's files), or does every screen exist on both and only the layout changes?
