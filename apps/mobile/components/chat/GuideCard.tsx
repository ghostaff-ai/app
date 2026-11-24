import { type CatalogueConnector, CONNECTORS, type GuidePart } from '@ghostaff/shared';
import { type ReactNode, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { ConnectorLogo } from '@/components/connections/ConnectorLogo';
import { eitherOf } from '@/lib/guide';
import type { GuideControls } from '@/lib/hooks/useGuideCards';

// An agent asking, with a guide, for access to an app the catalogue lacks
// (docs/plans/ready/guided-access.md), drawn like AccountAskCard. Anyone who
// writes in the conversation may do the guide (decision 2); what a member
// grants waits for an owner's «Aprobar». Once done, the card says who did it,
// and who approved it.

const catalogue = (id: string | undefined) => (id ? ((CONNECTORS as readonly CatalogueConnector[]).find((c) => c.id === id) ?? null) : null);

function statusLine(guide: GuidePart, resuming: boolean): { text: string; tone: 'ok' | 'muted' } | null {
  switch (guide.status) {
    case 'checked':
      return guide.doneBy ? { text: `Hecho por ${guide.doneBy}`, tone: 'muted' } : null;
    case 'done': {
      if (resuming) return { text: 'Ya está. Sigo con ello…', tone: 'muted' };
      const by = guide.doneBy ? `Hecho por ${guide.doneBy}` : 'Hecho';
      return { text: guide.decidedBy && guide.decidedBy !== guide.doneBy ? `${by} · aprobado por ${guide.decidedBy}` : by, tone: 'ok' };
    }
    case 'rejected':
      return { text: guide.decidedBy ? `Rechazado por ${guide.decidedBy}` : 'Rechazado', tone: 'muted' };
    case 'blocked':
      return { text: guide.blockedReason ?? 'Esta guía no puede seguir.', tone: 'muted' };
    default:
      return null;
  }
}

function CardButton({ label, onPress, busy, disabled, quiet }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; quiet?: boolean }) {
  const off = !!busy || !!disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!busy, disabled: off }}
      disabled={off}
      onPress={onPress}
      className={`min-h-[44px] flex-1 items-center justify-center rounded-full px-3 py-2 ${quiet ? 'border border-line bg-surface' : 'bg-accent'} ${off && !busy ? 'opacity-40' : 'active:opacity-70'}`}
    >
      {busy ? <ActivityIndicator size="small" /> : <Text className={`text-footnote font-semibold ${quiet ? 'text-ink' : 'text-on-accent'}`}>{label}</Text>}
    </Pressable>
  );
}

export function GuideCard({ guide, controls, writing = false }: { guide: GuidePart; controls?: GuideControls; writing?: boolean }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | 'connect' | null>(null);
  // One decision at a time: a second tap (on either button) before the first re-renders is dropped.
  const running = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const handedTo = guide.status === 'handed_over' ? catalogue(guide.connector) : null;
  const status = statusLine(guide, !!controls?.resuming(guide.guideId));
  const title = handedTo ? `Mejor con el botón de ${handedTo.name}` : `Necesito acceso a ${guide.app}`;
  // Nothing to press while the agent is still writing the message that carries the card.
  const live = !!controls && !writing;

  const run = async (kind: 'approve' | 'reject' | 'connect') => {
    if (!controls || running.current) return;
    running.current = true;
    setBusy(kind);
    setError(null);
    try {
      setError(kind === 'connect' ? await controls.connect(handedTo?.id ?? '') : await controls.decide(guide.guideId, kind));
    } catch {
      setError('No se ha podido. Inténtalo otra vez.');
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  let actions: ReactNode = null;
  let note: string | null = null;
  if (live && controls) {
    if (guide.status === 'open') {
      if (controls.canTalk) actions = <CardButton label="Empezar" onPress={() => controls.open(guide.guideId)} />;
      else note = 'Lo hace quien escribe en esta conversación.';
    } else if (guide.status === 'checked') {
      if (controls.isOwner)
        actions = (
          <>
            <CardButton label="Aprobar" busy={busy === 'approve'} disabled={busy !== null} onPress={() => void run('approve')} />
            <CardButton label="Rechazar" quiet busy={busy === 'reject'} disabled={busy !== null} onPress={() => void run('reject')} />
          </>
        );
      else note = controls.owners.length ? `Falta que lo apruebe ${eitherOf(controls.owners)}` : 'Falta que lo apruebe quien es propietario';
    } else if (handedTo) {
      if (controls.isOwner) actions = <CardButton label={`Conectar ${handedTo.name}`} busy={busy === 'connect'} onPress={() => void run('connect')} />;
      else note = `Lo conecta quien es propietario${controls.owners.length ? `: ${controls.owners.join(', ')}` : ''}.`;
    }
  }

  return (
    <View className="mt-2 rounded-xl border border-line bg-card p-3" accessibilityLabel={`${title}. ${guide.why}`}>
      <View className="flex-row items-center">
        <ConnectorLogo id={handedTo?.id ?? ''} name={handedTo?.name ?? guide.app} size={28} />
        <Text className="ml-2.5 flex-1 text-footnote font-semibold text-ink">{title}</Text>
      </View>
      {guide.why ? <Text className="mt-1.5 text-caption text-muted">{guide.why}</Text> : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" className={`mt-2 text-caption ${status.tone === 'ok' ? 'text-ok' : 'text-muted'}`}>
          {status.text}
        </Text>
      ) : null}
      {actions ? <View className="mt-3 flex-row gap-2">{actions}</View> : null}
      {note ? <Text className="mt-2 text-caption text-muted">{note}</Text> : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" className="mt-2 text-caption text-no">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
