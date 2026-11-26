/// <reference types="node" />
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExpoConfig } from 'expo/config';

// One app, three environments, as in cultuvilla/app: `APP_ENV` picks the
// Supabase project, the bundle id and the home-screen name. eas.json sets it
// per build profile; a local `expo start` is `dev`.

type Env = 'dev' | 'beta' | 'prod';

function resolveEnv(): Env {
  const raw = process.env.APP_ENV;
  if (raw === 'dev' || raw === 'beta' || raw === 'prod') return raw;
  return 'dev';
}

const env = resolveEnv();

// Non-prod builds are one short word so a launcher never truncates them and
// they read clearly next to the store app.
const namePerEnv: Record<Env, string> = { dev: 'Dev', beta: 'Beta', prod: 'Ghostaff' };

// A separate id per env is a separate install: a beta sits next to the store
// app instead of replacing it. The domain is ghostaff.ai, reversed.
const bundleIdPerEnv: Record<Env, string> = {
  dev: 'ai.ghostaff.app.dev',
  beta: 'ai.ghostaff.app.beta',
  prod: 'ai.ghostaff.app',
};

// The Supabase URL and anon key are public by design: they ship inside every
// app and row-level security is what keeps organisations apart. They still come
// from the environment (apps/mobile/.env locally, EAS environment variables in
// builds) so one config serves every env. The service-role key never comes here.
// A hosted project's anon key is a JWT carrying the project's ref, so the URL
// follows from the key and only local dev (whose key has no ref) sets it.
const suffix = env.toUpperCase();
const supabaseAnonKey = process.env[`SUPABASE_ANON_KEY_${suffix}`] ?? '';
const supabaseUrl = process.env[`SUPABASE_URL_${suffix}`] || projectUrlFromKey(supabaseAnonKey) || '';

// The engine (apps/engine) takes an organisation's keys to the vault. Its URL is
// public too; what guards it is the person's sign-in token, so it is pinned
// here, the same as ENGINE_URL in scripts/env.sh: beta's engine runs in Google
// Cloud project ghostaff-beta, production's in ghostaff-prod, each against its
// own Supabase (docs/plans/ongoing/environments.md). Local dev sets ENGINE_URL_DEV.
const engineUrlPerEnv: Record<Env, string> = {
  dev: '',
  beta: 'https://engine-1002624835789.europe-west1.run.app',
  prod: 'https://engine-664656500315.europe-west1.run.app',
};
const engineUrl = process.env[`ENGINE_URL_${suffix}`] || engineUrlPerEnv[env];

// Where the web build is served from, when not at the root of its domain.
const webBaseUrl = process.env.WEB_BASE_URL || '';

// Google sign-in's OAuth clients, all in Google Cloud project ghostaff-prod
// (ghostaff.ai@gmail.com), APIs & Services, Clients. Public by design: they ship
// inside every app and say only which app is asking. One web client serves every
// env (the web's button and Supabase's check of the token); each iPhone bundle id
// has its own iOS client, and each Android package its own Android client (no id
// here: Google matches it by package and signing certificate). The iOS URL scheme
// is the iOS client id reversed.
const googleWebClientId = '664656500315-o45bt01ao6pb1s7oehv4n77c3k1uu76p.apps.googleusercontent.com';
const googleIosClientIdPerEnv: Record<Env, string> = {
  dev: '664656500315-a9gv4p3v4kq1r5oasv6eldvfmdbdlg94.apps.googleusercontent.com',
  beta: '664656500315-h8oqbdihq2rophdsvo51r7c9biqal2qe.apps.googleusercontent.com',
  prod: '664656500315-55k96qirco28jb9q0c4isaek7c05pqtv.apps.googleusercontent.com',
};
const googleIosClientId = googleIosClientIdPerEnv[env];
const googleIosUrlScheme = googleIosClientId
  ? `com.googleusercontent.apps.${googleIosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}`
  : '';

// Android push: expo-notifications gets the phone's FCM token from the native
// Firebase config, one file per env (google-services/README.md says which
// Firebase project each comes from). It holds no secret, so it is committed.
// Wired only when present, so a checkout without it still builds, minus push.
// Resolved against this file: the config is read from the repo root too.
const googleServicesFile = `./google-services/${env}.json`;
const hasGoogleServicesFile = existsSync(resolve(__dirname, googleServicesFile));

function projectUrlFromKey(key: string): string | null {
  try {
    const payload = (key.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload)) as { ref?: unknown };
    return typeof claims.ref === 'string' && /^[a-z0-9]{20}$/.test(claims.ref) ? `https://${claims.ref}.supabase.co` : null;
  } catch {
    return null;
  }
}

