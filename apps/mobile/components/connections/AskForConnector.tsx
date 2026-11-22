import type { ConnectorRequest } from '@ghostaff/shared/services';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, ErrorText, Field } from '@/components/ui';

// Asking for a connector Conexiones does not list (docs/plans/ongoing/connectors.md,
// phase 0): what organisations ask for most is what we build next. When the
// search finds nothing it offers to ask for exactly that; otherwise, at the end
// of the list, anyone can name the app they miss. Any member may ask, not only
// owners: asking changes nothing in the organisation.

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function AskForConnector({
  searched,
  asked,
  onAsk,
}: {
  /** What the person typed in the search box, when it found nothing; '' otherwise. */
  searched: string;
  asked: ConnectorRequest[];
  onAsk: (name: string) => Promise<void>;
}) {
  const wanted = searched.trim();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      await onAsk(name);
      setDone(name);
      setTyped('');
    } catch {
      setError('No se ha podido apuntar. Prueba otra vez.');
    } finally {
      setBusy(false);
    }
  };

  const already = wanted ? asked.find((r) => same(r.name, wanted)) : undefined;

  return (
    <View className="mt-6 rounded-2xl border border-line bg-card p-4">
      {wanted ? (
        <>
          <Text className="text-base font-semibold text-ink">Aún no tenemos «{wanted}».</Text>
          {already || (done && same(done, wanted)) ? (
            <Text className="mt-2 text-sm text-ok">
              {done && same(done, wanted) ? 'Apuntado. Avisaremos cuando esté.' : 'Ya la habéis pedido. Avisaremos cuando esté.'}
            </Text>
          ) : (
            <>
              <Text className="mt-1 text-sm text-muted">Pídela y la tendremos en cuenta: lo que más se pide es lo siguiente que conectamos.</Text>
              <View className="mt-3">
                <Button label={`Pedir ${wanted}`} onPress={() => void ask(wanted)} busy={busy} />
              </View>
            </>
          )}
        </>
      ) : (
        <>
          <Text className="text-base font-semibold text-ink">¿Falta alguna?</Text>
          <Text className="mt-1 text-sm text-muted">Dinos qué aplicación usáis y la tendremos en cuenta: lo que más se pide es lo siguiente que conectamos.</Text>
          <Field label="¿Qué aplicación usáis?" placeholder="Glovo, Factusol, Agora…" value={typed} onChangeText={setTyped} maxLength={80} />
          <View className="mt-3">
            <Button label="Pedirla" onPress={() => void ask(typed.trim())} busy={busy} disabled={!typed.trim()} />
          </View>
          {done ? <Text className="mt-2 text-sm text-ok">Apuntado. Avisaremos cuando esté.</Text> : null}
        </>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {asked.length > 0 ? (
        <Text className="mt-3 text-sm text-muted">Ya pedidas: {asked.map((r) => `${r.name} (${r.requestedByName})`).join(', ')}</Text>
      ) : null}
    </View>
  );
}
