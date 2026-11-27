import type { Department } from '@ghostaff/shared';
import { useId, type ReactNode } from 'react';
import { Image, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop } from 'react-native-svg';
import { type AgentTag, departmentLight, tagLabel } from '@/lib/team/status';
import { GHOSTS, type GhostId } from '@/lib/team';
import { usePalette } from '@/lib/theme';

// A ghost standing on its small stage (team-board.md, decision 2): a card lit
// from above in its department's colour, a round pedestal under the ghost, and
// what it is doing in a tag over its head (decision 3). Equipo's tiles, the
// main agent's card and the agent's page draw their ghosts with it.

export function StageTag({ tag }: { tag: NonNullable<AgentTag> }) {
  const c = usePalette();
  const waiting = tag.kind === 'waiting';
  return (
    <View
      testID={`tag-${tag.kind}`}
      className="flex-row items-center rounded-full px-2.5 py-1"
      style={{ backgroundColor: waiting ? c.waiting : c.sunk }}
    >
      {tag.kind === 'working' ? <View className="mr-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.ink }} /> : null}
      <Text className="text-caption font-semibold" style={{ color: waiting ? '#FFFFFF' : c.ink }}>
        {tagLabel(tag)}
      </Text>
    </View>
  );
}

export function GhostStage({
  ghost,
  department,
  ghostSize,
  ghostX = 0.5,
  ghostBottom,
  tag,
  height,
  children,
}: {
  ghost: GhostId;
  department: Department;
  /** The ghost's width and height, in points. */
  ghostSize: number;
  /** Where the ghost stands across the card, 0 to 1. */
  ghostX?: number;
  /** How high its pedestal sits from the card's bottom, in points. */
  ghostBottom: number;
  tag?: AgentTag;
  height: number;
  /** Text laid over the card: the name, a line, an action. */
  children?: ReactNode;
}) {
  const c = usePalette();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [r, g, b] = departmentLight(department);
  const plateW = ghostSize * 1.12;
  const plateH = plateW * 0.26;
  const left = `${ghostX * 100}%` as const;
  return (
    <View className="overflow-hidden rounded-3xl bg-card" style={{ height }}>
      <Svg width="100%" height="100%" style={{ position: 'absolute' }} pointerEvents="none">
        <Defs>
          <RadialGradient id={`light${id}`} cx={left} cy="0%" rx="85%" ry="75%" fx={left} fy="0%">
            <Stop offset="0" stopColor={`rgb(${r},${g},${b})`} stopOpacity={0.34} />
            <Stop offset="1" stopColor={`rgb(${r},${g},${b})`} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`plate${id}`} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={c.raised} stopOpacity={0.9} />
            <Stop offset="1" stopColor={c.sunk} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#light${id})`} />
      </Svg>
      {/* The pedestal: its dark side, then its lit top. */}
      <View pointerEvents="none" style={{ position: 'absolute', left, bottom: ghostBottom - plateH * 0.55, marginLeft: -plateW / 2, width: plateW, height: plateH * 1.4 }}>
        <Svg width={plateW} height={plateH * 1.4}>
          <Ellipse cx={plateW / 2} cy={plateH * 0.9} rx={plateW / 2} ry={plateH / 2} fill={c.surface} />
          <Ellipse cx={plateW / 2} cy={plateH * 0.5} rx={plateW / 2} ry={plateH / 2} fill={`url(#plate${id})`} />
        </Svg>
      </View>
      <Image
        source={GHOSTS[ghost].picture}
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{ position: 'absolute', left, bottom: ghostBottom, marginLeft: -ghostSize / 2, width: ghostSize, height: ghostSize }}
        resizeMode="contain"
      />
      {tag ? (
        <View pointerEvents="none" style={{ position: 'absolute', left, top: 12, width: 200, marginLeft: -100, alignItems: 'center' }}>
          <StageTag tag={tag} />
        </View>
      ) : null}
      {children}
    </View>
  );
}
