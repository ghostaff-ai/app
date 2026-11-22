# Órdago as a customer: grow Ghostaff by walking a real company through it

**Priority:** high — Ghostaff lacks too much to take Órdago's agents today, and a real company is how we find out exactly what
**Gate:** none
**Next:** create the production Supabase project ([environments.md](environments.md), step 1)

Jaime (2026-11-22): before moving Órdago's twelve agents ([ordago-agents-in-ghostaff.md](ordago-agents-in-ghostaff.md)), walk Órdago through Ghostaff the way a new customer would, see what is missing, and build that. Ghostaff should take everything Órdago's panel does today, and become more generic on the way: a person comes in wanting to automate a task, and Ghostaff helps them define it, instead of handing them pre-made agents that are only a face.

## What Jaime wants changed in the product

1. **Personalisation over departments.** Today an agent is a ghost, a name and a department ([nuevo-agente.tsx](../../../apps/mobile/app/(app)/nuevo-agente.tsx): «for now an agent is only how the team looks»). A marketing agent still needs the person to define everything underneath. The way in should be «I want to automate X»: the person explains it (text or a voice note), Ghostaff gives guidelines and asks, and the agent comes out of that. Departments stay as a way to group, not the entry point. This changes decision 13 of the product plan, so it needs Álvaro too.
2. **The organisation's assistant**, created by default and kept close at hand: the business repo made product. At Órdago we put everything about the business in `ordago-app/business`, and any question about Órdago gets answered from it. Every organisation should know it has a place to drop anything (files, links, audio, text) and an agent that knows the business: it answers questions with the source, reminds of things, and advises when creating other agents. In English the role is a Chief of Staff; the Spanish name is still open. It is **separate from Secretaría** (which filters the mail). Builds on the idea in `ideas/business-brain.md`.

## The fronts, in order (agreed with Jaime, 2026-11-22)

1. **Two environments, beta and production**, each with its own Google Cloud project and Supabase, deployed from CI: merge to `develop` deploys beta, merge to `main` deploys production. [environments.md](environments.md).
2. **Claude subscription in Conexiones**, deployed and tried with Jaime's real subscription, so agents run on it as they do on the panel. Built, untried ([llm-connectors.md](llm-connectors.md)). Depends on 1.
3. **A test walk with Órdago on beta**: a test organisation, one real Órdago agent rebuilt from zero through the customer flow (one that reports every few days what works and what doesn't: SEO or Orgánico), plus a point-by-point comparison with Órdago's panel (`ordago-apps/apps/ordago-panel`). Out comes the list of what is missing, which orders what follows.
4. **The organisation's assistant** (above). Hidden dependency: a new organisation needs somewhere to keep its record, and today only the GitHub record connector exists ([ordago-agents-in-ghostaff.md](ordago-agents-in-ghostaff.md), step 6). The app also has no file upload yet.
5. **Create your own agent**: ask in your own words, a few questions, its card, a trial run, then it runs on its timetable and reports. The sketch in the product plan («Agentes a medida», Jaime 2026-11-14) is the starting point.
6. **Move Órdago's twelve real agents to production** with the existing plan. **Not yet** (Jaime, 2026-11-22): only once fronts 1–5 have the architecture ready.

Each front gets its own plan when it is designed; this file only keeps the order and the why.

## What the panel has and Ghostaff lacks (first look, 2026-11-22; front 3 makes it exact)

- Ghostaff has: the decision inbox synced from `por-decidir/`, team chat, connectors, the vault, the runner (not deployed).
- The panel also has: a desk per agent (what waits on you, its goal, three headlines, history, Indicaciones, autonomy, a run button), the board (`tablon/`) for feedback to an agent, and tabs of metrics per area (Redes, SEO, Producto, Finanzas, Correo, Estrategias…).

## Decisions that need both founders

- Personalisation over departments (changes decision 13).
- The split of environments was a proposal for Álvaro (build-first-version.md, 2026-11-15); Jaime decided it on 2026-11-22 and starts it.
