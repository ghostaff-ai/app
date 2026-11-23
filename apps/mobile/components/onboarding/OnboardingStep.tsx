import type { ReactNode } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import { KeyboardColumn } from '@/lib/keyboard';
import { KeyboardProbe } from './KeyboardProbe';
import { DESKTOP_PAGE, useIsDesktop } from '@/lib/layout';
import type { GhostId } from '@/lib/team';

// One step of the way in (welcome-and-spaces.md): a ghost on top, one question,
// at most one short line, and the main button pinned to the bottom, riding on
// the keyboard. Dots say how far along you are; without `step` there are none
// (a screen reached later, outside the way in).

export function OnboardingStep({
  ghost,
  step,
  of,
  title,
  line,
  children,
  action,
  link,
  topRight,
}: {
  ghost: GhostId;
  step?: number;
  of?: number;
  title: string;
  line?: string;
  children?: ReactNode;
  /** The main button. */
  action: ReactNode;
  /** A quieter way out under it («Unirme a una empresa»). */
  link?: ReactNode;
  /** Top right: «Salir», or a close. */
  topRight?: ReactNode;
}) {
  const desktop = useIsDesktop();
  const { height } = useWindowDimensions();
  const page = desktop ? DESKTOP_PAGE : undefined;

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <KeyboardColumn>
        <View className="min-h-11 flex-row items-center justify-between px-6 pt-2" style={page}>
          {step && of ? <Dots step={step} of={of} /> : <View />}
          {topRight ?? null}
        </View>
        <ScrollView className="flex-1" contentContainerClassName="px-6 pb-6" contentContainerStyle={page} keyboardShouldPersistTaps="handled">
          <View style={{ height: height < 700 ? 160 : 200 }}>
            <GhostViewer ghost={ghost} zoom={1.1} />
          </View>
          <Text accessibilityRole="header" className="mt-2 font-display text-title text-ink">
            {title}
          </Text>
          {line ? <Text className="mt-2 text-base text-muted">{line}</Text> : null}
          {children ? <View className="mt-6">{children}</View> : null}
        </ScrollView>
        <View testID="onboarding-footer" className="gap-1 px-6 pb-4 pt-2" style={page}>
          {action}
          {link ?? null}
        </View>
      </KeyboardColumn>
      <KeyboardProbe />
    </SafeAreaView>
  );
}

function Dots({ step, of }: { step: number; of: number }) {
  return (
    <View accessible accessibilityLabel={`Paso ${step} de ${of}`} className="flex-row gap-1.5">
      {Array.from({ length: of }, (_, i) => (
        <View
          key={i}
          testID="step-dot"
          accessibilityState={{ selected: i < step }}
          className={`h-1 w-6 rounded-full ${i < step ? 'bg-ink' : 'bg-line'}`}
        />
      ))}
    </View>
  );
}
