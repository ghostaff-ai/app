import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Check, Checks, Icon } from '@/components/icons';
import { usePalette } from '@/lib/theme';

// A message's bubble, as in WhatsApp (docs/plans/ready/chat-like-whatsapp.md):
// yours on the right in the accent colour, everyone else's on the left on a
// card, agents included (decision 3). The first of a run has its tail (a
// sharper top corner), and in a group the sender's name in their colour. The
// time sits inside at the bottom right, with your ticks: one when sent, two
// blue once everyone else in the chat has read it.

/** Yours: sent, or read by everyone else in the chat. */
export type Ticks = 'sent' | 'read';

/** Blue for «read», on the accent bubble in both themes. */
const READ_BLUE = '#53BDEB';

/** The time and your ticks, as they sit in the bubble's corner. */
export function Stamp({ time, ticks, mine, edited }: { time: string; ticks?: Ticks | null; mine: boolean; edited?: boolean }) {
  const c = usePalette();
  const colour = mine ? c.onAccent : c.muted;
  return (
    <View className="flex-row items-center" accessibilityLabel={`${edited ? 'Editado, ' : ''}${time}${ticks === 'read' ? ', leído' : ticks === 'sent' ? ', enviado' : ''}`}>
      {edited ? <Text className={`mr-1 text-[11px] ${mine ? 'text-on-accent' : 'text-muted'} opacity-70`}>editado</Text> : null}
      <Text className={`text-[11px] ${mine ? 'text-on-accent' : 'text-muted'} opacity-70`} style={{ fontVariant: ['tabular-nums'] }}>
        {time}
      </Text>
      {mine && ticks ? (
        <View className="ml-1" style={{ opacity: ticks === 'read' ? 1 : 0.7 }}>
          <Icon icon={ticks === 'read' ? Checks : Check} size={14} color={ticks === 'read' ? READ_BLUE : colour} weight="bold" />
        </View>
      ) : null}
    </View>
  );
}

export function Bubble({
  mine,
  tail,
  name,
  nameColour,
  avatar,
  wide,
  stamp,
  stampInline,
  children,
  testID,
  accessibilityLabel,
}: {
  mine: boolean;
  /** The first of a run: the sharper corner, the name and the avatar. */
  tail: boolean;
  /** Someone else's name in a group, on the first of a run. */
  name?: string | null;
  nameColour?: string;
  /** Someone else's face on the first of a run; the column stays when it isn't. */
  avatar?: ReactNode;
  /** An agent's answer: lists and long text need the room. */
  wide?: boolean;
  /** The time and ticks. */
  stamp: ReactNode;
  /**
   * Short text: the stamp sits beside it on its last line when there is room,
   * and under it at the right when there isn't, as in WhatsApp. The text and
   * the stamp stay apart (a reader, or a test, reads the text as written).
   */
  stampInline?: boolean;
  children: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const shape = mine ? `rounded-2xl ${tail ? 'rounded-tr-[4px]' : ''} bg-accent` : `rounded-2xl ${tail ? 'rounded-tl-[4px]' : ''} border border-line bg-card`;
  return (
    <View testID={testID} className={`flex-row px-3 ${mine ? 'justify-end' : 'justify-start'} ${tail ? 'mt-2' : 'mt-0.5'}`}>
      {mine ? null : <View style={{ width: 30 }}>{tail ? avatar : null}</View>}
      <View className={`${shape} px-2.5 pb-1.5 pt-1.5 ${mine ? '' : 'ml-1'}`} style={{ maxWidth: wide ? '88%' : '78%' }} accessibilityLabel={accessibilityLabel}>
        {name && tail ? (
          <Text className="mb-0.5 text-footnote font-semibold" style={{ color: nameColour }} numberOfLines={1}>
            {name}
          </Text>
        ) : null}
        {stampInline ? (
          <View className="flex-row flex-wrap items-end justify-end">
            <View className="shrink">{children}</View>
            <View className="mb-[1px] ml-2">{stamp}</View>
          </View>
        ) : (
          <>
            {children}
            <View className="mt-0.5 self-end">{stamp}</View>
          </>
        )}
      </View>
    </View>
  );
}
