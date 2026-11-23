import { type Decision, RULE_KIND } from '@ghostaff/shared';

// The decision deck's small rules (docs/plans/ongoing/three-tabs.md, decision
// 7): which cards are in it, which may be swiped, and when «Más tarde» brings
// a card back.

/** How far a card must travel, in px, for a swipe to count. */
export const SWIPE_DISTANCE = 120;

/** When «Más tarde» brings a card back: tomorrow at 8:00, the person's own time. */
export function tomorrowMorning(now = new Date()): Date {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0, 0);
  return t;
}

/**
 * The cards, in the inbox's order (sortInbox: the nearest deadline first, then
 * the newest): what waits for an answer, without what the person put aside,
 * unless they asked to see those now. `gone` are the cards answered or put
 * aside on this screen, before the list reloads.
 */
export function deckOf(decisions: Decision[], aside: Record<string, string>, opts: { showAside?: boolean; gone?: ReadonlySet<string> } = {}): Decision[] {
  return decisions.filter((d) => !d.answer && !d.closedAt && !opts.gone?.has(d.id) && (opts.showAside || !aside[d.id]));
}

/** How many waiting cards the person put aside. */
export function asideCount(decisions: Decision[], aside: Record<string, string>): number {
  return decisions.filter((d) => !d.answer && !d.closedAt && aside[d.id]).length;
}

/**
 * Whether a card may be answered with a swipe. A rule is signed, in its own
 * words, on its own screen; everything else takes the agent's pick.
 */
export function canSwipe(d: Decision): boolean {
  return d.kind !== RULE_KIND;
}

/** The main button's words: the action the agent recommends, as a verb. */
export function pickLabel(d: Decision): string {
  if (d.kind === RULE_KIND) return 'Revisar la regla';
  return d.recommendation?.trim() || 'OK';
}
