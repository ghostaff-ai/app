# Native Firebase config (Android push)

`expo-notifications` gets an Android phone's FCM token from the native
`google-services.json`. One file per environment, named after `APP_ENV`:

| Env | File | Firebase project | Package |
|---|---|---|---|
| dev | `dev.json` | `ghostaff-beta` | `ai.ghostaff.app.dev` |
| beta | `beta.json` | `ghostaff-beta` | `ai.ghostaff.app.beta` |
| prod | `prod.json` | `ghostaff-prod` | `ai.ghostaff.app` |

An FCM token only takes pushes from the project it was made in, and the
engine sends through its own Google Cloud project (`FIREBASE_PROJECT` in
`scripts/env.sh`), so each package lives in the project of the engine that
serves it ([decision-notifications.md](../../../docs/plans/ongoing/decision-notifications.md),
part 6). A founder adds the Android app to that Firebase project once, then:

```bash
firebase apps:list ANDROID --project <project>
firebase apps:sdkconfig ANDROID <appId> --project <project> --out apps/mobile/google-services/<env>.json
```

The files hold no secret: the API key inside ships in every APK and is
restricted to the package and its signing certificate. So they are committed.
`app.config.ts` wires `android.googleServicesFile` only when the env's file
exists, so a checkout without one still builds; that build simply never gets a
token, and gets no pushes.

iOS needs nothing here: its tokens are raw APNs tokens, and the engine sends to
APNs directly.
