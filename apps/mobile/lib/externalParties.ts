import { DEPARTMENT_NAMES, type ExternalKind, type ExternalParty } from '@ghostaff/shared';
import { AppWindow, Buildings, type IconComponent, User } from '@/components/icons';

// How «Con quién trabajáis» draws a party (external-parties.md), shared by the list and the form.

export const KIND_ICONS: Record<ExternalKind, IconComponent> = { person: User, company: Buildings, service: AppWindow };

/** The line under a party's name: what it does, and the departments it works with. */
export function partyLine(p: ExternalParty): string {
  const deps = p.departments.map((d) => DEPARTMENT_NAMES[d]).join(', ');
  return deps ? `${p.role} · ${deps}` : p.role;
}

/** A refusal from the database, in words a person reads under the form. */
export function externalRefusal(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === '42501') return 'Solo quien es propietario de la empresa puede cambiar esta lista.';
  if (code === '23514' || code === '22023') return 'Revisa los datos: algo no es válido.';
  return 'No se ha guardado. Vuelve a intentarlo en un momento.';
}
