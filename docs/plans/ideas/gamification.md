# Gamification: agents that level up, tools they carry, company milestones, 3D characters

**Priority:** medium — Jaime wants it (2026-11-28); it builds on the ghosts and the board that already ship
**Gate:** decision:the open questions of «The career», above all whether a promotion grants autonomy (recheck 2026-12-05)
**Next:** Jaime answers the open questions of «The career»; then a first slice: the points ledger and the level on the agent's page, no office yet

Álvaro's ideas (2026-11-12) and Jaime's career for the agents (2026-11-28), written down loosely on purpose. Much of this gets filled in over time; don't treat any detail here as decided.

## Goal

Make working with the team of agents feel a bit like a game, so the progress of the agents and of the company is visible and rewarding.

## Context

The product plan already gives each agent a log of what it learns and a goal it pushes up, and plans a shared toolbox for agents ([`ghostaff-producto.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#lo-común-a-todos)). The game can sit on top of those instead of inventing parallel numbers.

## The ideas

1. **Each agent has a level** that grows as it does new work and learns new things.
2. **Agents are equipped with tools.** The tools are real (email, bank, social media accounts), but connecting one could feel like equipping an item, with its own visualisation.
3. **The company has milestones to reach:** first customer, first invoice, first X € invoiced, and so on.
4. **Each agent has a 3D character** in the app.

## First notes on the 3D characters

From a first look on 2026-11-12. To be re-checked when the work starts.

- **Making them:** an image model (Higgsfield or similar) for the concept picture; an image-to-3D tool such as Meshy or Tripo for a rigged model (GLB). Higgsfield's own 3D output was not confirmed as a rigged GLB.
- **Reuse:** one shared skeleton for every agent, so every animation (idle, working, celebrating) works on all of them. Tools could hang from the character as props; departments differ by colour or outfit.
- **In the app:** live 3D works in Expo on all three platforms (react-three-fiber), at a cost in app size, battery and older Android phones. A cheaper option is short looping videos rendered from the same models.
- **A cheap first test:** one character for one agent, concept image → 3D → shown in the app, to judge the look before committing.

## The characters' look: decided so far (Álvaro, 2026-11-12)

From the [look board](https://claude.ai/artifact/CaMAdpaWCtiyssvCzivKry) (picks stored in it) after the live-3D spike on branch `spike/ghost-3d`: a code-built ghost at `/fantasma` that floats, waves its hem, blinks, spins with a drag and hops on a tap, on web and in Expo Go.

- **One character per agent,** five of them: Secretaría, Incorporación, Finanzas, Redes, Productor.
- **Three concepts per agent to choose from** (not three levels or skins).
- **A ghost worker:** a white sheet ghost with work props, a silhouette of its own per agent, nub hands, big shiny eyes, the department colour on the outfit (not the body), called by its job name.
- **More complex and detailed** than the first sketches.
- **Glossy vinyl-toy finish,** on a simple stage, with a calm idle float.
- **Light and mood change through the day,** following the phone's clock.
- **The app around them:** character on top with the inbox below, a clean calm interface, neutral colours plus one accent, rounded headings, no game layer yet.
- **Open:** who makes the models (researched in the [pipeline page](https://claude.ai/artifact/BKjpcGZqYhfpAEjhPPgzpJ): image model → image-to-3D → Blender driven by Claude → GLB, with a Finanzas test first), and whether all agents share one body.

### Update (Álvaro, 2026-11-13): the glowing ghost

After testing pictures he made in Gemini (kept on `spike/ghost-3d` in `design/concepts/external/`), this replaces the white vinyl body above:

- **The body glows:** translucent and iridescent, blue and violet at the top fading to peach and orange at the wavy hem, soft 3D render. It works on a light background as well as on black.
- **Eyes are hollow dark ovals,** a bit smaller than in the first pictures, no pupils. **Expressions come from the eye shape** (round = neutral, upturned arcs = happy), which in 3D is a swap of the eye shape, not a face rig.
- **Stubby arms** (Álvaro, 2026-11-13, after the Gemini round): they carry the poses (waving, phone to the ear, selfie). Replaces the floating orb hands.
- **Finanzas:** shirt collar and striped tie; props kept few.
- **Props and clothes share the glow:** same iridescent material as the body, no colours of their own. Agents tell apart by silhouette and props, not colour (replaces "department colour on the outfit").
- **One family, not one body** (decision 19, proposed): shared material, eyes, rig and moves; each agent has its own shape, accessories, hand poses and a signature animation.

**Hunyuan3D is ruled out** (2026-11-13): Tencent's licence for Hunyuan3D 2 does not apply in the European Union and forbids using its output there, so nothing it makes can ship in Ghostaff. Image-to-3D has to come from a tool whose licence allows commercial use in Spain: Meshy or Tripo on a paid plan, or an openly licensed model such as Microsoft's TRELLIS (MIT).

### In the app (Álvaro, 2026-11-16)

The six ghosts were made in Tripo from his pictures and cleaned up in Blender (the pipeline and the Taller page to compare tries live on `spike/ghost-3d`, `design/`). He picked them at full detail (not the baked light copies), Tripo's own colours, and only breathing added to the idle (not head or hand moves). They are in the app as `apps/mobile/assets/ghosts/`:

- **Equipo** (link on the inbox): the three departments and the organisation's agents as pictures; tap one to see it live. A department with none says «Vacante». An owner adds agents («Nuevo agente»: pick a ghost; name and department follow, both changeable) and removes them from the agent's page. An agent is a row in `agents` (name, ghost, department) and does no work yet (Álvaro, 2026-11-17).
- **Each decision** shows the ghost of the agent that asks: a picture on the inbox card, live on top of the decision. Órdago's agents map to the ghost of their job (`lib/team`); any other gets the plain ghost.
- Live 3D needs `expo-gl` and `three`: a new store build, not just an update. Only one live ghost is drawn at a time; the models are cut to about 60,000 triangles, without Draco (a phone app cannot decode it), 1.8 to 3.2 MB each (about 14 MB in all; Álvaro compared them with full detail, 2026-11-17).
- **Parked for a later round (2026-11-17):** what to do with Álvaro's "colorful ghost 3d model.glb"; a small chart drawn on Finanzas's clipboard paper; swapping the ties between ghosts. The design tools and every try so far are on branch `spike/ghost-3d` (`design/`).
- **Next: a clean model by hand (2026-11-17).** Álvaro isn't happy with Tripo's heavy output, and Berto, a friend who does 3D, proposed baking. Asked of him: one base body retopologized from `2-tripo/base.glb` (5,000 to 15,000 triangles, loops round the eyes and the wavy hem, clean UVs), the eyes ready for the six expressions (shape keys, or a swappable texture), a simple rig with a bone in each hand to hold objects, each object apart (500 to 3,000 triangles), the Tripo detail baked into 2048 px colour, normal and AO maps, exported as .glb. First test: the base body plus Finanzas's objects (calculator, clipboard, pocket), to judge look and weight before the rest. He works from the full-detail Tripo originals, never the 60,000-triangle phone copies. Everything he needs is in the Ghostaff Drive, `ghosts/`, whose README explains the folders.
- **Not yet seen on a phone:** the live ghosts since the switch to the phone copies (PR #12) were checked on web only.

## The career: from becario up, like a company (Jaime, 2026-11-28)

Jaime, 2026-11-28: «me molaría que se pareciera a algo visual a una organización visual, agentes en una oficina o lo que sea y luego lo quiero gamificar de tal manera que los agentes vayan pasando por varios niveles y vayan evolucionando conforme a cosas que van haciendo bien. Esto pueden empezar por ser becarios, y así subiendo como si fueran niveles de una empresa y vayan sumando puntos por feedback bueno del usuario o por decisiones bien tomadas o por herramientas etc».

It gives idea 1 («each agent has a level») its shape: the level is a job title, and the agents climb a company's ladder. Everything below is a proposal to react to, not decided.

### The office

The organisation seen as an office, the ghosts at work in it. It is where Equipo is already going: Álvaro's «quitamos la lista de chats y ponemos a los fantasmas en una oficina» (2026-11-26) became the board of ghosts on stages ([team-board.md](../ongoing/team-board.md)). The next step is to turn the stages into one floor:

- **Each department is a corner of the office** (Dirección, Finanzas, Marketing), with its light; the main agent at the front desk; an empty desk where a department has a vacancy, which is where «Contratar» lives.
- **A ghost's desk grows with its rank:** a stool for the becario, a desk of its own, then an office with a door for a director. The rank shows without a number.
- **The tag above each ghost stays** («Te espera», «Trabajando…», «Nuevo»), and a promotion gets its moment: a short celebration the first time you see the ghost after it.
- Same rules as today: the phone gets the office, the desktop keeps its list (team-board.md, decision 6); one live 3D ghost at a time, the rest pictures.

### The ladder

| Level | Title (in the app) | Proposed meaning |
|---|---|---|
| 1 | Becario | Just hired. Asks before everything. |
| 2 | Junior | Has a track record of OKs in at least one kind of decision. |
| 3 | Senior | Has signed rules: some decisions it may now take alone. |
| 4 | Responsable | Trusted across its department; may coordinate other agents of it. |
| 5 | Director | The top. Few get here, and it takes months, not days. |

Title by gender or neutral («Becario/a», «Responsable de Finanzas») is open. Names are the founders' to pick.

### What earns points

Only what a person does or what really happened counts, **never the number of runs or messages**, so an agent can't farm points by talking more. Every source below already exists in the database:

| Source | Where it is today | Points (first guess) |
|---|---|---|
| A decision answered OK: the person took the agent's pick | `decisions.answer = 'ok'` | +3 |
| A rule the agent proposed, signed by the owner | `decisions.kind = 'regla'`, answered OK | +10 |
| Good feedback from a person on an agent's message (👍 ❤️ 🙌) | `message_reactions` | +1 |
| An action with a tool that went through | `agent_actions.status = 'done'` | +1 |
| A new tool connected to the agent («equipping an item», idea 2) | `connections` | +2, once per tool |
| A decision answered No | `decisions.answer = 'no'` | 0, or −1 |
| Bad feedback (👎) or an action that failed or was rejected | `message_reactions`, `agent_actions` | −1 |

Caps keep it honest: a person's reactions count once per message and a few per day per agent; a decision counts once, whoever answers it.

### Promotion is a decision, not a counter

This joins Jaime's earlier proposal (2026-11-15, product plan, [El aprendizaje](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#el-aprendizaje-lo-que-nos-diferencia)): the level is the autonomy the agent has earned. Points say an agent is ready; a person promotes it.

- When an agent reaches a level's points, it **asks for the promotion in Decisiones**, like any decision: «Finanzas lleva 40 OKs sin corrección en conciliaciones. ¿La asciendes a Junior?», with what it would be allowed to do from then on. OK promotes it; No keeps it where it is.
- A promotion **never widens what the agent may do by itself without that OK**: same line as the settings rule (AGENTS.md rule 6) and the signed rules per decision type.
- **Going down:** no demotions to start. An owner can always take back a rule, and the ladder follows what it was granted.

### On the agent's page

Below the ghost: its title, a bar to the next level, and the last things that earned or cost it points, each with its reason («+3 · Jaime aprobó "pagar a Iberdrola"»). The points are there to explain the level, not to be the point.

### Data (first sketch)

- An `agent_points` ledger: `org_id`, `agent_id`, `source` (decision, rule, reaction, action, tool), `ref` (the row it came from, unique with `source` so nothing counts twice), `points`, `created_at`. Written only by triggers or `security definer` functions on the rows above, never by the app. RLS and a pgTAP test like every org table (AGENTS.md rule 2).
- `agents.level` holds the granted level, changed only by answering the promotion decision. Points to the next level are a sum, not a stored field.
- **Ghostaff uses Ghostaff:** its own agents (the ones that build it) are the first to climb, and the first test of whether the points mean anything.

### Open questions for the career

1. **Does a promotion grant autonomy**, or is the level only a picture of trust already granted by signed rules? (Proposal above: it asks, and with the OK comes a defined set of permissions.)
2. **Level per agent or per kind of decision?** Autonomy is earned per `kind` today; one agent may be Senior in invoices and Becario in social media. Proposal: one title per agent (the shape people read), with autonomy still kept per kind underneath.
3. The titles and how many levels (five above).
4. Which reactions count as good or bad, and whether a No should cost anything (punishing a No could make agents ask less).
5. How the office looks: one floor drawn flat, a 3D room, or the current stages grouped by department as a first step.
6. Whether a business user can hide the game (see below).

## Open questions

- What raises a level, so it means something (not just the number of runs)? Answered in part by «The career» above (2026-11-28). Jaime's proposal (2026-11-15): the level is the autonomy the agent has earned, raised by OKs without correction and signed rules per decision type, never by runs; written in the product plan, [El aprendizaje](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#el-aprendizaje-lo-que-nos-diferencia), waiting for Álvaro.
- How goals and milestones are defined, per organisation and per department.
- Whether the tool "equipment" view is the same screen as connecting a tool.
- Live 3D, rendered loops, or both. The spike says live 3D works; the look above assumes it.
- How much of this a business user wants to see, and whether it can be turned off.
