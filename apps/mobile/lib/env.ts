import Constants from 'expo-constants';

export type AppEnv = 'dev' | 'beta' | 'prod';

interface Extra {
  APP_ENV?: AppEnv;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  engineUrl?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const appEnv: AppEnv = extra.APP_ENV ?? 'dev';
export const supabaseUrl = extra.supabaseUrl ?? '';
export const supabaseAnonKey = extra.supabaseAnonKey ?? '';
export const engineUrl = extra.engineUrl ?? '';
