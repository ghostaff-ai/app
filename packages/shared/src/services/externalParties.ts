// Who the organisation works with outside (docs/plans/ongoing/external-parties.md):
// the one service the Empresa screens and the agents' tools both call (rule 6).
// Reads go through row-level security; writes through the two `security definer`
// functions, which only an owner passes. The record's `externos/` is the master:
// a change lands in the database first and the engine's sync writes it there.

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEPARTMENTS, type Department, EXTERNAL_KINDS, type ExternalKind, type ExternalParty, type ExternalPartyInput } from '../models';
import { normalizeLink } from './links';

/** The database's own limits (20261126800000_external_parties.sql), so a person hears them before saving. */
export const EXTERNAL_LIMITS = { name: 120, role: 300, email: 200, phone: 40, website: 300 } as const;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const WEBSITE = /^https?:\/\/\S+$/;

export interface ExternalPartyRow {
  id: string;
  org_id: string;
  kind: ExternalKind;
  name: string;
  role: string;
  departments: string[];
  email: string | null;
  phone: string | null;
  website: string | null;
  added_by_name: string;
  added_at: string;
  proposed_by_name: string | null;
  pending: 'save' | 'remove' | null;
}

const COLUMNS = 'id, org_id, kind, name, role, departments, email, phone, website, added_by_name, added_at, proposed_by_name, pending';

export function externalPartyFromRow(r: ExternalPartyRow): ExternalParty {
  return {
    id: r.id,
    orgId: r.org_id,
    kind: r.kind,
    name: r.name,
    role: r.role,
    departments: r.departments.filter((d): d is Department => (DEPARTMENTS as readonly string[]).includes(d)),
    email: r.email,
    phone: r.phone,
    website: r.website,
    addedByName: r.added_by_name,
    addedAt: r.added_at,
    proposedByName: r.proposed_by_name,
    pending: r.pending !== null,
  };
}

/** The input as it will be saved: trimmed, the website with its scheme, empty optional fields as null. */
export function cleanExternalParty(input: ExternalPartyInput): ExternalPartyInput {
  const opt = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
  return {
    kind: input.kind,
    name: input.name.trim(),
    role: input.role.trim(),
    departments: [...new Set(input.departments)],
    email: opt(input.email),
    phone: opt(input.phone),
    website: input.website?.trim() ? normalizeLink(input.website) : null,
  };
}

/** What is wrong with it, in Spanish, for the screen and the agent alike; null when it can be saved. */
export function invalidExternalParty(input: ExternalPartyInput): string | null {
  const p = cleanExternalParty(input);
  if (!(EXTERNAL_KINDS as readonly string[]).includes(p.kind)) return 'Elige si es una persona, una empresa o un servicio.';
  if (!p.name || p.name.length > EXTERNAL_LIMITS.name) return `El nombre tiene que tener entre 1 y ${EXTERNAL_LIMITS.name} caracteres.`;
  if (!p.role || p.role.length > EXTERNAL_LIMITS.role) return `Di qué hace para vosotros, en ${EXTERNAL_LIMITS.role} caracteres como mucho.`;
  if (p.departments.some((d) => !(DEPARTMENTS as readonly string[]).includes(d))) return 'Alguno de los departamentos no existe.';
  if (p.email && (!EMAIL.test(p.email) || p.email.length > EXTERNAL_LIMITS.email)) return 'Ese correo no parece válido.';
  if (p.phone && (p.phone.length < 3 || p.phone.length > EXTERNAL_LIMITS.phone)) return 'Ese teléfono no parece válido.';
  if (p.website && (!WEBSITE.test(p.website) || p.website.length > EXTERNAL_LIMITS.website)) return 'Esa web no parece válida.';
  return null;
}

/** The organisation's list, by name; a party being removed is already gone. */
export async function listExternalParties(client: SupabaseClient, orgId: string): Promise<ExternalParty[]> {
  const { data, error } = await client.from('external_parties').select(COLUMNS).eq('org_id', orgId).order('name').returns<ExternalPartyRow[]>();
  if (error) throw error;
  return (data ?? []).map(externalPartyFromRow);
}

export async function getExternalParty(client: SupabaseClient, id: string): Promise<ExternalParty | null> {
  const { data, error } = await client.from('external_parties').select(COLUMNS).eq('id', id).maybeSingle<ExternalPartyRow>();
  if (error) throw error;
  return data ? externalPartyFromRow(data) : null;
}

/**
 * Adds one (`id` null) or changes one, as an owner. `proposedBy` is the agent whose
 * proposal the owner approved. Returns its id.
 */
export async function saveExternalParty(
  client: SupabaseClient,
  orgId: string,
  id: string | null,
  input: ExternalPartyInput,
  proposedBy: string | null = null,
): Promise<string> {
  const p = cleanExternalParty(input);
  const { data, error } = await client.rpc('save_external_party', {
    target_org: orgId,
    party: id,
    new_kind: p.kind,
    new_name: p.name,
    new_role: p.role,
    new_departments: p.departments,
    new_email: p.email,
    new_phone: p.phone,
    new_website: p.website,
    proposed_by: proposedBy,
  });
  if (error) throw error;
  return data as string;
}

/** As an owner: gone from the list at once, and from the record on the next sync. */
export async function removeExternalParty(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.rpc('remove_external_party', { party: id });
  if (error) throw error;
}
