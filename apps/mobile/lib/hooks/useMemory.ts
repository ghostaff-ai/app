import { listMemories, type MemoryNote, readMemory } from '@ghostaff/shared/services';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

// The organisation's memory (business-brain.md): what Secretaría filed, read through the projection
// row-level security lets every member see.

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The memory's files, the latest changed first. */
export function useMemories(orgId: string | null) {
  const [notes, setNotes] = useState<Omit<MemoryNote, 'content'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!orgId) {
      setNotes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setNotes(await listMemories(supabase, orgId));
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [orgId]);
  useEffect(() => void reload(), [reload]);
  return { notes, loading, error, reload };
}

/** One file of the memory; `note` is null once loaded when it isn't there. */
export function useMemory(orgId: string | null, path: string | null) {
  const [note, setNote] = useState<MemoryNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!orgId || !path) {
      setNote(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setNote(await readMemory(supabase, orgId, path));
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [orgId, path]);
  useEffect(() => void reload(), [reload]);
  return { note, loading, error, reload };
}

/** «26 nov 2026», in Madrid: when a file last changed. */
export function memoryDay(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' }).format(new Date(iso));
}
