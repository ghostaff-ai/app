# Ghostaff's own record store: one Forgejo per environment, a repo per organisation

**Priority:** high — every organisation needs a record before agents can remember anything or have instructions of their own ([agent-memory.md](../ready/agent-memory.md), decision 2)
**Gate:** decision:Jaime — the six decisions below (where Forgejo runs, how it is reached, who pushes as whom, when a repo is made, backups, GitHub's place)
**Next:** Jaime picks the decisions below; then write the File Structure and Tasks against that day's code

**Goal:** Every organisation, personal spaces included, gets a record (a git repo) on storage we own in the EU when it is created; the engine and our runner read and write it as they do Órdago's GitHub record today; an agent can push only what it may write.

## Context

As of `2b52551` (2026-11-24). The product plan puts the record in «Forgejo on a small server in that project, one repo per organisation, with an optional live copy to the organisation's Drive or GitHub» ([build-first-version.md](../ongoing/build-first-version.md)). It is step 6 of [ordago-agents-in-ghostaff.md](../ongoing/ordago-agents-in-ghostaff.md), not built. Today a record exists only where an owner connects a GitHub repo through our GitHub App «Ghostaff Registro» (`organizations.record_repo`, `record_installation`): Órdago's `ordago-app/business`. The engine reads and writes it through GitHub's API (`apps/engine/src/recordSync.ts`, `githubApp.ts`), and a run clones it with a one-hour installation token ([architecture.md](../../architecture.md)).

Jaime decided on 2026-11-24 that memory lives in the record ([agent-memory.md](../ready/agent-memory.md)) and so does each agent's prompt (`agentes/<slug>/AGENTS.md`), with this store built first. Without it, only Órdago could have either.

## Design (with my picks; the decisions are below)

### Where it runs (decision 1)

**Forgejo on a Compute Engine VM in each environment's project** (`ghostaff-beta`, `ghostaff-prod`), `europe-west1`: one small machine running Forgejo's container, its repos and its SQLite database on one persistent disk. Git needs a real filesystem with locks, which Cloud Run cannot hold: its bucket mounts break git's locking, and Filestore, the managed alternative, starts far bigger and dearer than this. Forgejo gives what we would otherwise write: an HTTP API close to GitHub's (contents, commits per path, which feeds «Historial»), users and tokens, branch protection, server-side hooks, and push mirrors (the live copy to the organisation's GitHub, later).

### How it is reached (decision 2)

**No public address.** The VM sits on the project's VPC; the engine (Cloud Run service) and `agent-runner` (Cloud Run job) reach it on its internal address through Direct VPC egress. No person reaches it; a person reads the record through the app. A member cloning the record from their own Claude Code ([agent-memory.md](../ready/agent-memory.md), Out of scope) will need a public, authenticated door; it is its own card.

### Who pushes as whom (decision 3)

- **The engine is Forgejo's admin**, with an admin token in Secret Manager: it creates repos and users, and writes the app's edits (an answered decision, a corrected recuerdo, an owner's change to an agent's instructions) as commits signed with the person's name. Like the service-role key, it is platform storage the engine administers, not a customer's system.
- **Each agent is a Forgejo user** (`agent-<id>`), created with the agent and made a writer of its organisation's repo only. A run's spec carries a token for that user, minted at spec time and deleted when the run reports (Forgejo tokens don't expire on their own; the tick deletes any older than a run's longest timeout).
- **A server-side pre-receive hook** enforces by pusher what agent-memory.md decides, so it holds even when an agent bypasses its own guard: an agent pushes nothing under `memoria/empresa/` unless it is Secretaría, nothing in another agent's `memoria/agentes/<slug>/`, and never an `AGENTS.md` (instructions change only through the engine, after an owner). A refused push tells the agent why. Branch protection forbids force pushes and deleting `main`. This closes «the record's default branch has no protection» in architecture.md's Known gaps.

### When a repo is made (decision 4)

**When the organisation is.** After `create_organization` or `create_personal_space`, the app asks the engine to provision the record; the tick provisions any organisation still without one, so a failure retries on its own. A new repo starts with the organisation's `AGENTS.md`, `memoria/empresa/`, `por-decidir/` and an `agentes/<slug>/AGENTS.md` for each agent it already has. Organisation Ghostaff gets its record here from day one (ordago-agents-in-ghostaff.md decision 2). An organisation with no record yet works as today: chat agents answer, nothing is remembered.

### Backups (decision 5)

**A daily snapshot of the disk, kept 30 days, stored in the EU**, and a monthly restore check into a throwaway VM. The record is also its own history: a bad push is reverted with git, not restored from a snapshot. If the VM is down, chat agents still answer (they read the database's projection), runs that need the record wait, and the app's edits wait in the database for the next write-back.

### GitHub's place (decision 6)

**The engine reads and writes a record through one interface with two implementations**: Forgejo for every organisation, and the GitHub App for one that brings its own repo as master, which today is only Órdago during its migration. When Órdago's master flips into Ghostaff (ordago-agents-in-ghostaff.md decision 2), GitHub becomes what the product plan says it is: a push mirror, the live copy an organisation may switch on.

## Decisions (for Jaime)

1. **Where Forgejo runs.** (a) A Compute Engine VM per environment with its disk and SQLite (my pick). (b) Cloud Run with Cloud SQL and Filestore: more managed, several times the price, and the same Forgejo underneath. (c) A hosted Forgejo (Codeberg or a paid host): nothing to run, but the data is on someone else's storage, against invariant 2.
2. **Internal only** (my pick), with a public, authenticated door later when a member clones; or public from the start behind Forgejo's sign-in.
3. **A Forgejo user per agent and a server-side hook on paths** (my pick); or one user per organisation, with read-only enforced only by the engine on chat turns and by the runner's guard, which is a net, not a wall.
4. **A repo with every organisation, at creation** (my pick); or only once someone uses memory or edits an agent's instructions: fewer repos, but every feature then checks whether the record exists.
5. **Daily snapshots, 30 days, a monthly restore check** (my pick); or hourly, at a higher price, if losing a day of an organisation's record is too much.
6. **GitHub as master only for Órdago until its flip, then a push mirror** (my pick); or keep «bring your own GitHub repo as master» as a product option for customers who want it, at the price of two ways of writing a record forever.

## Out of scope

- A person cloning the record (decision 2), and the live copy to the organisation's own GitHub or Drive.
- High availability: one VM per environment, restarted by Compute Engine if it stops; a second one when an outage has cost something.
- Moving Órdago's master from GitHub (ordago-agents-in-ghostaff.md decides when).

## Testing strategy

Vitest in the engine: the record interface against a Forgejo container (provisioning a repo and users is idempotent; a run's token can push its own repo and no other; it is deleted on report and by the tick), and the same sync tests the GitHub implementation passes. The pre-receive hook as a script with its own tests: each forbidden path by each kind of pusher, and the allowed ones. A restore check run by hand into a throwaway VM, then monthly. On beta: a new organisation gets its repo within a tick; Legal's run clones, pushes its memory and is refused on `memoria/empresa/`.
