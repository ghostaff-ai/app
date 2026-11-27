// An agent's photo (docs/plans/ongoing/agent-photo.md): the blocks it keeps
// on its page, chosen from a fixed catalogue and drawn by the app. The agent
// writes them in its record (record/photo.ts reads the file); the database's
// `agent_photos` holds what the app draws. Pure, no I/O.

/** A point of a series: its day (`YYYY-MM-DD`) or a label, and its value. */
export type PhotoPoint = [string, number];

/** A goal: where it started, where it is, where it has to get and by when. Its verdict is ours (goalVerdict). */
export interface GoalBlock {
  kind: 'goal';
  title: string;
  unit: string | null;
  /** Where it started, on `from`. */
  base: number;
  from: string;
  target: number;
  /** The day it has to be reached. */
  by: string;
  /** What happened, oldest first; the last point is where it is now. */
  points: PhotoPoint[];
}

/** A number with how it moved against its last period. */
export interface FigureBlock {
  kind: 'figure';
  title: string;
  value: number;
  unit: string | null;
  /** The change against the last period, as a fraction: 0.06 is +6 %. */
  change: number | null;
  period: string | null;
}

export interface SeriesBlock {
  kind: 'series';
  title: string;
  unit: string | null;
  shape: 'lines' | 'bars';
  points: PhotoPoint[];
}

/** What the agent did last, in three lines: did, found, changes. */
export interface HeadlinesBlock {
  kind: 'headlines';
  did: string | null;
  found: string | null;
  changes: string | null;
}

export type ListItemState = 'waiting' | 'done' | 'planned' | 'failed';

export interface ListBlock {
  kind: 'list';
  title: string;
  items: { title: string; detail: string | null; state: ListItemState | null }[];
}

export type PhotoBlock = GoalBlock | FigureBlock | SeriesBlock | HeadlinesBlock | ListBlock;

/** A block the file had and Ghostaff could not draw: its place in the file and why. */
export interface SkippedBlock {
  index: number;
  reason: string;
}

export interface AgentPhoto {
  agentId: string;
  blocks: PhotoBlock[];
  skipped: SkippedBlock[];
  /** When the agent says it last refreshed it (`actualizado`), else when the sync read it. */
  updatedAt: string;
  /** Why the last version of the file could not be read: the blocks are those of the last good one. */
  error: string | null;
}

export const PHOTO_LIMITS = { blocks: 12, points: 200, items: 20, text: 200, fileBytes: 20_000 } as const;

export type GoalVerdict = 'ahead' | 'on' | 'behind';

/** How far from its path a goal may be and still be «en la línea», as a share of the whole way. */
export const GOAL_TOLERANCE = 0.05;

const dayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Where the goal's straight path from `base` on `from` to `target` on `by` stands on `day`. */
export function goalPathAt(g: Pick<GoalBlock, 'base' | 'from' | 'target' | 'by'>, day: string): number {
  const start = dayMs(g.from);
  const end = dayMs(g.by);
  if (!(end > start)) return g.target;
  const t = Math.min(1, Math.max(0, (dayMs(day) - start) / (end - start)));
  return g.base + (g.target - g.base) * t;
}

/**
 * Whether a goal goes ahead of, on or behind its path, at its last point. Works for goals that go
 * down too (a target under the base): ahead is always closer to the target than the path.
 */
export function goalVerdict(g: GoalBlock): GoalVerdict | null {
  const last = g.points[g.points.length - 1];
  if (!last || g.target === g.base) return null;
  const expected = goalPathAt(g, last[0]);
  const gained = (last[1] - expected) * Math.sign(g.target - g.base);
  const tolerance = Math.abs(g.target - g.base) * GOAL_TOLERANCE;
  if (gained > tolerance) return 'ahead';
  if (gained < -tolerance) return 'behind';
  return 'on';
}
