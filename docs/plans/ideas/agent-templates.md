# Agent templates, by kind of space

**Priority:** medium — what makes a personal space and a company feel different, once both work the same
**Gate:** agents need more than a ghost, a name and a department (ordago-as-customer.md, «personalisation over departments»)
**Next:** decide what a template holds

Álvaro (2026-11-23): Ghostaff is offered both to people for themselves and to companies. Both kinds of space work exactly the same (welcome-and-spaces.md); the differences are some words and **the agent templates offered**, for instance at the end of the way in and under «Añadir agente».

## What exists

- Adding an agent (`nuevo-agente.tsx`) is a ghost, a name and a department. There are no templates.
- Every new space, of either kind, starts with Secretaría hired (`hire_secretaria`).
- What differs per kind lives in one map, `packages/shared/src/spaces.ts` (`SPACE_LOOKS`): today the third tab's name and icon. Templates join that map, so a screen still never checks `kind`.

## The idea

- A template: a ghost, a name, a department, what it does (its instructions) and the connections it wants. Each marked for `personal`, `company` or both.
- Personal examples: a personal assistant (agenda, mail), «mi agente de métricas» (wearables.md), personal finances. Company: Dirección, Finanzas, Marketing.
- Shown as a short list at the end of the way in («¿Con quién empiezas?») and on top of «Añadir agente»; a template from the other kind stays reachable under «más».

## Open questions

1. What a template holds beyond the ghost and name, which depends on what an agent is once it has instructions and tools of its own.
2. Whether the way in offers templates or Secretaría proposes them in her first message.
