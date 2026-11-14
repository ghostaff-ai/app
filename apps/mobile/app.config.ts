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
// public too; what guards it is the person's sign-in token.
const engineUrl = process.env[`ENGINE_URL_${suffix}`] ?? '';

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
  orientation: 'portrait',
  scheme: 'ghostaff',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: bundleIdPerEnv[env],
    supportsTablet: true,
    infoPlist: {
      // Only standard HTTPS/TLS: saves the export-compliance question on every build.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: bundleIdPerEnv[env],
  },
  web: {
    bundler: 'metro',
    output: 'single',
  },
  plugins: ['expo-router'],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    APP_ENV: env,
    eas: { projectId: '8a688732-55c1-4ef0-9a23-0fbb3f401911' },
    supabaseUrl,
    supabaseAnonKey,
    engineUrl,
  },
};

export default config;
