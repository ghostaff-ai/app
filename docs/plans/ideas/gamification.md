# Gamification: agents that level up, tools they carry, company milestones, 3D characters

**Priority:** low — not a necessity; valuable later, once the first version works
**Gate:** decision:what each piece is measured by, defined as the agents and goals take shape

Álvaro's ideas (2026-11-12), written down loosely on purpose. Much of this gets filled in over time; don't treat any detail here as decided.

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

## Open questions

- What raises a level, so it means something (not just the number of runs)? Jaime's proposal (2026-11-15): the level is the autonomy the agent has earned, raised by OKs without correction and signed rules per decision type, never by runs; written in the product plan, [El aprendizaje](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#el-aprendizaje-lo-que-nos-diferencia), waiting for Álvaro.
- How goals and milestones are defined, per organisation and per department.
- Whether the tool "equipment" view is the same screen as connecting a tool.
- Live 3D, rendered loops, or both. The spike says live 3D works; the look above assumes it.
- How much of this a business user wants to see, and whether it can be turned off.
