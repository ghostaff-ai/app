import Constants from 'expo-constants';

export type AppEnv = 'dev' | 'beta' | 'prod';

interface Extra {
  APP_ENV?: AppEnv;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  engineUrl?: string;
  google?: GoogleClientIds;
}

/** Google sign-in's OAuth client ids for this env (public; see app.config.ts). */
export interface GoogleClientIds {
  webClientId: string;
  iosClientId: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const appEnv: AppEnv = extra.APP_ENV ?? 'dev';
export const supabaseUrl = extra.supabaseUrl ?? '';
export const supabaseAnonKey = extra.supabaseAnonKey ?? '';
export const engineUrl = extra.engineUrl ?? '';
export const googleClientIds: GoogleClientIds = extra.google ?? { webClientId: '', iosClientId: '' };
