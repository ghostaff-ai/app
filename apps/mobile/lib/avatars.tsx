import { avatarUrl, memberAvatars } from '@ghostaff/shared/services';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

// Profile photos (Jaime, 2026-11-26): the photos of the active organisation's
// members, by person, for every face the app draws (a message's avatar,
// Personas). Links are signed for an hour and kept 50 minutes.

interface Avatars {
  pathOf: (userId: string | null | undefined) => string | null;
  reload: () => void;
}

const AvatarsContext = createContext<Avatars>({ pathOf: () => null, reload: () => {} });

export function AvatarsProvider({ orgId, children }: { orgId: string | null; children: ReactNode }) {
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    void memberAvatars(supabase, orgId)
      .then((p) => alive && setPaths(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [orgId, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const value = useMemo<Avatars>(() => ({ pathOf: (id) => (id ? paths[id] ?? null : null), reload }), [paths, reload]);
  return <AvatarsContext.Provider value={value}>{children}</AvatarsContext.Provider>;
}

export const useAvatars = () => useContext(AvatarsContext);

const links = new Map<string, { url: string; at: number }>();
const KEEP_MS = 50 * 60_000;

/** A photo's link, once known; null while it loads or when there is none. */
export function usePhotoUrl(path: string | null | undefined): string | null {
  const cached = path ? links.get(path) : undefined;
  const [url, setUrl] = useState<string | null>(cached && Date.now() - cached.at < KEEP_MS ? cached.url : null);
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    const hit = links.get(path);
    if (hit && Date.now() - hit.at < KEEP_MS) {
      setUrl(hit.url);
      return;
    }
    let alive = true;
    void avatarUrl(supabase, path)
      .then((u) => {
        links.set(path, { url: u, at: Date.now() });
        if (alive) setUrl(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}
