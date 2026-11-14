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
`apps/sync/.env.example` to `apps/sync/.env` with the URL and the **service-role** key; the same
for `apps/engine/.env` (its vault stays in memory locally). No `.env` is committed. With the engine
running (`pnpm engine:dev`, port 8787), set `ENGINE_URL_DEV=http://localhost:8787` in `apps/mobile/.env`
to try Conexiones.

Give yourself a login in Órdago (organisation zero, created by the seed) and load its decisions:

```bash
pnpm --filter @ghostaff/sync org add-member --org ordago --email you@example.com --name Álvaro --role owner
pnpm sync:por-decidir --org ordago --record ~/githubs/ordago-app/business
```

Then `pnpm app:web` (or `pnpm app:start` for a phone). The sign-in code arrives in the local
mail catcher that `pnpm db:start` prints (Mailpit, port 54324).

Metro starts on 8083, or on 8093, 8103 … 8173 when another copy already holds it
(`scripts/metro-port.sh`; `METRO_PORT` overrides it). Every script that starts Metro goes
through it: a bare `expo start` takes 8081, another app's port on the same machine.

### The hosted beta project

`ghostaff-beta` (Frankfurt). Its keys live encrypted in `secrets/secrets.enc.yml` (listed in
`secrets/inventory.yml`), stored and fetched with the workspace's `secret` command:

```bash
secret set ghostaff-ai/app SUPABASE_ANON_KEY_BETA          # once, pasted at a hidden prompt
secret set ghostaff-ai/app SUPABASE_SERVICE_ROLE_KEY_BETA
secret env ghostaff-ai/app                                 # writes both .env files
```

Both apps read the project's URL from the key. `APP_ENV=beta pnpm app:web` runs the app
against it; `pnpm sync:por-decidir` uses it whenever `apps/sync/.env` has no `SUPABASE_URL`.

On a phone, from anywhere on the tailnet, with Expo Go:

```bash
APP_ENV=beta tailnet-dev pnpm app:start --go
```

Then scan the QR code in Expo Go, or type `exp://<the printed address>:<port>`. The stores' Expo Go
lags behind SDK 56 (it says the project is incompatible); install the SDK 56 one from
[expo.dev/go](https://expo.dev/go) instead. It replaces the old one, so an SDK 54 app (ordago-apps)
then needs its own dev build.

An answer given in the app is written into the record's file by the next
`pnpm sync:por-decidir … --write-back`, which edits the checkout and leaves the commit to you.
