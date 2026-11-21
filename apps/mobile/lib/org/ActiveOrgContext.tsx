import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MyOrganization } from '@ghostaff/shared';
import { listMyOrganizations } from '@ghostaff/shared/services';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Whose list is on screen: loading is "signed in, and not settled for this
  // person yet", worked out at render time. A flag set by the effect would be
  // a render late: when the session arrives there is one render with a person
  // and no organisation yet, which flips the layout's guards to Empezar and
  // loses the link that was opened. A reload (after creating or joining an
  // organisation) keeps the old list on screen meanwhile: the layout swaps its
  // navigator for a spinner while loading, and swapping it out mid-navigation
  // loses the navigation (SDK 58 reports it as an error).
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const loading = userId !== null && settledFor !== userId;

  useEffect(() => {
    if (!userId) {
      setOrganizations([]);
      setActiveId(null);
      setSettledFor(null);
      return;
    }
    let alive = true;
    Promise.all([listMyOrganizations(supabase, userId), AsyncStorage.getItem(STORAGE_KEY)])
      .then(([orgs, stored]) => {
        if (!alive) return;
        setOrganizations(orgs);
        setActiveId(orgs.some((o) => o.id === stored) ? stored : (orgs[0]?.id ?? null));
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setSettledFor(userId));
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
