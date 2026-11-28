# Each agent's photo: blocks it keeps, drawn by the app

**Priority:** high — the way Órdago's panel converges into Ghostaff (desktop-web.md), and what makes an agent's work readable at a glance
**Gate:** none
**Next:** ask a chat agent on the beta for its photo (PR 2 landed in [ghostaff-ai/app#123](https://github.com/ghostaff-ai/app/pull/123) on 2026-11-28); then PR 3, Empresa's «Cómo va cada área». PR 1 landed in [ghostaff-ai/app#113](https://github.com/ghostaff-ai/app/pull/113) on 2026-11-27

Jaime, 2026-11-27, after mockups of Redes and Comercial: «escríbelo y mételo en el código». Órdago's panel shows goals, retention, adoption, the Redes calendar, the organisers' funnel: «elementos que nos están dando los agentes para entender las acciones que están tomando, para entender la empresa». Ghostaff should show them too, for every customer, without a panel built per customer. The mockups are pictures, not in the repo: `~/Desktop/ghostaff/capturas/propuesta-graficos-agentes-2026-11-27.png` and `propuesta-bloques-redes-comercial-2026-11-27.png`.

## Decisions (Jaime, 2026-11-27)

1. **Blocks from a fixed catalogue, not pages the agent writes** (option A over B). The agent chooses which blocks and keeps their data; the app draws them with its own components, the same for every customer. An agent never changes the app: a type the app doesn't know is skipped, text is drawn as text, a file that doesn't parse leaves the last good photo. Pages written by an agent (option B) stay out until a block can't do the job.
2. **Blocks, not just charts**: a goal with its path to the target, a figure with its change, a series, headlines (did, found, changes), a list with a state. Later, when an agent needs them: table, cohorts, funnel, calendar, list with images, map.
3. **One file per agent in its record**, `agentes/<slug>/foto.yaml`, with history like any file. Each agent writes only its own (the record's hook). The sync projects it into `agent_photos`; the app reads that, never the record (invariant 4).
4. **Who does what.** Ghostaff builds each block type once, for everyone. A person asks in the agent's chat («quiero ver cada semana cuánta gente vuelve»), or accepts what the agent proposes. The agent adds the block (the only time the structure changes) and refreshes its data on each run, from whatever its connections reach (BigQuery, Meta, the record). The app redraws it.
5. **The agent proposes what to show.** An agent with no photo proposes, at the end of its next run, the two or three things it would keep on it, so a customer with nothing inventoried still gets one (Jaime: «si el usuario no tiene nada inventoriado, que el agente proponga qué mostrar»).
7. **An agent's settings go behind a gear** on top of its page (Rutinas, Memoria, Quién puede, Herramientas, Quitar), and its 3D ghost scrolls away with the page (Jaime, 2026-11-27, trying PR 1: the page is now what it does, not how it is set up).
6. **Where it shows**: on the agent's page, «Su foto», after what waits for you and before «Últimamente». Every agent's goal together in Empresa («Cómo va cada área») is PR 3.

## The file

```yaml
# agentes/producto/foto.yaml — written by the agent
actualizado: 2026-11-27T09:12:00+01:00
bloques:
  - tipo: meta
    titulo: Vuelven a la semana siguiente
    unidad: '%'
    base: 22              # where it started
    desde: 2026-09-01
    objetivo: 40          # where it has to get
    fecha: 2027-03-31
    serie: [[2026-09-01, 22], [2026-10-01, 26], [2026-11-24, 31]]
  - tipo: cifra
    titulo: Jugadores activos
    valor: 1284
    cambio: 0.06          # +6 % against the last period
    periodo: semana
  - tipo: serie
    titulo: Partidas por semana
    forma: barras         # lineas (default) or barras
    puntos: [[2026-11-03, 3720], [2026-11-10, 3990], [2026-11-17, 3910]]
  - tipo: titulares
    hizo: Cuadró 39 de los 42 movimientos de noviembre.
    encontro: Proveedor Norte no manda factura desde agosto.
    cambia: Le reclamo las facturas cada mes.
  - tipo: lista
    titulo: Esta semana
    elementos:
      - { titulo: 'Reel: el órdago más caro', detalle: 'Mañana 19:00', estado: espera }
      - { titulo: 'Carrusel: 5 señas', detalle: '2.310 de alcance', estado: hecho }
```

Limits: 12 blocks, 200 points a series, 20 items a list, 200 characters a text, 20 KB a file. A block that breaks them, or of a type Ghostaff doesn't draw, is skipped and named; the rest show. A goal's verdict (above, on or below its path) is computed by Ghostaff from `base`, `desde`, `objetivo` and `fecha`, never written by the agent.

## Tasks

**PR 1, the photo on the agent's page**
- [x] `packages/shared/src/record/photo.ts`: `readPhoto` (Spanish file → typed blocks, skipped ones with why), `goalVerdict`, limits; vitest.
- [x] Migration `agent_photos` (agent, org, blocks, skipped, sha, error, updated_at), read by whoever may see the agent, written only by the engine; pgTAP.
- [x] Engine: `projectPhotos` on the sync tick for every agent with a slug, both record hosts; the store's two methods; tests.
- [x] The record's hook: `agentes/<own>/foto.yaml` only its own agent.
- [x] Runner agents' prompt: where their photo is, its format, «no inventes datos», and decision 5.
- [x] App: `getAgentPhoto`, `components/photo/` (goal, figure, series, headlines, list), «Su foto» on `agente/[id].tsx`; jest.

**PR 2, chat agents keep a photo too**
- [x] `apps/engine/src/photo.ts`: `photo_view` and `photo_write` (the whole YAML file, checked with `readPhoto`, a wrong block refusing the write and naming it), committed signed «Cuentas (por Ana)» and projected at once; no approval card, as the memory.
- [x] Every chat agent with a slug and a record in our record store gets them, and the format in its system prompt (`photoFormat`, shared with the runner's `photoGuide`); it proposes a photo before making one.
- [ ] Tried with a real model: nothing in CI or on this machine runs one.

**PR 3, Empresa: «Cómo va cada área»**, every agent's goal in one list.

**Later, when an agent needs them**: table, cohorts, funnel, calendar, list with images, map; and the blocks a person acts on (an OK on a post, moving an organiser), stored as answers the agent reads, as decisions are.
