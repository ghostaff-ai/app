# Órdago's record into our record store (the flip)

**Priority:** medium — today there is one master, so nothing is at risk; but Órdago gets no memory tools while its record is on GitHub, and the migration of its agents does not end until it moves
**Gate:** decision:where people write the record after the flip (question 1) and in which environment the flip happens (question 5)
**Next:** answer questions 1 and 5, then split the preconditions into their own branches

**Goal:** Órdago's record moves from `ordago-app/business` on GitHub to its own repo in our record store (Forgejo on the VM `record-store`), keeping its whole history; GitHub becomes a read-only copy, and nothing that reads or writes the record today breaks.

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

- **A. The organisation's GitHub installation, apart from its record.** A column `organizations.github_installation` (or a row in connections), filled from `record_installation` for Órdago by the migration; `agents.repos` tokens, `gh` and `ritmo`'s CI queue use it; `record_installation` keeps meaning only «the record is on GitHub». Useful beyond Órdago: any organisation whose agents touch its code on GitHub.
- **B. The last three agents on our runner**, already planned in ordago-agents-in-ghostaff.md («Order»). Then `ordago-agentes[bot]` writes nothing.
- **C. A way in for people** (question 1).
- **D. The push mirror to GitHub.** Forgejo's push mirror of `main` (and the branches question 1 allows) to `ordago-app/business`, with a credential that does not expire in an hour (question 3). GitHub's `main` gets a rule that only the mirror pushes, so nobody writes the copy by mistake.
- **E. The hook for people and for Órdago's perimeter.** A `person` case per member allowed to push (what they may touch: question 2), branches allowed for people if question 1 keeps cloud sessions' branches, and the perimeter rules of `.githooks/pre-commit` moved into the server's hook so they hold whoever pushes.

### The cut (one sitting, a few minutes of freeze)

1. Pause Órdago's timetable fires and refuse new runs for the organisation (a flag the tick and `/runs` read), and wait for the running ones to report.
2. Protect `main` on GitHub so nobody pushes; tell Álvaro and Jaime.
3. As Forgejo's admin: create `records/<org id>`, `git push --mirror` from a fresh clone of GitHub (all of `main`'s history; the `claude/*` branches only if question 1 keeps them), create an `agent-<id>` user per agent, write the hook and the branch protection (`recordProvision.ts` does all but the history).
4. Update the row: `record_host = 'ghostaff'`, `record_repo = 'records/<org id>'`, `record_installation = null`, the GitHub installation kept in its own column (A).
5. Run a tick by hand and compare: the same `decisions`, `agents.task` and `externos` rows as before the cut, nothing written back.
6. Switch the push mirror on and check one commit reaches GitHub.
7. Lift the pause; check one run of a light agent (Legal) clones, pushes and reports. Turn on Órdago's memory tools (business-brain.md, «Only on our record store»).
8. People re-point their clones (`git remote set-url origin …`) to the door from question 1.

**Going back** is the same row set back to GitHub and `main` unprotected there. While the mirror runs, GitHub holds every commit, so this costs nothing until the mirror is turned off.

## Open questions

1. **Where do people write after the flip?** (a) A public, authenticated door to Forgejo (HTTPS behind Identity-Aware Proxy or Forgejo's own login, a Forgejo user per member, tokens for Claude Code), with cloud Claude sessions pushing their branches there too: one master, more to build and to secure. (b) People keep working on GitHub and a sync carries their commits into Forgejo: no door to build, but two places accept writes, which is the second master the flip exists to remove. (c) People write the record only through Ghostaff (the app, the chat, Secretaría): what a non-technical customer will do, but Álvaro writes about 37 % of the commits by hand today. My pick is (a): the record-store plan already names the door as its own card, and any customer who wants to clone their record needs it.
2. **What may a person push?** Everything (they own the record) or everything but `externos/` and the agents' `AGENTS.md`, which the app already edits with a commit in their name. Everything is simpler and matches today; the hook then guards agents only.
3. **The mirror's credential.** The GitHub App's installation tokens last an hour and Forgejo's push mirror keeps one fixed credential. A deploy key with write on `business` only (my pick: it reaches one repo, and nothing else uses it), or a fine-grained token renewed by the tick.
4. **The perimeter check:** move `.githooks/pre-commit` into the server's hook for this organisation (it then holds for every pusher), or leave it client-side as today.
5. **Beta or production?** Órdago's real agents run on the beta today, and item 8 of ordago-agents-in-ghostaff.md makes Órdago again in production with the first release, where the record store does not exist yet. Flipping on the beta now and again in production is two cuts; flipping only in production means Órdago moves to production and to Forgejo in the same release. Which comes first decides whether the cut above runs once or twice.

## Out of scope

- The flip for other organisations: they were born in our record store.
- A live copy to Drive.
- Retiring `ghostaff-ai/agents` and the old Telegram bot: ordago-agents-in-ghostaff.md («Telegram off»).
