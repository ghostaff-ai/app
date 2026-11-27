import type { Decision, Department } from '@ghostaff/shared';

// What each ghost on Equipo shows above its head (team-board.md, decision 3):
// one tag, the most pressing first. Only «Te espera» takes the signal colour.

export type AgentTag = { kind: 'waiting'; count: number } | { kind: 'working' } | { kind: 'unread' } | null;

export function agentTag({ waiting, working, unread }: { waiting: number; working: boolean; unread: boolean }): AgentTag {
  if (waiting > 0) return { kind: 'waiting', count: waiting };
  if (working) return { kind: 'working' };
  if (unread) return { kind: 'unread' };
  return null;
}

export function tagLabel(tag: NonNullable<AgentTag>): string {
  switch (tag.kind) {
    case 'waiting':
      return tag.count === 1 ? 'Te espera' : `${tag.count} para ti`;
    case 'working':
      return 'Trabajando';
    case 'unread':
      return 'Nuevo';
  }
}

/** The open decisions of each agent, by agent id: those an agent row asked and nobody has answered. */
export function waitingByAgent(decisions: readonly Decision[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of decisions) {
    if (d.answer || !d.agent) continue;
    out[d.agent.id] = (out[d.agent.id] ?? 0) + 1;
  }
  return out;
}

/** The light each department's ghosts stand in, as red, green, blue: violet, blue, pink; teal for any other. */
const LIGHTS: Partial<Record<Department, readonly [number, number, number]>> = {
  direccion: [150, 110, 255],
  finanzas: [80, 130, 255],
  marketing: [240, 90, 170],
};

export function departmentLight(d: Department): readonly [number, number, number] {
  return LIGHTS[d] ?? [70, 200, 180];
}
