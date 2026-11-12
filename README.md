# Ghostaff app

A team of AI agents for small companies: the app (iPhone, Android, web) and its backend.

Private. Start with [AGENTS.md](AGENTS.md).

## Setup

Tools come from `mise.toml` (Node 22, pnpm 10) and Docker runs the local database.

```bash
mise install
pnpm install
pnpm check                     # typecheck + unit tests
```

### Local database

```bash
pnpm db:start                  # the whole local Supabase; prints the URL and both keys
pnpm db:test                   # row-level-security tests
```

Copy `apps/mobile/.env.example` to `apps/mobile/.env` with the URL and the **anon** key, and
`apps/sync/.env.example` to `apps/sync/.env` with the URL and the **service-role** key.
Neither `.env` is committed.

Give yourself a login in Órdago (organisation zero, created by the seed) and load its decisions:

```bash
pnpm --filter @ghostaff/sync org add-member --org ordago --email you@example.com --name Álvaro --role owner
pnpm sync:por-decidir --org ordago --record ~/githubs/ordago-app/business
```

Then `pnpm app:web` (or `pnpm app:start` for a phone). The sign-in code arrives in the local
mail catcher that `pnpm db:start` prints (Mailpit, port 54324).

An answer given in the app is written into the record's file by the next
`pnpm sync:por-decidir … --write-back`, which edits the checkout and leaves the commit to you.
