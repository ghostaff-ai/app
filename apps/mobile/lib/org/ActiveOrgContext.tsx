import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MyOrganization } from '@ghostaff/shared';
import { listMyOrganizations } from '@ghostaff/shared/services';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../supabase';

// Which organisation the person is looking at. Remembered on the device, so
// the app reopens where they left it; falls back to the first one they belong to.

const STORAGE_KEY = 'ghostaff.activeOrgId';

interface ActiveOrgValue {
  organizations: MyOrganization[];
  active: MyOrganization | null;
  loading: boolean;
  error: string | null;
  choose: (orgId: string) => void;
  /** After creating or joining one: reload the list and open it. */
  enter: (orgId: string) => Promise<void>;
  reload: () => void;
}

const ActiveOrgContext = createContext<ActiveOrgValue | null>(null);

export function ActiveOrgProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [organizations, setOrganizations] = useState<MyOrganization[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // `loading` is only the first load for a person. A reload (after creating or
  // joining an organisation) keeps the old list on screen meanwhile: the app's
  // layout swaps its navigator for a spinner while loading, and swapping it out
  // mid-navigation loses the navigation (SDK 58 reports it as an error).
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      loadedFor.current = null;
      setOrganizations([]);
      setActiveId(null);
      setLoading(false);
      return;
    }
    let alive = true;
    if (loadedFor.current !== userId) setLoading(true);
    Promise.all([listMyOrganizations(supabase, userId), AsyncStorage.getItem(STORAGE_KEY)])
      .then(([orgs, stored]) => {
        if (!alive) return;
        setOrganizations(orgs);
        setActiveId(orgs.some((o) => o.id === stored) ? stored : (orgs[0]?.id ?? null));
        setError(null);
        loadedFor.current = userId;
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId, tick]);

  const choose = useCallback((orgId: string) => {
    setActiveId(orgId);
    AsyncStorage.setItem(STORAGE_KEY, orgId).catch(() => {});
  }, []);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Loads the new list before switching, so `active` is never briefly missing
  // (which would flip the layout's guards and send the person to Empezar).
  const enter = useCallback(
    async (orgId: string) => {
      if (!userId) return;
      const orgs = await listMyOrganizations(supabase, userId);
      await AsyncStorage.setItem(STORAGE_KEY, orgId).catch(() => {});
      setOrganizations(orgs);
      setActiveId(orgs.some((o) => o.id === orgId) ? orgId : (orgs[0]?.id ?? null));
    },
    [userId],
  );

  const value = useMemo<ActiveOrgValue>(
    () => ({
      organizations,
      active: organizations.find((o) => o.id === activeId) ?? null,
      loading,
      error,
      choose,
      enter,
      reload,
    }),
    [organizations, activeId, loading, error, choose, enter, reload],
  );

  return <ActiveOrgContext.Provider value={value}>{children}</ActiveOrgContext.Provider>;
}

export function useActiveOrg(): ActiveOrgValue {
  const v = useContext(ActiveOrgContext);
  if (!v) throw new Error('useActiveOrg outside ActiveOrgProvider');
  return v;
}
