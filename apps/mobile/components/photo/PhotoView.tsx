import {
  type AgentPhoto,
  type FigureBlock,
  type GoalBlock,
  goalVerdict,
  type GoalVerdict,
  type HeadlinesBlock,
  type ListBlock,
  type ListItemState,
  type PhotoBlock,
  type PhotoPoint,
  type SeriesBlock,
} from '@ghostaff/shared';
import { type ReactNode, useState } from 'react';
import { type LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { shortTime } from '@/lib/chat';
import { shortDate } from '@/lib/format';
import { usePalette } from '@/lib/theme';

// An agent's photo on its page (docs/plans/ongoing/agent-photo.md): the
// blocks it keeps, each drawn by one of the app's own pieces. The agent only
// chooses which and gives the data; every word here is drawn as text.

/** A number the Spanish way, one decimal under 100: 31,5; 12.840. */
export function formatNumber(n: number): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: Math.abs(n) < 100 ? 1 : 0 });
}

const withUnit = (n: number, unit: string | null) => (unit ? `${formatNumber(n)} ${unit}` : formatNumber(n));

/** A point's day as the axis says it; a label stays as it is. */
const pointLabel = (p: PhotoPoint) => (/^\d{4}-\d{2}-\d{2}$/.test(p[0]) ? shortDate(p[0]) : p[0]);

const VERDICTS: Record<GoalVerdict, string> = { ahead: 'Por encima del camino', on: 'En la línea', behind: 'Por debajo del camino' };

function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View testID={testID} className="mb-2.5 rounded-2xl bg-card px-4 py-3.5">
      {children}
    </View>
  );
}

/** The width a chart has to draw in, once laid out. */
function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0);
  return [w, (e) => setW(Math.round(e.nativeEvent.layout.width))];
}

function Pill({ verdict }: { verdict: GoalVerdict }) {
  const c = usePalette();
  const colour = verdict === 'ahead' ? c.ok : verdict === 'behind' ? c.waiting : c.muted;
  return (
    <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: `${colour}26` }}>
      <Text className="text-caption font-semibold" style={{ color: colour }}>
        {VERDICTS[verdict]}
      </Text>
    </View>
  );
}

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

function GoalView({ b }: { b: GoalBlock }) {
  const c = usePalette();
  const [w, onLayout] = useWidth();
  const verdict = goalVerdict(b);
  const now = b.points[b.points.length - 1]!;
  const h = 110;
  const pad = 6;
  const values = [b.base, b.target, ...b.points.map((p) => p[1])];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const t0 = dayMs(b.from);
  const t1 = dayMs(b.by);
  const x = (day: string) => pad + ((dayMs(day) - t0) / (t1 - t0)) * (w - 2 * pad);
  const y = (v: number) => (hi === lo ? h / 2 : pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad - 14));
  const line = verdict === 'behind' ? c.waiting : verdict === 'ahead' ? c.ok : c.ink;
  return (
    <Card testID="photo-goal">
      <View className="flex-row items-start justify-between">
        <View className="mr-2 flex-1">
          <Text className="text-footnote text-muted">{b.title}</Text>
          <Text className="font-display text-title text-ink">{withUnit(now[1], b.unit)}</Text>
        </View>
        {verdict ? <Pill verdict={verdict} /> : null}
      </View>
      <View onLayout={onLayout} style={{ height: h, marginTop: 6 }}>
        {w > 0 ? (
          <Svg width={w} height={h}>
            <Line x1={x(b.from)} y1={y(b.base)} x2={x(b.by)} y2={y(b.target)} stroke={c.muted} strokeWidth={1.4} strokeDasharray="4 4" />
            <Circle cx={x(b.by)} cy={y(b.target)} r={4} fill="none" stroke={c.ink} strokeWidth={1.6} />
            <Polyline points={b.points.map((p) => `${x(p[0])},${y(p[1])}`).join(' ')} fill="none" stroke={line} strokeWidth={2.6} strokeLinejoin="round" />
            <Circle cx={x(now[0])} cy={y(now[1])} r={4} fill={line} />
            <SvgText x={pad} y={h - 2} fontSize={10} fill={c.muted}>
              {shortDate(b.from)}
            </SvgText>
            <SvgText x={w - pad} y={h - 2} fontSize={10} fill={c.muted} textAnchor="end">
              {shortDate(b.by)}
            </SvgText>
          </Svg>
        ) : null}
      </View>
      <Text className="mt-1 text-caption text-muted">
        Meta: {withUnit(b.target, b.unit)} el {shortDate(b.by)}.
      </Text>
    </Card>
  );
}

function FigureView({ b }: { b: FigureBlock }) {
  const c = usePalette();
  const up = (b.change ?? 0) >= 0;
  return (
    <View testID="photo-figure" className="flex-1 rounded-2xl bg-card px-4 py-3.5">
      <Text className="text-caption text-muted" numberOfLines={2}>
        {b.title}
      </Text>
      <Text className="font-display text-title2 text-ink">{withUnit(b.value, b.unit)}</Text>
      {b.change !== null ? (
        <Text className="text-caption font-semibold" style={{ color: up ? c.ok : c.waiting }}>
          {up ? '↑' : '↓'} {formatNumber(Math.abs(b.change * 100))} %{b.period ? ` ${b.period}` : ''}
        </Text>
      ) : b.period ? (
        <Text className="text-caption text-muted">{b.period}</Text>
      ) : null}
    </View>
  );
}

