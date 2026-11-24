# End-to-end tests

Maestro drives the real app on an Android emulator, as in Órdago (`ordago-apps/.maestro/`).
The app is a release APK of the **dev** env with the JS inside, talking to the **local**
Supabase, so a run touches no hosted project and leaves nothing behind but test users.

```bash
pnpm db:start      # the local Supabase (and Mailpit, where the sign-in codes land)
pnpm e2e:avd       # create (once) and boot the ghostaff-e2e emulator, serial emulator-5560
pnpm e2e:build     # the APK (prebuild + Gradle, a few minutes; again after native or config changes)
pnpm e2e           # install it and run flows/ci/
```

Tools: Android SDK with the `android-36 google_apis x86_64` image, Java 21, Maestro
(`curl -fsSL https://get.maestro.mobile.dev | bash`). Every run is pinned to `emulator-5560`, so it
never touches another app's emulator or your phone.

## The flows

- `flows/ci/` runs anywhere, offline from real Google: the sign-in screen; a new person
  signing up with the emailed code (read from Mailpit) and getting through the welcome; and
  a new person creating a company, being asked to connect its AI (a stand-in key and a
  stand-in subscription are then written straight into the local database by
  `scripts/connect-ai.js`, with the local service-role key), landing on Hoy, filling a
  vacancy in Equipo, opening Registro and Conexiones, moving the key below the
  subscription there, opening «Añadir conexión», and coming back to the company after a cold relaunch;
  and an owner giving Secretaría a routine from the clock on her chat.

  CI runs them on every pull request and push (`.github/workflows/ci.yml`, job
  `End-to-end (Android)`), and the beta app only gets a push once they pass
  (`beta.yml`). A new main flow goes here, in the same commit as the screen it covers.
  Release builds only: R8 (code shrinking) can break what Metro never shows; the first
  catch was the 3D ghost on Hoy crashing every launch (2026-11-17).
- `flows/google/` signs in with Google for real. It needs, once:
  1. a Google account on the emulator: boot it with a window (`pnpm e2e:avd`), Settings,
     Passwords & accounts, Add account, Google, and sign in by hand;
  2. that account among the Google app's test users while it is in Testing
     (Google Cloud `ghostaff-prod`, Google Auth Platform, Audience);
  3. `GOOGLE_ACCOUNT=<that email> pnpm e2e:google`.

  The APK is signed with the prebuild's debug keystore, whose SHA-1 is registered as the
  Android OAuth client "Ghostaff Android dev (e2e debug keystore)" for `ai.ghostaff.app.dev`.

Apple sign-in has no emulator: it is checked by hand on an iPhone (TestFlight).
