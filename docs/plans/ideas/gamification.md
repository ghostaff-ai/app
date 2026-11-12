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

## Open questions

- What raises a level, so it means something (not just the number of runs)?
- How goals and milestones are defined, per organisation and per department.
- Whether the tool "equipment" view is the same screen as connecting a tool.
- Live 3D, rendered loops, or both.
- How much of this a business user wants to see, and whether it can be turned off.
