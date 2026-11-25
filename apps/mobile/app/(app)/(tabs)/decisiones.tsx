import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Text, View } from 'react-native';
import { DecisionDeck, DeckToast } from '@/components/DecisionDeck';
import { SealCheck, WarningCircle } from '@/components/icons';
import { SpaceSwitcher } from '@/components/SpaceSwitcher';
import { Button, EmptyState, ErrorText, Loading, Notice, ScreenTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useDeck } from '@/lib/hooks/useDecisions';
import { useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useTabScreenTop } from '@/lib/tabs';

// Decisiones, the middle tab (three-tabs.md, decision 7): what waits for you,
// one card at a time (components/DecisionDeck.tsx). What you put aside comes
// back tomorrow morning, or now if you ask; what was decided is in Empresa,
// Registro, where an answer can still be changed until the agent has it.

export default function Decisiones() {
  const top = useTabScreenTop();
  const desktop = useIsDesktop();
  const { active } = useActiveOrg();
  const { session } = useAuth();
  const deck = useDeck(active?.id ?? null, session?.user.id ?? null);
  const { reload, clearLast } = deck;

  // Back from a decision's own screen: show what changed there.
  useFocusEffect(useCallback(() => void reload(), [reload]));

  if (deck.loading && deck.cards.length === 0 && !deck.last) return <Loading />;
  if (deck.loadError)
    return (
      <Notice
        icon={WarningCircle}
        title="No hemos podido cargar las decisiones"
        body={deck.loadError}
        action={<Button label="Reintentar" variant="secondary" onPress={() => void reload()} />}
      />
    );

  const count = deck.cards.length;
  const toast = deck.last ? <DeckToast move={deck.last} onUndo={() => void deck.undo()} onClose={clearLast} /> : null;
  return (
    <View className="flex-1 bg-surface">
      <View
        className="flex-1 px-5 pb-6"
        style={{ paddingTop: (desktop ? 40 : 12) + top, maxWidth: 480, width: '100%', alignSelf: 'center' }}
      >
        {/* Where you are, on every tab (welcome-and-spaces.md); on a desktop the sidebar shows it. */}
        <SpaceSwitcher />
        <View className="flex-row items-center justify-between">
          <ScreenTitle>Decisiones</ScreenTitle>
          {count > 0 ? <Text className="text-footnote text-muted">{count === 1 ? 'Queda 1' : `Quedan ${count}`}</Text> : null}
        </View>
        <ErrorText>{deck.error}</ErrorText>
        {count > 0 ? (
          <View className="mt-3 flex-1">
            <DecisionDeck cards={deck.cards} asked={deck.asked} onMove={(d, kind, option) => void deck.act(d, kind, option)} toast={toast} />
          </View>
        ) : (
          <View className="flex-1 justify-center">
            <EmptyState
              icon={SealCheck}
              title="Nada que decidir"
              body={
                deck.asideTotal > 0
                  ? `Dejaste ${deck.asideTotal === 1 ? 'una' : deck.asideTotal} para más tarde. Vuelven mañana por la mañana.`
                  : 'Cuando un agente necesite tu OK, lo verás aquí.'
              }
              action={
                deck.asideTotal > 0 ? (
                  <Button testID="deck-show-aside" label="Verlas ahora" variant="secondary" onPress={() => deck.setShowAside(true)} />
                ) : (
                  <Button label="Ver lo decidido" variant="plain" onPress={() => router.push('/empresa/registro')} />
                )
              }
            />
            {toast}
          </View>
        )}
      </View>
    </View>
  );
}
