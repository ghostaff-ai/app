import type { ImageSourcePropType } from 'react-native';

// The team every organisation starts with (ghostaff-producto.md, «El equipo de
// partida»): three departments, each with its agents, and each agent drawn as
// one of the ghosts Álvaro designed (Tripo models, made in the design pipeline on
// branch spike/ghost-3d).

export type GhostId = 'base' | 'secretaria' | 'incorporacion' | 'finanzas' | 'redes' | 'productor';

export const GHOSTS: Record<GhostId, { label: string; job: string; picture: ImageSourcePropType; model: number }> = {
  base: { label: 'Agente', job: 'Un agente del equipo.', picture: require('../../assets/ghosts/base.png'), model: require('../../assets/ghosts/base.glb') },
  secretaria: { label: 'Secretaría', job: 'Que no se escape nada: lee el correo y te trae solo lo que necesita de ti.', picture: require('../../assets/ghosts/secretaria.png'), model: require('../../assets/ghosts/secretaria.glb') },
  incorporacion: { label: 'Incorporación', job: 'Monta el registro de la organización con lo que ya tenéis, y guarda lo nuevo que llegue.', picture: require('../../assets/ghosts/incorporacion.png'), model: require('../../assets/ghosts/incorporacion.glb') },
  finanzas: { label: 'Finanzas', job: 'El libro al día, con un documento detrás de cada euro.', picture: require('../../assets/ghosts/finanzas.png'), model: require('../../assets/ghosts/finanzas.glb') },
  redes: { label: 'Redes', job: 'Hace crecer vuestras redes, aprendiendo qué funciona.', picture: require('../../assets/ghosts/redes.png'), model: require('../../assets/ghosts/redes.glb') },
  productor: { label: 'Productor', job: 'Convierte encargos y material en bruto en piezas listas para publicar.', picture: require('../../assets/ghosts/productor.png'), model: require('../../assets/ghosts/productor.glb') },
};

export const isGhostId = (id: string): id is GhostId => id in GHOSTS;

export const TEAM: { name: string; agents: GhostId[] }[] = [
  { name: 'Dirección', agents: ['secretaria', 'incorporacion'] },
  { name: 'Finanzas', agents: ['finanzas'] },
  { name: 'Marketing', agents: ['redes', 'productor'] },
];

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
