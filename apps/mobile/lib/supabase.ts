import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { supabaseAnonKey, supabaseUrl } from './env';

// The app's one Supabase client, signed in as the person using it. Screens never
// import it: data goes through @ghostaff/shared/services, and sign-in through
// lib/auth/AuthContext.tsx, the only file that calls `supabase.auth`.

export const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(supabaseUrl || 'http://localhost', supabaseAnonKey || 'not-configured', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// On a phone, refresh the session only while the app is in front.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
