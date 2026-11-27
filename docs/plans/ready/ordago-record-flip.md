# Órdago's record into our record store (the flip)

**Priority:** medium — today there is one master, so nothing is at risk; but Órdago gets no memory tools while its record is on GitHub, and the migration of its agents does not end until it moves
**Gate:** none
**Next:** build A (the organisation's GitHub installation apart from its record) on its own branch

**Goal:** When Órdago is made again in production, its record is born in production's record store (Forgejo on the VM `record-store`) with the whole history of `ordago-app/business`; people push to it through an authenticated door, GitHub becomes a read-only copy, and nothing that reads or writes the record today breaks. On the beta nothing changes: Órdago keeps its GitHub record there.

## Context

As of `1b18480` (2026-11-27). Decision 2 of [ordago-agents-in-ghostaff.md](../ongoing/ordago-agents-in-ghostaff.md) says the record ends up in Ghostaff and GitHub stays Órdago's master only during the migration. Decision 6 of [record-store.md](../ongoing/record-store.md) makes GitHub the master for Órdago alone until this flip, then a push mirror. Both put the flip last, and neither says how. This plan does.

**Where things stand on the beta (checked 2026-11-27):**

- `organizations`: Órdago has `record_host = 'github'`, `record_repo = 'ordago-app/business'`, `record_installation` set. The other five organisations are `record_host = 'ghostaff'`, `record_repo = 'records/<org id>'`. Órdago has no repo in Forgejo: the tick only provisions organisations without `record_repo`.
- **There is one master.** The database holds projections (`decisions` from `por-decidir/`, `agents.task` from `agentes/<slug>/AGENTS.md`, `externos/`), refreshed by the tick every five minutes; the app's edits are written back as commits on GitHub, and the record wins a conflict.
- **Agents:** eight run on our runner (comercial, correo, desarrollo, direccion, finanzas, legal, producto, seo), Secretaría is a chat agent, and three are still jobs in `ordago-agents` (lamesa, organico, productor: `runner = 'ordago_job'`).
- **Who writes the record**, last 300 commits (since 2026-11-14): Álvaro 112, `ordago-agentes[bot]` (the old jobs) 83, Jaime 99, `ghostaff-registro[bot]` (our engine and runner) 6. **People write more than half of it**, from their own Claude Code, locally and in cloud sessions (four `claude/*` branches are on GitHub today). The panel (`ordago-apps/apps/ordago-panel`) also writes it ([ordago-as-customer.md](../ongoing/ordago-as-customer.md)).
- The repo is about 30 MB, no LFS, `main` unprotected, with a client-side perimeter check in `.githooks/pre-commit`.
- The VM `record-store` (`ghostaff-beta`, `europe-west1-b`, `e2-small`, `10.132.0.2:3000`) has no public address; production has none yet.

## What blocks the flip today

1. **Three agents still write from outside Ghostaff.** La Mesa, Productor and Orgánico wait on the runner's media tools (`feat/runner-media-tools`), and Orgánico also on `ordago-reels` in the GitHub App's installation. While the old jobs push to GitHub, GitHub must stay the master.
2. **An agent's other repos hang off the record's GitHub installation.** `apps/engine/src/runner.ts` mints the tokens for `agents.repos` (`ordago-apps`, `ordago-reels`) and reads the CI queue (`ritmo`) with `org.installation`, which exists only when `record_host = 'github'`; the database requires `record_installation` to be null for `record_host = 'ghostaff'` (`20261125300000_record_store.sql`). Flipping today would leave Desarrollo, SEO and La Mesa without `ordago-apps`, and every `repo_ci` check would fail.
3. **People cannot reach Forgejo.** No public address (record-store.md: «a public, authenticated door; it is its own card»), and the pre-receive hook (`apps/engine/src/recordHook.ts`) refuses every pusher but the engine and the organisation's agents, and every branch but `main`.
4. **Nothing copies Forgejo back to GitHub.** No push mirror is built (`apps/engine/src/forgejo.ts` has none). Whatever reads GitHub would freeze: the panel, `business/scripts/telegram.py`, Claude Code sessions with the repo checked out, the GitHub links across both repos (this repo's `AGENTS.md` points at `ghostaff-producto.md` in `business`).
5. **The hook's rules meet Órdago's layout.** Everything outside `AGENTS.md`, `memoria/` and `externos/` is free to any agent, which matches what Órdago's agents write today; but what they learnt is still in `agentes/<a>/README.md` and the YAMLs, not in `memoria/agentes/<slug>/` (agent-memory.md moves it as each agent moves). The perimeter check in `.githooks/pre-commit` runs only where a clone sets `core.hooksPath`; on Forgejo it could run on the server instead.

## Approach

### Before the cut (each its own branch, in any order)

- **A. The organisation's GitHub installation, apart from its record.** A column `organizations.github_installation` (or a row in connections), filled from `record_installation` for Órdago by the migration; `agents.repos` tokens, `gh` and `ritmo`'s CI queue use it; `record_installation` keeps meaning only «the record is on GitHub». Useful beyond Órdago: any organisation whose agents touch its code on GitHub (organisation Ghostaff and `ghostaff-ai`'s repos, for one). Still to choose when it starts: rename `record_installation` to `github_installation` (one column, required when `record_host = 'github'`, optional when `'ghostaff'`; my pick, one fact in one place) or add the new column beside it (the same id twice for Órdago until the cut). What changes either way: the check `organizations_record_complete` (`20261125300000_record_store.sql`); `toOrg` in `apps/engine/src/recordStore.ts` and `RecordOrg` in `recordSync.ts`; the repo tokens and the CI queue in `apps/engine/src/runner.ts` (`freshToken(org.installation, …)` for `agents.repos`, `ciQueued(org.installation, …)`); in `apps/sync/src/cli.ts`, `org set-record` and `org add-agents`' refusal when the record is not on GitHub, plus a command to set the installation of an organisation whose record is ours; `supabase/tests/database/record_connector.test.sql`.
- **B. The last three agents on our runner**, already planned in ordago-agents-in-ghostaff.md («Order»). Then `ordago-agentes[bot]` writes nothing.
- **C. A door for people** (decision 1): Forgejo reachable over HTTPS from outside the VPC, with a Forgejo user per member and a token for their Claude Code; cloud Claude sessions push their branches there too. Production's record store must exist first (`bash scripts/setup-record-store.sh prod`, record-store.md). The door is also what any customer needs to clone their record; built for every organisation, not only Órdago.
- **D. The push mirror to GitHub.** Forgejo's push mirror of `main` to `ordago-app/business` with a deploy key (decision 3). GitHub's `main` gets a rule that only the mirror pushes, so nobody writes the copy by mistake.
- **E. The hook for people and for Órdago's perimeter.** A `person` case per member who may push, allowed everything (decision 2), on `main` and on their own branches; the perimeter rules of `.githooks/pre-commit` run in the server's hook for this organisation (decision 4), so they hold whoever pushes.

### The cut, inside «Órdago into production» (item 8 of ordago-agents-in-ghostaff.md)

That item makes the organisation, its people, agents and connections again in production's Supabase. The record joins that same sitting; there is no flip of a row on the beta.

1. **Stop every writer of the old master.** Órdago's agents on the beta stop (their timetables off, new runs refused for the organisation); Álvaro and Jaime stop pushing; GitHub's `main` is protected so nobody pushes, until the mirror does.
2. As production Forgejo's admin: create `records/<org id>` for production's Órdago and `git push --mirror` from a fresh clone of GitHub (`main` with all its history; the `claude/*` branches are left behind, finished or not). The organisation's row is made with `record_host = 'ghostaff'` and that `record_repo`, and its GitHub installation in its own column (A); the tick then makes the agents' users, the hook and the branch protection (`recordProvision.ts`).
3. Run a tick by hand and compare with the beta's Órdago: the same `decisions`, `agents.task` and `externos` rows, nothing written back.
4. Switch the push mirror on and check one commit reaches GitHub.
5. Turn production's timetables on; check one run of a light agent (Legal) clones, pushes and reports. Turn on Órdago's memory tools (business-brain.md, «Only on our record store»).
6. People make their Forgejo users and re-point their clones (`git remote set-url origin …`).
7. **The beta's Órdago stays on GitHub but writes nothing**: its agents stay off, and its row loses `record_repo` and `record_installation` so its sync stops writing back to what is now a copy. It is kept to look at, not to work in.

**Going back**, while the mirror runs, is GitHub unprotected and the beta's Órdago turned on again: GitHub holds every commit up to then. Once people have pushed to Forgejo and the mirror has stopped, there is no cheap way back.

## Decisions

1. **People write in Forgejo through an authenticated door** (Jaime, 2026-11-27: option a). Rejected: (b) people keep writing on GitHub and a sync carries their commits into Forgejo, two places taking writes, which is the second master the flip exists to remove; (c) people write the record only through Ghostaff, unrealistic while Álvaro and Jaime write about 70 % of its commits by hand.
2. **A person may push anything** (my pick, Jaime may change it): they own the record, it matches today, and the hook then guards agents only. Rejected: everything but `externos/` and the agents' `AGENTS.md`, which the app already edits with a commit in their name.
3. **The mirror pushes with a deploy key** with write on `ordago-app/business` only (my pick, Jaime may change it): Forgejo's push mirror keeps one fixed credential and the GitHub App's tokens last an hour. Rejected: a fine-grained token renewed by the tick, more moving parts for the same reach.
4. **The perimeter check runs on the server** (my pick, Jaime may change it), in this organisation's pre-receive hook, so it holds for every pusher, agents and cloud sessions included, which today skip it unless their clone sets `core.hooksPath`. Rejected: leaving it client-side as today.
5. **Only in production** (Jaime, 2026-11-27): the record moves when Órdago is made again in production with the first release, once. Rejected: flipping on the beta now and again in production, two cuts for the same result.

## Out of scope

- The flip for other organisations: they were born in our record store.
- A live copy to Drive.
- Retiring `ghostaff-ai/agents` and the old Telegram bot: ordago-agents-in-ghostaff.md («Telegram off»).
