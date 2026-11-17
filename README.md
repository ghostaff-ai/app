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

### Google and Apple sign-in

Google's OAuth clients are in Google Cloud project `ghostaff-prod` (ghostaff.ai@gmail.com),
Google Auth Platform, Clients: one web client for every env (Supabase checks tokens against it), one iOS
client per bundle id, one Android client per package and signing certificate. The ids are public and pinned
in `apps/mobile/app.config.ts`. The web client's secret is only for the browser flow Expo Go uses;
`secret env ghostaff-ai/app` writes it to `supabase/.env`, where `pnpm db:start` reads it.

- **Web:** Google's button works on `http://localhost:8083` … `8113` (the client's allowed origins).
- **Expo Go:** a browser window; it only works against the beta, since Google cannot return to a phone's
  local Supabase.
- **Apple:** iPhone only, in a real build (TestFlight); Expo Go on an iPhone works too.
- **Android phone without Play:** `eas build -p android --profile beta-apk` gives an APK of the beta to
  install straight from its link; it is signed with the same key the beta's Android OAuth client knows.
- While the Google app is in Testing, only its test users can use Google (Audience page).

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

Then scan the QR code in Expo Go, or type `exp://<the printed address>:<port>`. The app is on SDK 58,
the one the stores' Expo Go runs. When Expo Go moves past it, it says the project is incompatible:
upgrade the app (`npx expo install expo@<new> && npx expo install --fix` in `apps/mobile`) rather than
install an older Expo Go from [expo.dev/go](https://expo.dev/go); the app is young and upgrades are cheap now.

An answer given in the app is written into the record's file by the next
`pnpm sync:por-decidir … --write-back`, which edits the checkout and leaves the commit to you.
