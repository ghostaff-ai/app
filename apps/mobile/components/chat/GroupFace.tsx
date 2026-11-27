import { Image, View } from 'react-native';
import { GHOSTS, type GhostId } from '@/lib/team';
import { usePalette } from '@/lib/theme';
import { Avatar } from './Message';

const BOX = 38;

/** General's face in the header: the first other person over the main agent's ghost, or the ghost alone when nobody else is in. */
export function GroupFace({ person, ghost }: { person: { name: string; id: string } | null; ghost: GhostId }) {
  const c = usePalette();
  const picture = GHOSTS[ghost].picture;
  if (!person) {
    return (
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: BOX, height: BOX }} className="items-center justify-center">
        <Image source={picture} style={{ width: 32, height: 32 }} resizeMode="contain" />
      </View>
    );
  }
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: BOX, height: BOX }}>
      <View
        style={{ position: 'absolute', right: 0, bottom: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: '#2A2550' }}
        className="items-center justify-center overflow-hidden"
      >
        <Image source={picture} style={{ width: 26, height: 26 }} resizeMode="contain" />
      </View>
      <View style={{ position: 'absolute', left: 0, top: 0, borderRadius: 16, borderWidth: 2, borderColor: c.chat }}>
        <Avatar name={person.name} id={person.id} size={27} />
      </View>
    </View>
  );
}
