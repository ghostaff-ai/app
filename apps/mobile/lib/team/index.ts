import { AGENT_JOBS, type AgentGhost, type Department } from '@ghostaff/shared';
import type { ImageSourcePropType } from 'react-native';

// The ghosts an organisation's agents are drawn as: the ones Álvaro designed
// (Tripo models, made in the design pipeline on branch spike/ghost-3d), each
// with the job and department it was drawn for (ghostaff-producto.md, «El
// equipo de partida»). An organisation's agents are rows in `agents`.

export type GhostId = AgentGhost;

export const GHOSTS: Record<GhostId, { label: string; job: string; department: Department; picture: ImageSourcePropType; model: number }> = {
  base: { department: 'direccion', ...AGENT_JOBS.base, picture: require('../../assets/ghosts/base.png'), model: require('../../assets/ghosts/base.glb') },
  secretaria: { department: 'direccion', ...AGENT_JOBS.secretaria, picture: require('../../assets/ghosts/secretaria.png'), model: require('../../assets/ghosts/secretaria.glb') },
  incorporacion: { department: 'direccion', ...AGENT_JOBS.incorporacion, picture: require('../../assets/ghosts/incorporacion.png'), model: require('../../assets/ghosts/incorporacion.glb') },
  finanzas: { department: 'finanzas', ...AGENT_JOBS.finanzas, picture: require('../../assets/ghosts/finanzas.png'), model: require('../../assets/ghosts/finanzas.glb') },
  redes: { department: 'marketing', ...AGENT_JOBS.redes, picture: require('../../assets/ghosts/redes.png'), model: require('../../assets/ghosts/redes.glb') },
  productor: { department: 'marketing', ...AGENT_JOBS.productor, picture: require('../../assets/ghosts/productor.png'), model: require('../../assets/ghosts/productor.glb') },
};

export const isGhostId = (id: string): id is GhostId => id in GHOSTS;

/** The ghosts in the order the new-agent screen offers them: the team's five, then the plain one. */
export const GHOST_ORDER: GhostId[] = ['secretaria', 'incorporacion', 'finanzas', 'redes', 'productor', 'base'];

export const DEPARTMENT_NAMES: Record<Department, string> = {
  direccion: 'Dirección',
  finanzas: 'Finanzas',
  legal: 'Legal',
  producto: 'Producto',
  marketing: 'Marketing',
};

/** Departments every team shows, even empty (a vacancy); the others only once they have someone. */
export const CORE_DEPARTMENTS: readonly Department[] = ['direccion', 'finanzas', 'marketing'];

// Decisions say which agent opened them (`propone`). Órdago's agents have their
// own names; each is drawn as the ghost of the job it does, any other as the
// plain ghost.
const BY_AGENT: Record<string, GhostId> = {
  secretaria: 'secretaria',
  correo: 'secretaria',
  direccion: 'secretaria',
  incorporacion: 'incorporacion',
  finanzas: 'finanzas',
  redes: 'redes',
  organico: 'redes',
  seo: 'redes',
  productor: 'productor',
  lamesa: 'productor',
};

export function ghostFor(agent: string): GhostId {
  return BY_AGENT[agent.trim().toLowerCase()] ?? 'base';
}

/** The name a decision's agent goes by in the app: its ghost's job, or its own name for an agent of another kind. */
export function agentLabel(agent: string): string {
  const g = ghostFor(agent);
  if (g !== 'base') return GHOSTS[g].label;
  const a = agent.trim();
  return a.charAt(0).toUpperCase() + a.slice(1);
}

/** Who asks a decision, as the app shows them: the agent row it points at, else what `propone` says. */
export function askerOf(d: { proposedBy: string; agent: { name: string; ghost: string } | null }): { name: string; ghost: GhostId } {
  if (d.agent) return { name: d.agent.name, ghost: isGhostId(d.agent.ghost) ? d.agent.ghost : 'base' };
  return { name: agentLabel(d.proposedBy), ghost: ghostFor(d.proposedBy) };
}
