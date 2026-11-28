import { type AccountAskPart, type CatalogueConnector, CONNECTORS } from '@ghostaff/shared';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import type { AskControls } from '@/lib/hooks/useAccountAsks';

// An agent asking for an account it lacks (docs/plans/ongoing/connector-in-
// chat.md): what it needs and why, and one button for whoever can get it. An
// owner connects it (or gives it to the agent) right here; anyone else reads who
// can. An app we can't connect yet can be asked for. Once it's there, the agent
// goes on in a new message and the card says who made it possible.

const catalogue = (id: string | undefined) => (id ? ((CONNECTORS as readonly CatalogueConnector[]).find((c) => c.id === id) ?? null) : null);

function titleOf(ask: AccountAskPart): string {
  switch (ask.need) {
    case 'reconnect':
      return `${ask.name} ya no me da acceso`;
    case 'grant':
      return `${ask.name} está conectada, pero no la tengo`;
    case 'unsupported':
      return `Todavía no podemos conectar ${ask.name}`;
    default:
      return `Necesito acceso a ${ask.name}`;
  }
}

function buttonOf(ask: AccountAskPart): string {
  switch (ask.need) {
    case 'reconnect':
      return 'Volver a conectar';
    case 'grant':
      return 'Darle acceso';
    case 'unsupported':
      return 'Pedirlo';
    default:
      return `Conectar ${ask.name}`;
  }
}

/** Who can do it, for someone who can't; null when the viewer can. */
function whoCan(ask: AccountAskPart, controls: AskControls): string | null {
  if (ask.need === 'unsupported' || controls.canConnect) return null;
  const who = controls.owners.length ? `: ${controls.owners.join(', ')}` : '';
  return ask.need === 'grant' ? `Se lo da quien es propietario${who}.` : `Lo conecta quien es propietario${who}.`;
}

export function AccountAskCard({ ask, controls, writing = false }: { ask: AccountAskPart; controls?: AskControls; writing?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connector = catalogue(ask.connector);
  const done = ask.status === 'done';
  const requested = ask.need === 'unsupported' && !!controls?.requested(ask.name);
  const resuming = !done && !!controls?.resuming(ask.askId);
  const cannot = controls ? whoCan(ask, controls) : null;
  const canPress = !!controls && !done && !writing && !requested && !resuming && cannot === null;

  const press = async () => {
    if (!controls) return;
    setBusy(true);
    setError(null);
    try {
      setError(await controls.act(ask));
    } catch {
      setError('No se ha podido. Inténtalo otra vez.');
    } finally {
      setBusy(false);
    }
  };

  const status = done
    ? `${ask.need === 'grant' ? 'Acceso dado' : 'Conectada'}${ask.doneBy ? ` por ${ask.doneBy}` : ''}`
    : requested
      ? 'Pedido. Contamos cada petición para decidir qué conectar después.'
      : resuming
        ? 'Ya está. Sigo con ello…'
        : null;

  return (
    <View className="mt-2 rounded-xl border border-line bg-card p-3" accessibilityLabel={`${titleOf(ask)}. ${ask.why}`}>
      <View className="flex-row items-center">
        <ConnectorLogo id={ask.connector ?? ''} name={ask.name} size={28} />
        <Text className="ml-2.5 shrink text-footnote font-semibold text-ink">{titleOf(ask)}</Text>
      </View>
      {ask.why ? <Text className="mt-1.5 text-caption text-muted">{ask.why}</Text> : null}
      {connector?.before && ask.need === 'connect' && !done && cannot === null ? <Text className="mt-1 text-caption text-muted">{connector.before}</Text> : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" className={`mt-2 text-caption ${done ? 'text-ok' : 'text-muted'}`}>
          {status}
        </Text>
      ) : null}
      {canPress ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void press()}
          className="mt-3 min-h-[44px] items-center justify-center rounded-full bg-accent px-3 py-2"
        >
          {busy ? <ActivityIndicator size="small" /> : <Text className="text-footnote font-semibold text-on-accent">{buttonOf(ask)}</Text>}
        </Pressable>
      ) : null}
      {cannot && !done ? <Text className="mt-2 text-caption text-muted">{cannot}</Text> : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" className="mt-2 text-caption text-no">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
