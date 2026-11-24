import { useEffect, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { Camera } from '@/components/icons';
import { Button } from '@/components/ui';
import { pickShot, type ReadyShot, readyShot } from '@/lib/guidePhoto';

// «Enséñame tu pantalla», always at the bottom of a guide (guided-access.md):
// the photo is the main way to ask for help, not a fallback in a menu. On the
// phone it takes a photo or picks a screenshot; on the web it opens a file, and
// a screenshot pasted anywhere on the page goes too.

const DENIED =
  Platform.OS === 'ios'
    ? 'Ghostaff no puede usar la cámara. Actívala en Ajustes, Ghostaff, Cámara.'
    : 'Ghostaff no puede usar la cámara. Actívala en los ajustes del móvil, en los permisos de Ghostaff.';
const UNREADABLE = 'No he podido leer esa foto. Prueba con otra.';

export function ShotButton({ onShot, busy, disabled }: { onShot: (shot: ReadyShot) => void; busy: boolean; disabled: boolean }) {
  const [choosing, setChoosing] = useState(false);
  const [problem, setProblem] = useState<{ text: string; settings: boolean } | null>(null);
  const web = Platform.OS === 'web';

  const pick = async (source: 'camera' | 'library') => {
    setChoosing(false);
    setProblem(null);
    try {
      const picked = await pickShot(source);
      if (!picked) return;
      if ('denied' in picked) setProblem({ text: DENIED, settings: true });
      else onShot(picked.shot);
    } catch {
      setProblem({ text: UNREADABLE, settings: false });
    }
  };

  // A screenshot pasted on the web page (⌘V or Ctrl+V) goes as if picked.
  useEffect(() => {
    if (!web || disabled || typeof document === 'undefined') return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      setProblem(null);
      const url = URL.createObjectURL(file);
      readyShot(url)
        .then(onShot, () => setProblem({ text: UNREADABLE, settings: false }))
        .finally(() => URL.revokeObjectURL(url));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [web, disabled, onShot]);

  return (
    <View className="px-5 pt-3">
      {choosing ? (
        <View className="gap-2">
          <Button label="Hacer una foto" variant="secondary" onPress={() => void pick('camera')} />
          <Button label="Elegir una captura" variant="secondary" onPress={() => void pick('library')} />
          <Button label="Cancelar" variant="plain" onPress={() => setChoosing(false)} />
        </View>
      ) : (
        <Button
          label={busy ? 'Mirando tu foto…' : 'Enséñame tu pantalla'}
          icon={Camera}
          variant="secondary"
          busy={busy}
          disabled={disabled}
          onPress={() => (web ? void pick('library') : setChoosing(true))}
        />
      )}
      {web && !busy && !problem ? <Text className="mt-1.5 text-center text-caption text-muted">También puedes pegar aquí una captura.</Text> : null}
      {problem ? (
        <View accessibilityLiveRegion="polite" className="mt-2 items-center">
          <Text className="text-center text-footnote text-no">{problem.text}</Text>
          {problem.settings ? <Button label="Abrir ajustes" variant="plain" size="small" onPress={() => void Linking.openSettings()} /> : null}
        </View>
      ) : null}
    </View>
  );
}
