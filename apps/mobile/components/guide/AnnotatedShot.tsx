import type { GuideMark } from '@ghostaff/shared';
import { Image, Text, View } from 'react-native';
import type { Shot } from '@/lib/guidePhoto';
import { usePalette } from '@/lib/theme';

// The person's own screenshot with the model's mark on it (guided-access.md,
// `annotated_shot`): a ring, or an arrow, where they have to press. The mark's
// x and y are fractions of the photo, so it sits right at any size. Only the
// photo this device sent is drawn: the engine never keeps it, and nothing the
// model writes ever becomes an image's address. The mark is in the colour of
// what waits for you, which stands out on a light or a dark screenshot.

const RING = 44;

/** The ring around the spot. */
function Ring({ color }: { color: string }) {
  return <View style={{ width: RING, height: RING, borderRadius: RING / 2, marginLeft: -RING / 2, marginTop: -RING / 2, borderWidth: 4, borderColor: color }} />;
}

/** An arrow pointing at the spot: from below when the spot is near the top, else from above. */
function Arrow({ fromBelow, color }: { fromBelow: boolean; color: string }) {
  const head = (
    <View
      style={{
        width: 0,
        height: 0,
        borderLeftWidth: 12,
        borderRightWidth: 12,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        ...(fromBelow ? { borderBottomWidth: 16, borderBottomColor: color } : { borderTopWidth: 16, borderTopColor: color }),
      }}
    />
  );
  const stem = <View style={{ width: 6, height: 36, borderRadius: 3, backgroundColor: color }} />;
  return (
    <View style={{ width: 24, marginLeft: -12, marginTop: fromBelow ? 0 : -52 }} className="items-center">
      {fromBelow ? head : stem}
      {fromBelow ? stem : head}
    </View>
  );
}

export function AnnotatedShot({ shot, mark, caption }: { shot: Shot | null; mark: GuideMark; caption?: string }) {
  const c = usePalette();
  if (!shot) {
    return (
      <View className="mt-4 rounded-xl bg-sunk p-4">
        {caption ? <Text className="text-base text-ink">{caption}</Text> : null}
        <Text className="mt-1 text-footnote text-muted">Vuelve a enviar tu foto para verla marcada.</Text>
      </View>
    );
  }
  const at = { position: 'absolute' as const, pointerEvents: 'none' as const, left: `${mark.x * 100}%` as const, top: `${mark.y * 100}%` as const };
  return (
    <View className="mt-4">
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Tu captura, con una marca donde tienes que pulsar${caption ? `: ${caption}` : ''}`}
        className="overflow-hidden rounded-xl border border-line bg-sunk"
        // A tall phone screenshot stays readable without taking the whole screen.
        style={{ width: '100%', maxWidth: shot.height > shot.width ? 260 : undefined, alignSelf: 'center', aspectRatio: shot.width / shot.height }}
      >
        <Image source={{ uri: shot.uri }} alt="" style={{ width: '100%', height: '100%' }} resizeMode="contain" />
        <View testID="guide-mark" style={at}>
          {mark.shape === 'arrow' ? <Arrow fromBelow={mark.y < 0.25} color={c.waiting} /> : <Ring color={c.waiting} />}
        </View>
      </View>
      {caption ? <Text className="mt-2 text-base text-ink">{caption}</Text> : null}
    </View>
  );
}
