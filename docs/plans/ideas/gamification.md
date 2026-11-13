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

## Open questions

- What raises a level, so it means something (not just the number of runs)?
- How goals and milestones are defined, per organisation and per department.
- Whether the tool "equipment" view is the same screen as connecting a tool.
- Live 3D, rendered loops, or both. The spike says live 3D works; the look above assumes it.
- How much of this a business user wants to see, and whether it can be turned off.
