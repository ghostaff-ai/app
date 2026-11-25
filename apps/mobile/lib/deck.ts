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
 * words, on its own screen; a high-stakes one is chosen, not swiped
 * (decision-model.md, decision 3); everything else takes the agent's pick.
 */
export function canSwipe(d: Decision): boolean {
  return d.kind !== RULE_KIND && !d.highStakes;
}

/** The main button's words: the action the agent recommends, as a verb. */
export function pickLabel(d: Decision): string {
  if (d.kind === RULE_KIND) return 'Revisar la regla';
  const pick = d.options.find((o) => o.id === d.recommendedOption);
  if (pick) return pick.text;
  return d.recommendation?.trim() || 'OK';
}

/** One way to answer a card: its button's words, what it sends, and whether it is the agent's pick. */
export interface Choice {
  label: string;
  answer: 'ok' | 'no';
  option?: string;
  pick: boolean;
  /** What happens with it, in one sentence, when the agent said. */
  if?: string;
}

/**
 * The answers a card offers, in the order the buttons show them: each option
 * as the agent wrote them (decision-model.md, decision 2), or «No» and the
 * pick. A high-stakes yes-or-no reads «No» and «Sí», so the button does not
 * give the pick away.
 */
export function choicesOf(d: Decision): Choice[] {
  if (d.options.length) {
    return d.options.map((o) => ({
      label: o.text,
      answer: o.id === d.recommendedOption ? 'ok' : 'no',
      option: o.id,
      pick: o.id === d.recommendedOption,
      ...(o.if ? { if: o.if } : {}),
    }));
  }
  return [
    { label: 'No', answer: 'no', pick: false, ...(d.ifNo ? { if: d.ifNo } : {}) },
    { label: d.highStakes ? 'Sí' : pickLabel(d), answer: 'ok', pick: true, ...(d.ifYes ? { if: d.ifYes } : {}) },
  ];
}

/** The words for an answer once given: the option, or «no», or the pick. */
export function answeredLabel(d: Decision, c: Pick<Choice, 'answer' | 'option'>): string {
  if (c.option) return d.options.find((o) => o.id === c.option)?.text ?? c.option;
  return c.answer === 'no' ? 'no' : pickLabel(d);
}