function SeriesView({ b }: { b: SeriesBlock }) {
  const c = usePalette();
  const [w, onLayout] = useWidth();
  const h = 96;
  const pad = 4;
  const vals = b.points.map((p) => p[1]);
  const lo = b.shape === 'bars' ? Math.min(0, ...vals) : Math.min(...vals);
  const hi = Math.max(...vals);
  const y = (v: number) => (hi === lo ? h / 2 : pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad - 14));
  const n = b.points.length;
  const step = n > 1 ? (w - 2 * pad) / (b.shape === 'bars' ? n : n - 1) : 0;
  const last = b.points[n - 1]!;
  return (
    <Card testID="photo-series">
      <View className="flex-row items-baseline justify-between">
        <Text className="mr-2 flex-1 text-footnote text-muted">{b.title}</Text>
        <Text className="font-display-medium text-title3 text-ink">{withUnit(last[1], b.unit)}</Text>
      </View>
      <View onLayout={onLayout} style={{ height: h, marginTop: 6 }}>
        {w > 0 ? (
          <Svg width={w} height={h}>
            {b.shape === 'bars'
              ? b.points.map((p, i) => (
                  <Rect key={i} x={pad + i * step + step * 0.15} y={y(p[1])} width={step * 0.7} height={Math.max(1, y(lo) - y(p[1]))} rx={3} fill={i === n - 1 ? c.ink : c.raised} />
                ))
              : [
                  <Polyline key="l" points={b.points.map((p, i) => `${pad + i * step},${y(p[1])}`).join(' ')} fill="none" stroke={c.ink} strokeWidth={2.2} strokeLinejoin="round" />,
                  <Circle key="c" cx={pad + (n - 1) * step} cy={y(last[1])} r={3.5} fill={c.ink} />,
                ]}
            <SvgText x={pad} y={h - 2} fontSize={10} fill={c.muted}>
              {pointLabel(b.points[0]!)}
            </SvgText>
            <SvgText x={w - pad} y={h - 2} fontSize={10} fill={c.muted} textAnchor="end">
              {pointLabel(last)}
            </SvgText>
          </Svg>
        ) : null}
      </View>
    </Card>
  );
}

function HeadlinesView({ b }: { b: HeadlinesBlock }) {
  const rows: Array<[string, string | null]> = [
    ['Hizo', b.did],
    ['Encontró', b.found],
    ['Cambia', b.changes],
  ];
  return (
    <Card testID="photo-headlines">
      {rows
        .filter((r): r is [string, string] => !!r[1])
        .map(([label, said], i) => (
          <View key={label} className={`flex-row py-1.5 ${i > 0 ? 'border-t border-line' : ''}`}>
            <Text className="w-[72px] pt-0.5 text-caption font-semibold text-muted">{label}</Text>
            <Text className="flex-1 text-base leading-[21px] text-ink">{said}</Text>
          </View>
        ))}
    </Card>
  );
}

const STATES: Record<ListItemState, string> = { waiting: 'Te espera', done: 'Hecho', planned: 'Previsto', failed: 'Falló' };

function ListView({ b }: { b: ListBlock }) {
  const c = usePalette();
  const tone = (s: ListItemState) => (s === 'waiting' ? c.waiting : s === 'done' ? c.ok : s === 'failed' ? c.no : c.muted);
  return (
    <Card testID="photo-list">
      <Text className="mb-1 text-footnote text-muted">{b.title}</Text>
      {b.items.map((it, i) => (
        <View key={i} className={`flex-row items-center py-2 ${i > 0 ? 'border-t border-line' : ''}`}>
          <View className="mr-2 flex-1">
            <Text className="text-base text-ink">{it.title}</Text>
            {it.detail ? <Text className="text-footnote text-muted">{it.detail}</Text> : null}
          </View>
          {it.state ? (
            <Text className="text-caption font-semibold" style={{ color: tone(it.state) }}>
              {STATES[it.state]}
            </Text>
          ) : null}
        </View>
      ))}
    </Card>
  );
}

/** Two figures side by side; every other block on its own row. */
type Row = { kind: 'figures'; figures: FigureBlock[] } | { kind: 'block'; block: Exclude<PhotoBlock, FigureBlock> };

export function photoRows(blocks: PhotoBlock[]): Row[] {
  const rows: Row[] = [];
  for (const b of blocks) {
    const last = rows[rows.length - 1];
    if (b.kind === 'figure') {
      if (last?.kind === 'figures' && last.figures.length < 2) last.figures.push(b);
      else rows.push({ kind: 'figures', figures: [b] });
    } else rows.push({ kind: 'block', block: b });
  }
  return rows;
}

export function PhotoView({ photo, agentName }: { photo: AgentPhoto; agentName: string }) {
  return (
    <View testID="agent-photo">
      {photoRows(photo.blocks).map((r, i) =>
        r.kind === 'figures' ? (
          <View key={i} className="mb-2.5 flex-row gap-2.5">
            {r.figures.map((f, j) => (
              <FigureView key={j} b={f} />
            ))}
            {r.figures.length === 1 ? <View className="flex-1" /> : null}
          </View>
        ) : r.block.kind === 'goal' ? (
          <GoalView key={i} b={r.block} />
        ) : r.block.kind === 'series' ? (
          <SeriesView key={i} b={r.block} />
        ) : r.block.kind === 'headlines' ? (
          <HeadlinesView key={i} b={r.block} />
        ) : (
          <ListView key={i} b={r.block} />
        ),
      )}
      <Text className="ml-1 text-caption text-muted">
        La actualizó {agentName} {shortTime(photo.updatedAt)}.
        {photo.skipped.length ? ` ${photo.skipped.length === 1 ? 'Un bloque no se puede' : `${photo.skipped.length} bloques no se pueden`} dibujar.` : ''}
      </Text>
      {photo.error ? <Text className="ml-1 mt-1 text-caption text-muted">No he podido leer su última versión: {photo.error}</Text> : null}
    </View>
  );
}
