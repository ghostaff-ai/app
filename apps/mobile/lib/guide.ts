import type { GuideField, GuideStep } from '@ghostaff/shared';
import { EngineError } from '@ghostaff/shared/services';

// The pure side of a guide's screen and card (docs/plans/ongoing/guided-access.md):
// what a step asks the person to do, and the engine's refusals in plain Spanish.

/**
 * The one thing a step waits for. `choice`, `confirm` and `check` are blocks
 * that carry their own buttons; `text` and `next` get a «Seguir» after the
 * blocks; `connector` hands over to the catalogue's connect; `finished` is the
 * closing step (or a blocked one): nothing more to ask.
 */
export type StepAction = 'finished' | 'check' | 'choice' | 'confirm' | 'connector' | 'text' | 'next';

export function stepAction(step: GuideStep): StepAction {
  if (step.done || step.blocked) return 'finished';
  const has = (type: string) => step.blocks.some((b) => b.type === type);
  if (has('check')) return 'check';
  if (has('choice')) return 'choice';
  if (has('confirm')) return 'confirm';
  if (has('use_connector')) return 'connector';
  if (has('field')) return 'text';
  return 'next';
}

/** How a field is named when the screen has to ask for it again (its step is gone, e.g. after closing the app). */
export const FIELD_LABELS: Record<GuideField, string> = {
  base_url: 'La dirección de tu web',
  username: 'Tu usuario',
  password: 'La contraseña de aplicación',
  token: 'El token',
  key: 'La clave',
};

const codeOf = (e: unknown) => (e instanceof EngineError ? e.code : 'failed');

/** Why a step, a photo or a check didn't go through. The engine's own Spanish where it writes it for the person. */
export function guideErrorText(e: unknown): string {
  const code = codeOf(e);
  switch (code) {
    case 'too_big':
    case 'bad_photo':
    case 'no_step':
      return e instanceof EngineError && e.message ? e.message : 'No he podido preparar el siguiente paso. Prueba otra vez en un momento.';
    case 'still_writing':
      return 'El agente aún está escribiendo. Prueba otra vez en un momento.';
    case 'not_allowed':
      return 'Solo puede hacerlo quien escribe en esta conversación.';
    case 'unreachable':
      return 'No hay conexión. Comprueba tu internet y prueba otra vez.';
    case 'unavailable':
      return 'Las guías no están disponibles ahora mismo. Prueba más tarde.';
    default:
      return 'No he podido seguir. Prueba otra vez.';
  }
}

/** Why the guide couldn't be opened, and whether trying again can help. */
export type LoadProblem = { title: string; body?: string; retry: boolean };

export function guideLoadProblem(e: unknown): LoadProblem {
  switch (codeOf(e)) {
    case 'not_found':
    case 'bad_request':
      return { title: 'Esta guía ya no existe.', body: 'Vuelve a la conversación: el agente puede pedirte el acceso otra vez.', retry: false };
    case 'not_allowed':
      return { title: 'No puedes ver esta guía.', body: 'Es de una conversación a la que no tienes acceso.', retry: false };
    case 'unavailable':
      return { title: 'Las guías no están disponibles ahora mismo.', body: 'Prueba otra vez en un rato.', retry: true };
    case 'unreachable':
      return { title: 'No hay conexión.', body: 'Comprueba tu internet y prueba otra vez.', retry: true };
    default:
      return { title: 'No hemos podido abrir esta guía.', body: 'Prueba otra vez en un momento.', retry: true };
  }
}

/** The guide moved elsewhere (another step, someone finished it): read it again rather than show an error. */
export const movedOn = (e: unknown) => ['conflict', 'finished', 'already_done'].includes(codeOf(e));

/** Why an owner's approval or rejection didn't go through. */
export function decideErrorText(e: unknown): string {
  switch (codeOf(e)) {
    case 'already_decided':
      return 'Ya lo ha decidido otra persona.';
    case 'gone':
      return 'La contraseña ya no está guardada: hay que repetir la guía.';
    case 'not_owner':
      return 'Solo quien es propietario puede decidirlo.';
    case 'still_writing':
      return 'El agente aún está escribiendo. Prueba otra vez en un momento.';
    default:
      return 'No se ha podido. Inténtalo otra vez.';
  }
}

/** «Ana», «Ana o Jaime», «Ana, Jaime o Bea». */
export function eitherOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} o ${names[names.length - 1]}`;
}

const madridDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });

/** When a guide's check passed, as a list reads it: «hoy», «ayer» or «el 20 nov», in Madrid. */
export function checkedWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const day = madridDay(at);
  if (day === madridDay(now)) return 'hoy';
  if (day === madridDay(new Date(now.getTime() - 86_400_000))) return 'ayer';
  const date = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' }).format(at);
  return `el ${date.replace('.', '')}`;
}
