import type { PushData } from '@ghostaff/shared';
import { registerDevice } from '@ghostaff/shared/services';
import { router, useRootNavigationState, type Href } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useActiveOrg } from '../org/ActiveOrgContext';
import { supabase } from '../supabase';
import { deviceToken, onTap, permission as readPermission, requestPermission, setForegroundFilter, type Permission } from './pushClient';

// Receiving pushes: registers this phone once the person is signed in and has
// allowed notifications, opens what a tapped push points at (in its
// organisation), and hides a reply for the chat already on screen. Asking is
// the chat's job (`ask`), never at launch (decision-notifications.md, part 2).

interface PushValue {
  /** The phone's permission; `unsupported` on the web. */
  permission: Permission;
  /** The phone's own dialog. Registers the device when the answer is yes. */
  ask: () => Promise<Permission>;
  /** The route of the chat on screen (`/chat/<agentId>`, `/conversacion/<threadId>`), or null on leaving it. */
  setOnScreen: (route: string | null) => void;
}

const PushContext = createContext<PushValue | null>(null);

export function PushProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const org = useActiveOrg();
  const navReady = !!useRootNavigationState()?.key;
  const [permission, setPermission] = useState<Permission>('undetermined');
  const [tap, setTap] = useState<PushData | null>(null);
  const onScreen = useRef<string | null>(null);
  // Whose device and which token went to the database last, so it's written
  // once per sign-in and token, not on every render that changes the session.
  const registered = useRef<string | null>(null);

  useEffect(() => {
    setForegroundFilter((d) => d.kind === 'reply' && d.route === onScreen.current);
    let alive = true;
    readPermission()
      .then((p) => alive && setPermission(p))
      .catch(() => {});
    const stop = onTap(setTap);
    return () => {
      alive = false;
      stop();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      registered.current = null;
      return;
    }
    if (permission !== 'granted') return;
    let alive = true;
    void (async () => {
      const device = await deviceToken();
      const key = device && `${userId}:${device.token}`;
      if (!alive || !device || registered.current === key) return;
      registered.current = key;
      try {
        await registerDevice(supabase, { ...device, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      } catch {
        // The next launch tries again; until then this phone just gets no pushes.
        if (registered.current === key) registered.current = null;
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId, permission]);

  // A tap, the one that started the app included, waits until there is a
  // screen to open it on: navigation mounted and the person inside an
  // organisation. Opened any earlier, the layout's own redirects would undo it.
  const { active, organizations, loading, choose } = org;
  useEffect(() => {
    if (!tap || !navReady || !userId || loading || !active) return;
    setTap(null);
    if (tap.orgId && tap.orgId !== active.id && organizations.some((o) => o.id === tap.orgId)) choose(tap.orgId);
    router.push(tap.route as Href);
  }, [tap, navReady, userId, loading, active, organizations, choose]);

  const ask = useCallback(async () => {
    const p = await requestPermission();
    setPermission(p);
    return p;
  }, []);

  const setOnScreen = useCallback((route: string | null) => {
    onScreen.current = route;
  }, []);

  const value = useMemo<PushValue>(() => ({ permission, ask, setOnScreen }), [permission, ask, setOnScreen]);
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePush(): PushValue {
  const v = useContext(PushContext);
  if (!v) throw new Error('usePush outside PushProvider');
  return v;
}
