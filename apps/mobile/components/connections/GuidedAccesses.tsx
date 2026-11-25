import type { Agent, Connection } from '@ghostaff/shared';
import { EngineError, type EngineAccess, getGuidedAccessUndo, removeGuidedAccess } from '@ghostaff/shared/services';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, ListRow } from '@/components/ui';

// «Accesos de tus agentes» in Conexiones (docs/plans/ongoing/guided-access.md): the
// agent's own user or key in an app, given through a guide. Every member sees
// them (the connections' read policy); only an owner gets «Quitar». Removing
// shows first how to remove the user in the app's own tool (the guide's `undo`),
// because taking the credential away from Ghostaff does not delete that user.

/** Why the undo text or the removal didn't go through, in plain Spanish. */
export function guidedAccessError(e: unknown, step: 'read' | 'remove'): string {
  const code = e instanceof EngineError ? e.code : 'failed';
  if (code === 'unreachable') return 'No hay conexión. Comprueba tu internet y prueba otra vez.';
  if (code === 'not_owner') return 'Solo quien es propietario puede quitar un acceso.';
  if (code === 'not_found') return 'Este acceso ya no existe. Actualiza la pantalla.';
  return step === 'read'
    ? 'No hemos podido cargar cómo quitarlo. Prueba otra vez.'
    : 'No hemos podido quitar el acceso. Sigue donde estaba: prueba otra vez.';
}

type Confirm = { state: 'loading' } | { state: 'ready'; undo: string | null } | { state: 'removing'; undo: string | null } | { state: 'error'; message: string; undo?: string | null };

function GuidedRow({
  conn,
  agent,
  agentsLoading,
  owner,
  engine,
  onRemoved,
}: {
  conn: Connection;
  agent: Agent | undefined;
  /** The agents are still being read: not finding this one yet says nothing about it. */
  agentsLoading: boolean;
  owner: boolean;
  engine: EngineAccess | null;
  onRemoved: () => void;
}) {
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const app = conn.settings.app ?? 'una aplicación';
  // Until the agents are read, no name: a live agent must not read as gone.
  const who = agent ? agent.name : agentsLoading ? null : 'Un agente que ya no está';
  const whoText = who ?? 'El agente';

  const open = async () => {
    if (!engine) return;
    setConfirm({ state: 'loading' });
    try {
      setConfirm({ state: 'ready', undo: (await getGuidedAccessUndo(engine, conn.id)).undo });
    } catch (e) {
      setConfirm({ state: 'error', message: guidedAccessError(e, 'read') });
    }
  };
  const remove = async (undo: string | null) => {
    if (!engine) return;
    setConfirm({ state: 'removing', undo });
    try {
      await removeGuidedAccess(engine, conn.id);
      onRemoved();
    } catch (e) {
      setConfirm({ state: 'error', message: guidedAccessError(e, 'remove'), undo });
    }
  };

  const undo = confirm && 'undo' in confirm ? confirm.undo : undefined;
  return (
    <View testID={`guided-${conn.id}`}>
      <ListRow
        title={app}
        subtitle={[who, conn.hint].filter(Boolean).join(' · ') || null}
        trailing={
          owner && !confirm ? <Button testID={`guided-remove-${conn.id}`} label="Quitar" variant="plain" size="small" onPress={() => void open()} /> : undefined
        }
      />
      {confirm ? (
        <View className="px-4 pb-4" testID={`guided-confirm-${conn.id}`}>
          {confirm.state === 'loading' ? (
            <Text className="text-footnote text-muted">Un momento…</Text>
          ) : confirm.state === 'error' && undo === undefined ? (
            <Text className="text-footnote text-no">{confirm.message}</Text>
          ) : (
            <>
              <Text className="text-footnote text-muted">
                {`${whoText} dejará de poder entrar en ${app}. Su usuario sigue en ${app}: quítalo también allí.`}
              </Text>
              {undo ? <Text className="mt-2 text-base text-ink">{undo}</Text> : null}
              {confirm.state === 'error' ? <Text className="mt-2 text-footnote text-no">{confirm.message}</Text> : null}
            </>
          )}
          {confirm.state !== 'loading' ? (
            <View className="mt-3 flex-row gap-2">
              {confirm.state === 'ready' || confirm.state === 'removing' || (confirm.state === 'error' && undo !== undefined) ? (
                <Button
                  testID={`guided-confirm-remove-${conn.id}`}
                  label="Quitar acceso"
                  variant="danger"
                  size="small"
                  busy={confirm.state === 'removing'}
                  onPress={() => void remove(undo ?? null)}
                />
              ) : null}
              <Button label="Cancelar" variant="secondary" size="small" disabled={confirm.state === 'removing'} onPress={() => setConfirm(null)} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** The rows of the section, one per access. */
export function guidedRows(props: { items: Connection[]; agents: Agent[]; agentsLoading: boolean; owner: boolean; engine: EngineAccess | null; onRemoved: () => void }) {
  return props.items.map((conn) => (
    <GuidedRow
      key={conn.id}
      conn={conn}
      agent={props.agents.find((a) => a.id === conn.agentId)}
      agentsLoading={props.agentsLoading}
      owner={props.owner}
      engine={props.engine}
      onRemoved={props.onRemoved}
    />
  ));
}