const config: ExpoConfig = {
  name: namePerEnv[env],
  slug: 'ghostaff',
  // Pinned, not read from the environment: a stray env var on a machine that
  // also checks out cultuvilla/app or ordago-apps would build one repo into
  // another's EAS project. Account ghostaff.ai (ghostaff.ai@gmail.com).
  owner: 'ghostaff.ai',
  version: '0.1.0',
  // Over-the-air updates (EAS Update): a beta build listens on channel `beta`
  // (eas.json) and takes each push to develop on its next launch
  // (.github/workflows/beta.yml). Checked on launch without holding the splash.
  updates: {
    url: 'https://u.expo.dev/8a688732-55c1-4ef0-9a23-0fbb3f401911',
    fallbackToCacheTimeout: 0,
  },
  // The fingerprint of the native side (fingerprint.config.js): an update
  // reaches only builds that can run it, and a native change needs a new build.
  runtimeVersion: { policy: 'fingerprint' },
  // One icon for every env (Álvaro, 2026-11-17): the name under it tells them
  // apart. Rendered from the ghost's model by assets/icon/render.py.
  icon: './assets/icon/icon.png',
  orientation: 'portrait',
  scheme: 'ghostaff',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: bundleIdPerEnv[env],
    supportsTablet: true,
    // EAS turns Sign in with Apple on for the App ID at the next build.
    usesAppleSignIn: true,
    infoPlist: {
      // Only standard HTTPS/TLS: saves the export-compliance question on every build.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: bundleIdPerEnv[env],
    ...(hasGoogleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: {
      foregroundImage: './assets/icon/adaptive-foreground.png',
      backgroundColor: '#0b0b0f',
    },
  },
  web: {
    bundler: 'metro',
    output: 'single',
    lang: 'es',
    // At ghostaff.ai the tab reads the product's name, not the environment's.
    ...(webBaseUrl ? { name: 'Ghostaff' } : {}),
    favicon: './assets/icon/favicon.png',
  },
  plugins: [
    // Release builds shrink the Java/Kotlin code with R8 (on by default since SDK
    // 58), and R8 drops or renames what is only reached by reflection or JNI.
    // expo-gl ships no keep rules, so the 3D ghost on Hoy crashed every Android
    // release launch once an organisation existed (2026-11-17): first GLView's
    // constructor (Expo builds each module's view from its (Context, AppContext)
    // constructor), then the methods its C++ calls back by name. Kept: all of
    // expo-gl, and that constructor on every module's view.
    [
      'expo-build-properties',
      {
        android: {
          // A dev build talks to the local Supabase over plain http (the e2e
          // build: scripts/e2e/android.sh); beta and prod only ever speak https.
          usesCleartextTraffic: env === 'dev',
          extraProguardRules: [
            '-keep class expo.modules.gl.** { *; }',
            '-keepclassmembers class * { <init>(android.content.Context, expo.modules.kotlin.AppContext); }',
          ].join('\n'),
        },
      },
    ],
    'expo-apple-authentication',
    // Pushes straight from our engine to APNs and FCM (no Expo push service).
    // A push that arrives before the app has made its channel lands in this one.
    ['expo-notifications', { defaultChannel: 'default' }],
    [
      'expo-audio',
      {
        microphonePermission: 'Ghostaff usa el micrófono para que puedas dictar tus mensajes.',
        // Recording only while the app is open: no UIBackgroundModes audio, no foreground-service permissions.
        enableBackgroundRecording: false,
        enableBackgroundPlayback: false,
      },
    ],
    [
      'expo-image-picker',
      {
        // A guide asks for a photo of the person's screen when they're lost (guided-access.md). Photos only, never video.
        cameraPermission: 'Ghostaff usa la cámara para que hagas una foto de tu pantalla cuando una guía te pida verla.',
        photosPermission: 'Ghostaff abre tus fotos para que elijas una captura de pantalla cuando una guía te pida verla.',
        microphonePermission: false,
      },
    ],
    ...(googleIosUrlScheme ? [['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }] as [string, object]] : []),
    'expo-router',
    'expo-splash-screen',
    'expo-status-bar',
  ],
  experiments: {
    typedRoutes: true,
    // The web build served at ghostaff.ai lives under /app, beside the website at /
    // (docs/plans/ongoing/desktop-web.md, step 3): `pnpm export:web:hosted` sets it.
    // Metro in development and the phones keep the root.
    ...(webBaseUrl ? { baseUrl: webBaseUrl } : {}),
  },
  extra: {
    APP_ENV: env,
    eas: { projectId: '8a688732-55c1-4ef0-9a23-0fbb3f401911' },
    supabaseUrl,
    supabaseAnonKey,
    engineUrl,
    google: { webClientId: googleWebClientId, iosClientId: googleIosClientId },
    // The end-to-end tests' build (scripts/e2e/android.sh sets E2E=1).
    e2e: process.env.E2E === '1',
  },
};

export default config;
