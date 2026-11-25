import type { PushData } from '@ghostaff/shared';
import { registerDevice } from '@ghostaff/shared/services';
import { router, type Href } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useActiveOrg } from '../org/ActiveOrgContext';
import { supabase } from '../supabase';
import { deviceToken, onTap, permission as readPermission, requestPermission, setForegroundFilter, type Device, type Permission } from './pushClient';
import { rememberRegisteredToken } from './registeredToken';

// Receiving pushes: registers this phone once the person is signed in and has
// allowed notifications, holds a tapped push until the (app) layout can open it
// (useOpenPushTap), and hides a reply for the chat already on screen. Asking is
// the chat's job (`ask`), never at launch (decision-notifications.md, part 2).

interface PushValue {
  /** The phone's permission; `unsupported` on the web. */
  permission: Permission;
  /** The phone's own dialog. Registers the device when the answer is yes. */
  ask: () => Promise<Permission>;
  /** The route of the chat on screen (`/chat/<agentId>`, `/conversacion/<threadId>`), or null on leaving it. */
  setOnScreen: (route: string | null) => void;
}

interface PendingTap {
  tap: PushData | null;
  clear: () => void;
}

const PushContext = createContext<PushValue | null>(null);
const PendingTapContext = createContext<PendingTap | null>(null);

/** The design's default (decision-notifications.md), for a phone that names no zone or one the database doesn't know. */
export const FALLBACK_TIME_ZONE = 'Europe/Madrid';

async function register(device: Device): Promise<void> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE;
  try {
    await registerDevice(supabase, { ...device, timeZone });
  } catch (e) {
    // 22023: register_device doesn't know the phone's zone.
    if ((e as { code?: unknown } | null)?.code !== '22023' || timeZone === FALLBACK_TIME_ZONE) throw e;
    await registerDevice(supabase, { ...device, timeZone: FALLBACK_TIME_ZONE });
  }
  await rememberRegisteredToken(device.token);
}

export function PushProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user.id ?? null;
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

  // Nobody signed in: a held tap belongs to whoever was, never to the next account.
  useEffect(() => {
    if (!authLoading && !userId) setTap(null);
  }, [authLoading, userId, tap]);

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
        await register(device);
      } catch {
        // The next launch tries again; until then this phone just gets no pushes.
        if (registered.current === key) registered.current = null;
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId, permission]);

  const ask = useCallback(async () => {
    const p = await requestPermission();
    setPermission(p);
    return p;
  }, []);

  const setOnScreen = useCallback((route: string | null) => {
    onScreen.current = route;
  }, []);

  const clear = useCallback(() => setTap(null), []);
  const value = useMemo<PushValue>(() => ({ permission, ask, setOnScreen }), [permission, ask, setOnScreen]);
  const pending = useMemo<PendingTap>(() => ({ tap, clear }), [tap, clear]);
  return (
    <PushContext.Provider value={value}>
      <PendingTapContext.Provider value={pending}>{children}</PendingTapContext.Provider>
    </PushContext.Provider>
  );
}

export function usePush(): PushValue {
  const v = useContext(PushContext);
  if (!v) throw new Error('usePush outside PushProvider');
  return v;
}

/**
 * Opens a tapped push, the one that started the app included, once `ready`:
 * called by the (app) layout with «past every step of the way in», so its
 * Stack is mounted and none of its guards will redirect the route away. Opens
 * it in the push's organisation when that is another of the person's.
 */
export function useOpenPushTap(ready: boolean): void {
  const pending = useContext(PendingTapContext);
  if (!pending) throw new Error('useOpenPushTap outside PushProvider');
  const { tap, clear } = pending;
  const { active, organizations, choose } = useActiveOrg();
  useEffect(() => {
    if (!tap || !ready || !active) return;
    clear();
    if (tap.orgId && tap.orgId !== active.id && organizations.some((o) => o.id === tap.orgId)) choose(tap.orgId);
    router.push(tap.route as Href);
  }, [tap, ready, active, organizations, choose, clear]);
}
