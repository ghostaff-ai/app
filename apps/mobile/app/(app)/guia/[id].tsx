import { type AccountProvider, fieldsFor, type GuideField, type GuideStatus, type GuideStep } from '@ghostaff/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { close } from '@/components/CloseButton';
import { GuideBlocks } from '@/components/guide/GuideBlocks';
import { ShotButton } from '@/components/guide/ShotButton';
import { Button, ErrorText, Loading, Notice } from '@/components/ui';
import { stepAction } from '@/lib/guide';
import { useAccountConnect } from '@/lib/hooks/useAccountConnect';
import { type FieldError, useGuide } from '@/lib/hooks/useGuide';
import { KeyboardForm } from '@/lib/keyboard';
import { DESKTOP_PAGE, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// A guide (docs/plans/ready/guided-access.md), opened from its card in the chat.
// A fixed shell around dynamic content: on top the goal and the progress, in
// the middle the step the guide's model wrote (GuideBlocks), at the bottom,
// always while it goes on, «Enséñame tu pantalla». Leaving keeps the guide
// where it is: the card's «Empezar» opens it on the same step. What the person
// typed stays on this screen only, and a secret leaves it only in the check.
// An owner opens a member's checked guide here (from its card or from
// Conexiones, even when its conversation is the member's own) to approve it.

/** One dot per step shown so far, the last one being this one: the total isn't known. */
function Dots({ steps }: { steps: number }) {
  if (steps < 1) return null;
  return (
    <View accessible accessibilityLabel={`Paso ${steps}`} className="mt-2 flex-row flex-wrap gap-1.5">
      {Array.from({ length: steps }, (_, i) => (
        <View key={i} className={`h-2 rounded-full ${i === steps - 1 ? 'w-5 bg-accent' : 'w-2 bg-muted'}`} />
      ))}
    </View>
  );
}

/**
 * Where the guide stands once it no longer asks for anything: for an owner who
 * may approve it, what approving does; for one who just decided, what they decided.
 */
function outcome(
  status: GuideStatus,
  blockedReason: string | null,
  mayApprove: boolean,
  decided: 'approve' | 'reject' | null,
): { text: string; tone: 'ok' | 'muted' | 'no' } | null {
  if (decided === 'approve') return { text: 'Aprobado: el agente ya tiene el acceso y sigue en la conversación.', tone: 'ok' };
  if (decided === 'reject') return { text: 'Rechazado: el agente no tiene este acceso.', tone: 'muted' };
  switch (status) {
    case 'checked':
      return mayApprove
        ? { text: 'Funciona. Si lo apruebas, el agente tendrá este acceso y seguirá con lo que le pidieron.', tone: 'muted' }
        : { text: 'Funciona. Falta que lo apruebe quien es propietario; entonces el agente sigue con lo que le pediste.', tone: 'muted' };
    case 'done':
      return { text: 'Funciona. El agente sigue con lo que le pediste en la conversación.', tone: 'ok' };
    case 'rejected':
      return { text: 'Quien es propietario lo ha rechazado: el agente no tiene este acceso.', tone: 'muted' };
    case 'blocked':
      return { text: blockedReason ?? 'Esta guía no puede seguir.', tone: 'no' };
    case 'handed_over':
      return { text: 'Mejor con su conexión directa: se conecta desde la conversación o desde Conexiones.', tone: 'muted' };
    default:
      return null;
  }
}

/** What the check needs that this step has no block for: typed on a step this device no longer has, or what the check complained about. */
function missingFields(step: GuideStep, auth: Parameters<typeof fieldsFor>[0], values: Partial<Record<GuideField, string>>, fieldError: FieldError | null): GuideField[] {
  if (stepAction(step) !== 'check') return [];
  const asked = new Set(step.blocks.flatMap((b) => (b.type === 'field' || b.type === 'secret' ? [b.field] : [])));
  return fieldsFor(auth).filter((f) => !asked.has(f) && (!values[f]?.trim() || fieldError?.field === f));
}

export default function Guia() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const g = useGuide(id ?? null);
  const { connect } = useAccountConnect(orgId);
  const desktop = useIsDesktop();
  const [someoneElse, setSomeoneElse] = useState(false);

  const runConnect = useCallback(
    async (provider: string) => {
      const note = await connect(provider as AccountProvider, `guia/${id}`);
      return note && !note.ok ? note.text : null;
    },
    [connect, id],
  );

  if (g.view === undefined) return <Loading />;
  if (!g.view) {
    const problem = g.loadProblem ?? { title: 'No hemos podido abrir esta guía.', retry: true };
    return (
      <Notice
        title={problem.title}
        body={problem.body}
        action={problem.retry ? <Button label="Reintentar" onPress={g.reload} /> : <Button label="Volver" variant="secondary" onPress={close} />}
      />
    );
  }

  const { view, step } = g;
  const action = step ? stepAction(step) : null;
  const going = g.status === 'open' && action !== 'finished';
  const preparing = g.busy === 'step' || g.busy === 'photo';
  const approving = view.mayApprove && g.status === 'checked';
  const end = outcome(g.status, step?.blocked ?? view.blockedReason, view.mayApprove, g.decided);
  const toneClass = { ok: 'text-ok', muted: 'text-muted', no: 'text-no' } as const;

  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen options={{ title: view.app }} />
      <KeyboardForm
        footer={
          going ? (
            <View style={desktop ? DESKTOP_PAGE : undefined}>
              <ShotButton onShot={(s) => void g.sendPhoto(s)} busy={g.busy === 'photo'} disabled={g.busy !== null} />
            </View>
          ) : undefined
        }
      >
        <View className="px-5 pb-8 pt-4" style={desktop ? DESKTOP_PAGE : undefined}>
          <Text className="font-display-medium text-title3 text-ink" numberOfLines={1}>
            {view.goal}
          </Text>
          <Dots steps={g.steps} />

          {preparing ? (
            <View accessibilityLiveRegion="polite" className="mt-10 flex-row items-center justify-center gap-2">
              <ActivityIndicator />
              <Text className="text-base text-muted">{g.busy === 'photo' ? 'Mirando tu foto…' : 'Preparando el siguiente paso…'}</Text>
            </View>
          ) : step && (going || action === 'finished' || action === 'connector') ? (
            <GuideBlocks
              step={step}
              values={g.values}
              onValue={g.setValue}
              fieldError={g.fieldError}
              shot={g.shot}
              busy={g.busy}
              onAnswer={(a) => void g.answer(a)}
              onCheck={() => void g.check()}
              missing={missingFields(step, view.auth, g.values, g.fieldError)}
              connector={{ canConnect: active?.role === 'owner', run: runConnect }}
            />
          ) : null}

          {g.error ? (
            <View accessibilityLiveRegion="polite">
              <ErrorText>{g.error}</ErrorText>
              {g.retryable ? (
                <View className="mt-2">
                  <Button label="Reintentar" variant="secondary" size="small" onPress={g.retry} />
                </View>
              ) : null}
            </View>
          ) : null}

          {!going && !preparing ? (
            <View className="mt-6">
              {end ? <Text className={`text-base ${toneClass[end.tone]}`}>{end.text}</Text> : null}
              {step?.done ? <Text className="mt-3 text-footnote text-muted">Para quitarle el acceso más adelante: {step.done.undo}</Text> : null}
              {approving ? (
                <View className="mt-6 gap-2">
                  <Button label="Aprobar" busy={g.busy === 'approve'} disabled={g.busy !== null} onPress={() => void g.decide('approve')} />
                  <Button label="Rechazar" variant="secondary" busy={g.busy === 'reject'} disabled={g.busy !== null} onPress={() => void g.decide('reject')} />
                  {g.decideError ? (
                    <View accessibilityLiveRegion="polite">
                      <ErrorText>{g.decideError}</ErrorText>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View className="mt-6">
                  <Button label={g.decided ? 'Volver' : 'Volver a la conversación'} onPress={close} />
                </View>
              )}
            </View>
          ) : null}

          {going ? (
            <View className="mt-8 items-start gap-1">
              <Button label="Que lo haga otra persona" variant="plain" size="small" onPress={() => setSomeoneElse((v) => !v)} />
              {someoneElse ? (
                <Text className="mb-2 px-4 text-footnote text-muted">
                  Pide a quien tenga la cuenta que abra esta conversación y pulse «Empezar». Seguirá desde este paso.
                </Text>
              ) : null}
              <Button label="Más tarde" variant="plain" size="small" onPress={close} />
            </View>
          ) : null}
        </View>
      </KeyboardForm>
    </View>
  );
}
