import { listAgentMemories, listMemories, type MemoryNote, readAgentMemory, readMemory } from '@ghostaff/shared/services';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

// The memory's stores, read through the projection: the organisation's (business-brain.md), which
// every member sees, and each agent's own (agent-context.md PR 2), which whoever may see the agent
// sees. Row-level security decides; these only read.

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Which store: the organisation's, or one agent's own. */
export type MemorySource = { orgId: string } | { agentId: string };

/** What `load` gives for `key`, reloaded when the key changes; `empty` while there is no key. */
function useLoaded<T>(key: string | null, load: () => Promise<T>, empty: T) {
  const [value, setValue] = useState<T>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `load` and `empty` follow `key`: a new key is a new store or file, so `key` alone reloads.
  const reload = useCallback(async () => {
    if (!key) {
      setValue(empty);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setValue(await load());
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [key]);
  useEffect(() => void reload(), [reload]);
  return { value, loading, error, reload };
}

const keyOf = (source: MemorySource | null) => (!source ? null : 'orgId' in source ? `org:${source.orgId}` : `agent:${source.agentId}`);

/** A store's files, the latest changed first. */
export function useMemories(source: MemorySource | null) {
  const { value, ...rest } = useLoaded<Omit<MemoryNote, 'content'>[]>(
    keyOf(source),
    () => (source && 'orgId' in source ? listMemories(supabase, source.orgId) : listAgentMemories(supabase, (source as { agentId: string }).agentId)),
    [],
  );
  return { notes: value, ...rest };
}

/** One file of a store; `note` is null once loaded when it isn't there. */
export function useMemory(source: MemorySource | null, path: string | null) {
  const key = keyOf(source);
  const { value, ...rest } = useLoaded<MemoryNote | null>(
    key && path ? `${key}:${path}` : null,
    () => (source && 'orgId' in source ? readMemory(supabase, source.orgId, path!) : readAgentMemory(supabase, (source as { agentId: string }).agentId, path!)),
    null,
  );
  return { note: value, ...rest };
}

/** «26 nov 2026», in Madrid: when a file last changed. */
export function memoryDay(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' }).format(new Date(iso));
}
