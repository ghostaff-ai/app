// The way in (docs/plans/ongoing/welcome-and-spaces.md): your name, what it's
// for, the company's name (a company only), then the AI the agents run on.

export type Purpose = 'personal' | 'company';

/** How many steps the way in has: four for a company, otherwise three (the shorter way, until a company is chosen). */
export function stepsFor(purpose: Purpose | null): number {
  return purpose === 'company' ? 4 : 3;
}
