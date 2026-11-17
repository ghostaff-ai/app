import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { googleClientIds } from '@/lib/env';
import { useAuth } from '@/lib/auth/AuthContext';
import { makeNonce } from '@/lib/auth/nonce';

// Google on the web: Google's own button plus One Tap (the "Continuar como …"
// card), both from Google Identity Services and both through the browser's
// FedCM where it has it. Google hands back an ID token that never leaves this
// page except to Supabase, so its sign-in screen never shows supabase.co.

const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface CredentialResponse {
  credential: string;
}
interface Gis {
  initialize(cfg: Record<string, unknown>): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
  prompt(): void;
  cancel(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: Gis } };
  }
}

let loading: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  loading ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google no ha cargado')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Google no ha cargado'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export function GoogleButton({ onSignIn }: { onSignIn: (fn: () => Promise<void>) => void; disabled?: boolean }) {
  const { signInWithGoogleIdToken } = useAuth();
  // On the web a View is a div, which is where Google draws its button.
  const host = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  // The latest handlers, read by Google's callback without re-initialising it.
  const latest = useRef({ onSignIn, signInWithGoogleIdToken });
  latest.current = { onSignIn, signInWithGoogleIdToken };

  useEffect(() => {
    const el = host.current;
    if (!el || !width || !googleClientIds.webClientId) return;
    let gone = false;
    let gis: Gis | null = null;
    (async () => {
      const [g, nonce] = await Promise.all([loadGis(), makeNonce()]);
      if (gone) return;
      gis = g;
      g.initialize({
        client_id: googleClientIds.webClientId,
        nonce: nonce.hashed,
        use_fedcm_for_prompt: true,
        use_fedcm_for_button: true,
        itp_support: true,
        cancel_on_tap_outside: false,
        callback: ({ credential }: CredentialResponse) =>
          latest.current.onSignIn(() => latest.current.signInWithGoogleIdToken(credential, nonce.raw)),
      });
      g.renderButton(el, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        logo_alignment: 'center',
        locale: 'es',
        width: Math.min(400, Math.round(width)),
      });
      g.prompt();
    })().catch(() => undefined);
    return () => {
      gone = true;
      gis?.cancel();
    };
  }, [width]);

  if (!googleClientIds.webClientId) return null;
  return (
    <View
      ref={host as never}
      accessibilityLabel="Continuar con Google"
      className="min-h-11 items-center"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    />
  );
}
