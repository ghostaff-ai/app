# A developer agent: Desarrollo

**Priority:** medium — Ghostaff's own agents build Ghostaff, and today they run outside the platform
**Gate:** none — the ghost of its own (Álvaro's picture → Tripo, the pipeline in gamification.md) is still his, but does not hold up the build
**Next:** an agent writes the plan for its first job on Ghostaff's own repo, on Álvaro's Ghostaff Premium seat, and promotes this file to ready/

Álvaro's idea (2026-11-20): add a developer agent to the team.

**Decided — Álvaro, 2026-11-21: the four proposals below, as written.** A fourth department,
«Tecnología»; organisation Ghostaff first, on this repo; it opens pull requests alone and merges
only on a «sí» in Hoy; it grows from `ghostaff-ai/agents`. It is also how Álvaro's Ghostaff
Premium seat gets used while he is away (workspace plan `spend-claude-credits`, decision 4), so it
runs on that seat's subscription.

## Why

**Ghostaff uses Ghostaff** (AGENTS.md, decision 14): the agents that build this repo should run through the platform as organisation Ghostaff. Today they are Claude Code sessions on Álvaro's machine. A developer agent is that work, done the way a customer would see it: tasks come from a thread, and what needs a person (merging, spending, anything outside) comes back as a decision.

For customers, the same agent looks after what a small organisation has in code: its website, a form, a small automation.

## What it would be

- **A new job and ghost:** `desarrollo`, «Desarrollo», one line such as «Arregla y mejora vuestra web y vuestras herramientas, y te pide permiso antes de publicar». A ghost with its own silhouette (a laptop, headphones) in the shared glow.
- **Runs on Claude Code**, as `ghostaff-ai/agents` already does on Cloud Run Jobs, with the organisation's own AI account where it has one (llm-connectors.md).
- **Works through GitHub:** a connector to the organisation's repos; it opens pull requests, and merging or publishing is a decision in Hoy unless the owner lets it merge on green checks.

## The questions, and the answers taken

1. **Its department.** Today there are three (Dirección, Finanzas, Marketing; a check in `supabase/migrations/20261117000000_agents.sql`). Proposed: a fourth, «Tecnología», rather than putting it under Dirección.
2. **Who gets it first.** Proposed: only organisation Ghostaff, on this repo, until it works for us; then the website job for customers.
3. **How much it does alone.** Proposed: opens pull requests on its own, merges only with a «sí» in Hoy; the owner can raise that per repo.
4. **Engine.** Grows from `ghostaff-ai/agents` (Claude Code on Cloud Run Jobs), not a new runner; that repo's future is still Álvaro's call (AGENTS.md, Sibling repos).
