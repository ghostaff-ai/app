import { forgetDevice } from '@ghostaff/shared/services';
import type { Session } from '@supabase/supabase-js';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { googleClientIds } from '../env';
import { deviceToken } from '../push/pushClient';
import { supabase } from '../supabase';
import { SignInCancelled } from './errors';
import { makeNonce } from './nonce';

// The auth boundary: the only file that calls `supabase.auth`. Three ways in,
// all landing on the same account when the email is the same (Supabase links
// identities by verified email):
//
// - Google: the phone's own account sheet in a real build; Google's button and
//   One Tap on the web (components/auth/GoogleButton.web.tsx hands us the
//   token); a browser window in Expo Go, which carries no native module.
// - Apple, on iPhone: the system sheet.
// - A 6-digit code by email, the same everywhere.
//
// The first sign-in also creates the account: anyone can sign up, and what
// they see is decided by the organisations they create or are invited to.

interface AuthValue {
  session: Session | null;
  /** True until the stored session has been read. */
  loading: boolean;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  /** Google on a phone: the native sheet, or a browser window in Expo Go. */
  signInWithGoogle: () => Promise<void>;
  /** Google on the web: the ID token its button hands back, with the raw nonce it was given hashed. */
  signInWithGoogleIdToken: (idToken: string, rawNonce: string) => Promise<void>;
  /** iPhone only. */
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      loading,
      async sendCode(email) {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: { shouldCreateUser: true },
        });
        if (error) throw error;
      },
      async verifyCode(email, code) {
        const { error } = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token: code.trim(),
          type: 'email',
        });
        if (error) throw error;
      },
      signInWithGoogle: () => (isExpoGo ? googleInBrowser() : googleNative()),
      async signInWithGoogleIdToken(idToken, rawNonce) {
        const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce: rawNonce });
        if (error) throw error;
      },
      signInWithApple: apple,
      async signOut() {
        // This phone stops getting the person's pushes, asked while the session
        // still says whose it is. Failing (offline) never keeps anyone signed in.
        const device = await deviceToken();
        if (device) await forgetDevice(supabase, device.token).catch(() => undefined);
        if (!isExpoGo && Platform.OS !== 'web') {
          // Forget the Google account too, so the next sign-in offers the choice again.
          await nativeGoogle()
            .GoogleSignin.signOut()
            .catch(() => undefined);
        }
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Loaded on first use, never at import: the module looks its native half up
// when it loads and throws where there is none (Expo Go, the web, tests).
function nativeGoogle(): typeof import('@react-native-google-signin/google-signin') {
  const mod = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
  mod.GoogleSignin.configure({ webClientId: googleClientIds.webClientId, iosClientId: googleClientIds.iosClientId || undefined });
  return mod;
}

// The free Google Sign-In SDK cannot be given a nonce, so the ID token is
// checked against our client ids only (skip_nonce_check in Supabase's Google
// provider). The web passes one.
async function googleNative() {
  const { GoogleSignin, isCancelledResponse, isErrorWithCode, statusCodes } = nativeGoogle();
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (isCancelledResponse(res)) throw new SignInCancelled();
    const token = res.data.idToken;
    if (!token) throw new Error('Google no ha devuelto la identificación. Prueba otra vez.');
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token });
    if (error) throw error;
  } catch (e) {
    if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) {
      throw new SignInCancelled();
    }
    throw e;
  }
}

// Expo Go: Supabase's own OAuth page in an in-app browser, back to the app
// with a one-time code (PKCE) that becomes the session.
async function googleInBrowser() {
  const WebBrowser = await import('expo-web-browser');
  const redirectTo = Linking.createURL('entrar');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success') throw new SignInCancelled();
  const params = Linking.parse(res.url).queryParams ?? {};
  const code = typeof params.code === 'string' ? params.code : null;
  if (!code) throw new Error(typeof params.error_description === 'string' ? params.error_description : 'No se ha podido entrar con Google.');
  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  if (exchanged.error) throw exchanged.error;
}

async function apple() {
  const AppleAuthentication = await import('expo-apple-authentication');
  const nonce = await makeNonce();
  let credential: Awaited<ReturnType<typeof AppleAuthentication.signInAsync>>;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: nonce.hashed,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new SignInCancelled();
    throw e;
  }
  if (!credential.identityToken) throw new Error('Apple no ha devuelto la identificación. Prueba otra vez.');
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: nonce.raw });
  if (error) throw error;
  // Apple gives the name only the first time, and never inside the token: keep
  // it so the welcome screen can offer it.
  const fullName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
  if (fullName) await supabase.auth.updateUser({ data: { full_name: fullName } });
}
