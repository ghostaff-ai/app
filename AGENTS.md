# AGENTS.md

The guide for anyone (human or AI) working in this repo. Short and load-bearing. When this file disagrees with the code, fix one of them in the same change.

## What this project is

Ghostaff gives a small company or organisation a team of AI agents, grouped into departments (Dirección, Finanzas, Marketing to start), that keeps its shared record, runs its routine work and brings people only the decisions that are theirs to take.

This repo is the product code: the app (iPhone, Android and web from one codebase) and its backend. Nothing is built yet.

**The product decisions live outside this repo**, in the private Órdago business repo: [`ghostaff-producto.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md) (what we build and why) and [`ghostaff.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff.md) (the company). Until Ghostaff is a company of its own, that stays the source of truth for the *why*; this repo holds the *how*. Read it before planning anything here.

**Álvaro decides alone what gets built here and when** (2026-11-12). Jaime is a co-founder, not a gate: never hold work waiting for his review. Only things that are his too (moving `ordago-app/agents`, using his subscription) wait for him.

## Sibling repos

Checked out side by side under `~/githubs/ghostaff-ai/`:

```bash
git clone git@github.com:ghostaff-ai/app.git ~/githubs/ghostaff-ai/app
```

- `ordago-app/agents` is today's agent engine (Claude Code on Cloud Run Jobs). It moves into this org once Jaime agrees; until then, read it, don't copy from it blindly.
- `cultuvilla/app` is the reference for an Expo app with the store release pipeline already working. Reuse its patterns.

Start a session in the repo the work belongs to, never in the parent folder.

## Branches

- `develop` is the default branch and where work lands, through pull requests.
- `main` is what is released.
- Markdown-only changes (plans, this file) may be committed straight to `develop`.

## Plans

Design work lives in [docs/plans/](docs/plans/) by stage (`ideas/` → `ready/` → `ongoing/`), with the agent-plans v2 header (`Priority`, `Gate`, `Next`). Durable rationale for shipped work goes to [docs/decisions/](docs/decisions/). See the `managing-plans-lifecycle` skill.

## Invariants (from the product plan)

1. **Every organisation is separate.** Its record, operational data, documents and keys never mix with another's.
2. **Data stays in the EU**, on storage we own, with a live copy the customer can switch on (their Drive or GitHub) and a full export at any time.
3. **Keys live in a vault**, apart from everything else. No secret is ever committed or pasted into a conversation.
4. **The agents work on files with history** (the record is git); the app reads the database, not the files.
