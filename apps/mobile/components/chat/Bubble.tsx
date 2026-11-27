import type { ReactNode } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Check, Checks, Icon } from '@/components/icons';
import { usePalette, useScheme } from '@/lib/theme';

// A message's bubble, as in WhatsApp (docs/plans/ready/chat-like-whatsapp.md,
// docs/plans/ready/chat-look.md): yours on the right in lavender, everyone
// else's on the left in white, agents included (decision 3), with no border and
// a faint shadow. The first of a run has its tail (a sharper top corner and a
// small wedge outside it), and in a group the sender's name in their colour.
// The time sits inside at the bottom right, with your ticks: one when sent, two
// blue once everyone else in the chat has read it.

/** Yours: sent, or read by everyone else in the chat. */
export type Ticks = 'sent' | 'read';

/** The time and your ticks, as they sit in the bubble's corner. */
export function Stamp({ time, ticks, mine, edited }: { time: string; ticks?: Ticks | null; mine: boolean; edited?: boolean }) {
  const c = usePalette();
  const tone = mine ? 'text-mine-muted' : 'text-muted opacity-70';
  return (
    <View className="flex-row items-center" accessibilityLabel={`${edited ? 'Editado, ' : ''}${time}${ticks === 'read' ? ', leído' : ticks === 'sent' ? ', enviado' : ''}`}>
      {edited ? <Text className={`mr-1 text-[11px] ${tone}`}>editado</Text> : null}
      <Text className={`text-[11px] ${tone}`} style={{ fontVariant: ['tabular-nums'] }}>
        {time}
      </Text>
      {mine && ticks ? (
        <View className="ml-1">
          <Icon icon={ticks === 'read' ? Checks : Check} size={14} color={ticks === 'read' ? c.read : c.mineMuted} weight="bold" />
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
  below,
  onLongPress,
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
  /** The time and ticks; nothing is drawn when absent (a bubble that carries its own, like a voice note's). */
  stamp?: ReactNode;
  /**
   * Short text: the stamp sits beside it on its last line when there is room,
   * and under it at the right when there isn't, as in WhatsApp. The text and
   * the stamp stay apart (a reader, or a test, reads the text as written).
   */
  stampInline?: boolean;
  children: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
  /** Under the bubble, on its side: its reactions. */
  below?: ReactNode;
  /** Holding it: the message menu (MessageMenu). */
  onLongPress?: () => void;
}) {
  const c = usePalette();
  const dark = useScheme() === 'dark';
  const shape = mine ? `rounded-[18px] ${tail ? 'rounded-tr-[4px]' : ''} bg-mine` : `rounded-[18px] ${tail ? 'rounded-tl-[4px]' : ''} bg-theirs`;
  // Android's elevation draws badly under the tail, so it gets no shadow.
  const shadow = Platform.select({
    ios: { shadowColor: dark ? '#000000' : '#16151E', shadowOpacity: dark ? 0.5 : 0.14, shadowOffset: { width: 0, height: 1 }, shadowRadius: 0.6 },
    web: { boxShadow: `0 1px 0.6px rgba(${dark ? '0,0,0,0.5' : '22,21,30,0.14'})` },
  });
  return (
    <View testID={testID} className={`flex-row px-3 ${mine ? 'justify-end' : 'justify-start'} ${tail ? 'mt-2' : 'mt-0.5'}`}>
      {mine ? null : <View style={{ width: 30 }}>{tail ? avatar : null}</View>}
      <View className={`${mine ? 'items-end' : 'items-start ml-1'}`} style={{ maxWidth: wide ? '88%' : '78%' }}>
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={350}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={onLongPress ? 'Mantén pulsado para reaccionar, responder y más' : undefined}
          accessibilityActions={onLongPress ? [{ name: 'longpress', label: 'Opciones del mensaje' }] : undefined}
          onAccessibilityAction={onLongPress ? () => onLongPress() : undefined}
          className={`${shape} px-2.5 pb-1.5 pt-1.5`}
          style={shadow}
        >
          {tail ? (
            <Svg testID="bubble-tail" width={9} height={12} viewBox="0 0 9 12" style={{ position: 'absolute', top: 0, ...(mine ? { right: -7 } : { left: -7 }) }}>
              <Path d={mine ? 'M0 0 H9 C6 1.5 2.5 6 0 12 Z' : 'M9 0 H0 C3 1.5 6.5 6 9 12 Z'} fill={mine ? c.mine : c.theirs} />
            </Svg>
          ) : null}
          {name && tail ? (
            <Text className="mb-0.5 text-footnote font-semibold" style={{ color: nameColour }} numberOfLines={1}>
              {name}
            </Text>
          ) : null}
          {!stamp ? (
            children
          ) : stampInline ? (
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
        </Pressable>
        {below}
      </View>
    </View>
  );
}
