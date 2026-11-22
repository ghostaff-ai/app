// The way in (docs/plans/ongoing/welcome-and-spaces.md): your name, what it's
// for, the company's name (a company only), then the AI the agents run on.

export type Purpose = 'personal' | 'company';

/** How many steps the way in has, once you've chosen what it's for (two before). */
export function stepsFor(purpose: Purpose | null): number {
  if (purpose === 'personal') return 3;
  if (purpose === 'company') return 4;
  return 2;
}
