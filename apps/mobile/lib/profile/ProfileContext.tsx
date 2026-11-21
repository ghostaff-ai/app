import type { Profile } from '@ghostaff/shared';
import { getMyProfile, saveProfile } from '@ghostaff/shared/services';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../supabase';

// Who the signed-in person says they are. Null until they fill the welcome
// screen; the app asks for nothing else before it.

interface ProfileValue {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  save: (p: Profile) => Promise<void>;
  reload: () => void;
}

const ProfileContext = createContext<ProfileValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Loading is "signed in, and not settled for this person yet", worked out at
  // render time: a flag set by the effect would leave one render, when the
  // session arrives, with a person and no profile, which sends the layout to
  // Bienvenida and loses the link that was opened (ActiveOrgContext, the same).
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const loading = userId !== null && settledFor !== userId;

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setSettledFor(null);
      return;
    }
    let alive = true;
    getMyProfile(supabase, userId)
      .then((p) => {
        if (!alive) return;
        setProfile(p);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setSettledFor(userId));
    return () => {
      alive = false;
    };
  }, [userId, tick]);

  const save = useCallback(async (p: Profile) => {
    setProfile(await saveProfile(supabase, p));
  }, []);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const value = useMemo(() => ({ profile, loading, error, save, reload }), [profile, loading, error, save, reload]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileValue {
  const v = useContext(ProfileContext);
  if (!v) throw new Error('useProfile outside ProfileProvider');
  return v;
}
