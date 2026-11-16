import type { AgentGhost, Department } from '@ghostaff/shared';
import type { ImageSourcePropType } from 'react-native';

// The ghosts an organisation's agents are drawn as: the ones Álvaro designed
// (Tripo models, made in the design pipeline on branch spike/ghost-3d), each
// with the job and department it was drawn for (ghostaff-producto.md, «El
// equipo de partida»). An organisation's agents are rows in `agents`.

export type GhostId = AgentGhost;

export const GHOSTS: Record<GhostId, { label: string; job: string; department: Department; picture: ImageSourcePropType; model: number }> = {
  base: { department: 'direccion', label: 'Agente', job: 'Un agente del equipo.', picture: require('../../assets/ghosts/base.png'), model: require('../../assets/ghosts/base.glb') },
  secretaria: { department: 'direccion', label: 'Secretaría', job: 'Que no se escape nada: lee el correo y te trae solo lo que necesita de ti.', picture: require('../../assets/ghosts/secretaria.png'), model: require('../../assets/ghosts/secretaria.glb') },
  incorporacion: { department: 'direccion', label: 'Incorporación', job: 'Monta el registro de la organización con lo que ya tenéis, y guarda lo nuevo que llegue.', picture: require('../../assets/ghosts/incorporacion.png'), model: require('../../assets/ghosts/incorporacion.glb') },
  finanzas: { department: 'finanzas', label: 'Finanzas', job: 'El libro al día, con un documento detrás de cada euro.', picture: require('../../assets/ghosts/finanzas.png'), model: require('../../assets/ghosts/finanzas.glb') },
  redes: { department: 'marketing', label: 'Redes', job: 'Hace crecer vuestras redes, aprendiendo qué funciona.', picture: require('../../assets/ghosts/redes.png'), model: require('../../assets/ghosts/redes.glb') },
  productor: { department: 'marketing', label: 'Productor', job: 'Convierte encargos y material en bruto en piezas listas para publicar.', picture: require('../../assets/ghosts/productor.png'), model: require('../../assets/ghosts/productor.glb') },
};

export const isGhostId = (id: string): id is GhostId => id in GHOSTS;

/** The ghosts in the order the new-agent screen offers them: the team's five, then the plain one. */
export const GHOST_ORDER: GhostId[] = ['secretaria', 'incorporacion', 'finanzas', 'redes', 'productor', 'base'];

export const DEPARTMENT_NAMES: Record<Department, string> = {
  direccion: 'Dirección',
  finanzas: 'Finanzas',
  marketing: 'Marketing',
};

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
