// A chat agent's photo (docs/plans/ongoing/agent-photo.md, PR 2): the same
// `agentes/<slug>/foto.yaml` an agent on our runner keeps, written from a chat
// turn through two tools, as memory.ts writes its memory. A write is checked
// with the sync's own reader, committed signed with who the agent works for,
// and projected at once, so the person sees it on the agent's page as soon as
// the reply ends. Nothing outside Ghostaff changes: no approval card.

import { agentPhotoPath, photoFormat, readPhoto } from '@ghostaff/shared/record';
import { gitBlobSha } from './memory';
import type { PhotoRow, RecordRepo } from './recordSync';
import type { AgentTools, ToolSpec } from './tools';

export const PHOTO_VIEW = 'photo_view';
export const PHOTO_WRITE = 'photo_write';

export interface PhotoDeps {
  /** Writes the projection the app reads (`agent_photos`), as the sync does. */
  setPhoto(photo: PhotoRow): Promise<void>;
  /** How a member signs, for the commit («Cuentas (por Ana)»). */
  memberName(orgId: string, userId: string): Promise<string | null>;
  now?: () => Date;
}

const SPECS: ToolSpec[] = [
  {
    name: PHOTO_VIEW,
    description: 'Lee tu foto tal y como está ahora en el registro: el fichero YAML entero, o que aún no tienes.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: PHOTO_WRITE,
    description:
      'Guarda tu foto entera: el fichero YAML completo, con `actualizado` y `bloques`, que sustituye al que haya. ' +
      'Léela antes con photo_view si ya tienes una. Si un bloque está mal escrito no se guarda nada y te digo cuál y por qué.',
    input_schema: {
      type: 'object',
      properties: { yaml: { type: 'string', description: 'El fichero entero, en YAML.' } },
      required: ['yaml'],
    },
  },
];

const STEPS: Record<string, string> = { [PHOTO_VIEW]: 'Mirando su foto', [PHOTO_WRITE]: 'Guardando su foto' };

/** A failure the model hears, in words it can act on. */
class PhotoRefusal extends Error {}

/** What a chat agent with a photo reads in its system prompt. */
export function photoLines(): string[] {
  return [
    `Tienes una foto: lo que la gente ve de ti en tu ficha de Ghostaff, bloques que eliges tú y Ghostaff dibuja. Léela con ${PHOTO_VIEW} y guárdala con ${PHOTO_WRITE}.`,
    ...photoFormat(),
    'Si aún no tienes foto, no la crees por tu cuenta: cuando venga a cuento (al empezar a trabajar con alguien, o al hablar de cómo va tu trabajo), ' +
      'propón las dos o tres cosas que mostrarías y de dónde sacarías cada dato, y pregunta si las pones.',
  ];
}

/** The photo tools of one agent of one organisation, whose record is `repo`. `userId` is who it works for in this turn. */
export function photoTools(
  deps: PhotoDeps,
  repo: RecordRepo,
  ctx: { orgId: string; agentId: string; agentName: string; slug: string; userId: string | null },
): AgentTools {
  const path = agentPhotoPath(ctx.slug);

  const write = async (yaml: string): Promise<string> => {
    const content = yaml.endsWith('\n') ? yaml : `${yaml}\n`;
    let photo: ReturnType<typeof readPhoto>;
    try {
      photo = readPhoto(content);
    } catch (e) {
      throw new PhotoRefusal(`No la guardo: ${e instanceof Error ? e.message : String(e)}.`);
    }
    if (photo.skipped.length) {
      throw new PhotoRefusal(`No la guardo, ${photo.skipped.map((s) => `el bloque ${s.index + 1}: ${s.reason}`).join('; ')}. Corrígelo y vuelve a guardarla entera.`);
    }
    if (!photo.blocks.length) throw new PhotoRefusal('No la guardo: no tiene ningún bloque.');
    const who = ctx.userId ? await deps.memberName(ctx.orgId, ctx.userId).catch(() => null) : null;
    const by = who ? `${ctx.agentName} (por ${who})` : ctx.agentName;
    for (let attempt = 0; attempt < 2; attempt++) {
      const head = await repo.head();
      if (await repo.commit(head, [{ path, content }], `foto: ${path} (${by})`)) {
        const now = deps.now?.() ?? new Date();
        await deps.setPhoto({
          orgId: ctx.orgId,
          agentId: ctx.agentId,
          blocks: photo.blocks,
          skipped: [],
          sha: gitBlobSha(content),
          updatedAt: photo.updatedAt ?? now.toISOString(),
        });
        return `Guardada: ${photo.blocks.length} bloque${photo.blocks.length === 1 ? '' : 's'}. Ya se ve en tu ficha.`;
      }
    }
    throw new PhotoRefusal('El registro ha cambiado mientras guardaba; inténtalo otra vez.');
  };

  const run = async (name: string, input: Record<string, unknown>): Promise<string> => {
    if (name === PHOTO_VIEW) {
      const head = await repo.head();
      const file = await repo.file(path, head.sha);
      return file === null ? `Aún no tienes foto (\`${path}\`).` : `\`${path}\`:\n\n${file}`;
    }
    if (typeof input.yaml !== 'string' || !input.yaml.trim()) throw new PhotoRefusal('Falta `yaml`, el fichero entero como texto.');
    return write(input.yaml);
  };

  return {
    specs: SPECS,
    accounts: [],
    stepFor: (name) => STEPS[name] ?? 'Trabajando',
    // Only Ghostaff changes: no approval card (as the memory, agent-memory.md).
    writes: (name) => !(name in STEPS),
    actionFor: (name) => STEPS[name] ?? name,
    async run(name, input) {
      if (!(name in STEPS)) return { content: `No existe la herramienta ${name}.`, isError: true };
      if (typeof input !== 'object' || input === null || Array.isArray(input)) return { content: 'La entrada de la herramienta tiene que ser un objeto.', isError: true };
      try {
        return { content: await run(name, input as Record<string, unknown>), isError: false };
      } catch (e) {
        if (e instanceof PhotoRefusal) return { content: e.message, isError: true };
        console.error('photo tool failed', name, e instanceof Error ? e.message.slice(0, 200) : typeof e);
        return { content: 'No he podido guardar la foto ahora. Dilo tal cual y no digas que está guardada.', isError: true };
      }
    },
  };
}
