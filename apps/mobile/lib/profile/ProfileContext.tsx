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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    getMyProfile(supabase, userId)
      .then((p) => {
        if (!alive) return;
        setProfile(p);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
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
