import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon, Key } from '@/components/icons';
import { BRAND_LOGOS } from '@/lib/brandLogos';
import { usePalette } from '@/lib/theme';

// A connector's logo on a rounded tile in its brand colour, the way the phone's
// settings draw an app: the mark in white, or in black on a light brand colour.
// One simple-icons doesn't have shows the service's initial on a quiet tile.

/** Relative luminance of a #RRGGBB colour, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ConnectorLogo({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  const logo = BRAND_LOGOS[id];
  const radius = Math.round(size * 0.24);
  if (!logo)
    return (
      <View
        accessible={false}
        style={{ width: size, height: size, borderRadius: radius }}
        className="items-center justify-center bg-sunk"
      >
        <Text className="font-display text-ink" style={{ fontSize: size * 0.44 }}>
          {name.charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  const mark = luminance(logo.hex) > 0.55 ? '#000000' : '#FFFFFF';
  const glyph = Math.round(size * 0.55);
  return (
    <View
      accessible={false}
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: logo.hex }}
      className="items-center justify-center"
    >
      <Svg width={glyph} height={glyph} viewBox="0 0 24 24">
        <Path d={logo.path} fill={mark} />
      </Svg>
    </View>
  );
}

/** One of the organisation's keys (Conexiones › Claves): its maker's logo when we have it, else a key on a quiet tile. */
export function KeyLogo({ maker, name, size = 40 }: { maker: string | null; name: string; size?: number }) {
  const c = usePalette();
  if (maker && BRAND_LOGOS[maker]) return <ConnectorLogo id={maker} name={name} size={size} />;
  return (
    <View accessible={false} style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }} className="items-center justify-center bg-sunk">
      <Icon icon={Key} size={Math.round(size * 0.5)} color={c.ink} weight="regular" />
    </View>
  );
}
