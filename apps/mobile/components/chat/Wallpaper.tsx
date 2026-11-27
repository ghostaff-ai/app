import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Defs, Path, Pattern, Rect } from 'react-native-svg';
import { usePalette } from '@/lib/theme';

/** The chat's backdrop: a tile of ghost doodles over the chat colour. It stays still while the list scrolls. */
export function Wallpaper() {
  const c = usePalette();
  // Per instance: on web, background screens stay mounted and a shared id could resolve to a hidden pattern.
  const patternId = `chat-doodles-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <Svg testID="chat-wallpaper" width="100%" height="100%" pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id={patternId} width={150} height={150} patternUnits="userSpaceOnUse">
          <Path
            d="M20 44V30a11 11 0 0 1 22 0v14l-3.7-3.2-3.6 3.2-3.7-3.2-3.7 3.2-3.6-3.2z"
            fill="none"
            stroke={c.chatPattern}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={27} cy={30} r={1.6} fill="none" stroke={c.chatPattern} strokeWidth={1.6} />
          <Circle cx={35} cy={30} r={1.6} fill="none" stroke={c.chatPattern} strokeWidth={1.6} />
          <Path d="M104 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="none" stroke={c.chatPattern} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={76} cy={60} r={5} fill="none" stroke={c.chatPattern} strokeWidth={1.6} />
          <Path
            d="M98 102V90a9 9 0 0 1 18 0v12l-3-2.6-3 2.6-3-2.6-3 2.6-3-2.6z"
            transform="rotate(14 107 96)"
            fill="none"
            stroke={c.chatPattern}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path d="M30 112l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" fill="none" stroke={c.chatPattern} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M58 128c4-6 10-6 14 0" fill="none" stroke={c.chatPattern} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M128 58h10M133 53v10" fill="none" stroke={c.chatPattern} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={c.chat} />
      <Rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </Svg>
  );
}
