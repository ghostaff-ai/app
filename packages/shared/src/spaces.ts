import type { OrganizationKind } from './models';

// What differs between a personal space and a company (Álvaro, 2026-11-23,
// welcome-and-spaces.md): only words and looks. Both work the same (agents,
// connections, decisions, invitations), so a screen reads its differences
// from here and never checks `kind` itself. The agent templates each kind
// offers join this map when templates exist (ideas/agent-templates.md).

export interface SpaceLook {
  /** The third tab, the space's own page. */
  tab: string;
  /** Its icon: the app maps it to the tab's system symbol and the sidebar's drawing. */
  icon: 'person' | 'building';
}

export const SPACE_LOOKS: Record<OrganizationKind, SpaceLook> = {
  personal: {
    tab: 'Perfil',
    icon: 'person',
  },
  company: {
    tab: 'Empresa',
    icon: 'building',
  },
};

/** The look of a space; a company's while none is open yet. */
export const spaceLook = (kind: OrganizationKind | null | undefined): SpaceLook => SPACE_LOOKS[kind ?? 'company'];
