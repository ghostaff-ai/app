import type { Agent, AiUsageSummary, Connection, LimitWindow } from '@ghostaff/shared';
import { Text, View } from 'react-native';
import { ListRow, ListSection } from '@/components/ui';
import { costLabel, percent, resetLabel, tokensLabel } from '@/lib/connections';
import { shortDate, whenLabel } from '@/lib/format';
import { usePalette } from '@/lib/theme';

// What one AI account used (docs/plans/ready/multiple-ai-accounts.md): a Claude
// subscription's 5-hour and weekly limits as Claude Code last reported them,
// and every account's last 30 days, per day and per agent. Costs are our
// estimate at list price; the bill is the provider's.

/** A subscription's two windows as bars, with when each starts again. */
export function LimitBars({ connection }: { connection: Connection }) {
  const { fiveHour, sevenDay, readAt } = connection.limits;
  if (!fiveHour && !sevenDay)
    return (
      <ListSection header="Límites de tu plan">
        <Text className="px-4 py-3 text-base leading-[22px] text-muted">
          Los verás aquí después de la primera respuesta de un agente con esta suscripción.
        </Text>
      </ListSection>
    );
  return (
    <ListSection
      header="Límites de tu plan"
      footer={`Son los de tu plan entero: cuenta también lo que uses tú en Claude.${readAt ? ` Datos de ${whenLabel(readAt)}.` : ''}`}
    >
      {sevenDay ? <LimitBar testID="limit-week" name="Esta semana" window={sevenDay} /> : null}
      {fiveHour ? <LimitBar testID="limit-5h" name="Últimas 5 horas" window={fiveHour} /> : null}
    </ListSection>
  );
}

function LimitBar({ name, window: w, testID }: { name: string; window: LimitWindow; testID: string }) {
  const c = usePalette();
  const p = percent(w);
  const full = w.status === 'rejected';
  const close = w.status === 'allowed_warning' || (p !== null && p >= 80);
  const color = full ? c.no : close ? c.waiting : c.accent;
  const value = full ? 'Límite alcanzado' : p === null ? 'Dentro del límite' : `${p} %`;
  return (
    <View testID={testID} className="px-4 py-3" accessible accessibilityLabel={`${name}: ${value}`}>
      <View className="flex-row items-baseline justify-between">
        <Text className="text-base text-ink">{name}</Text>
        <Text className={`text-base ${full ? 'text-no' : 'text-muted'}`}>{value}</Text>
      </View>
      <View className="mt-2 h-2 overflow-hidden rounded-full bg-sunk">
        <View style={{ width: `${full ? 100 : (p ?? 0)}%`, backgroundColor: color }} className="h-2 rounded-full" />
      </View>
      {w.resetsAt ? <Text className="mt-1.5 text-footnote text-muted">Se renueva {resetLabel(w.resetsAt)}</Text> : null}
    </View>
  );
}

/** The last 30 days: in numbers, per day and per agent. */
export function UsageDetail({ connection, usage, agents }: { connection: Connection; usage: AiUsageSummary; agents: readonly Agent[] }) {
  const paidByToken = connection.provider !== 'claude';
  return (
    <>
      <ListSection
        header="Últimos 30 días"
        footer={paidByToken && usage.costUsd !== null ? 'El coste es nuestra estimación a precio de lista; la factura real es la del proveedor.' : undefined}
      >
        <ListRow title="Usos" value={`${usage.uses}`} />
        <ListRow title="Tokens" value={tokensLabel(usage.tokens)} />
        {paidByToken && usage.costUsd !== null ? <ListRow title="Coste" value={costLabel(usage.costUsd)} /> : null}
        {usage.failures > 0 ? <ListRow title="Veces que falló" value={`${usage.failures}`} /> : null}
        <ListRow title="Último uso" value={usage.lastAt ? whenLabel(usage.lastAt) : 'Nunca'} />
      </ListSection>
      {usage.byDay.length > 0 ? <DayBars days={usage.byDay} /> : null}
      {usage.byAgent.length > 0 ? (
        <ListSection header="Por agente">
          {usage.byAgent.map((a) => (
            <ListRow
              key={a.agentId ?? 'none'}
              title={agents.find((x) => x.id === a.agentId)?.name ?? 'Un agente que ya no está'}
              value={`${a.uses} ${a.uses === 1 ? 'uso' : 'usos'}`}
            />
          ))}
        </ListSection>
      ) : null}
    </>
  );
}

/** Uses per day for the last 30 days, a bar each, today on the right. */
function DayBars({ days, now = new Date() }: { days: AiUsageSummary['byDay']; now?: Date }) {
  const c = usePalette();
  const all = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(now.getTime() - (29 - i) * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
    return { day, uses: days.find((d) => d.day === day)?.uses ?? 0 };
  });
  const max = Math.max(1, ...all.map((d) => d.uses));
  const busiest = all.reduce((a, b) => (b.uses > a.uses ? b : a));
  return (
    <ListSection header="Por día" footer={`El día con más: ${shortDate(busiest.day)}, ${busiest.uses} ${busiest.uses === 1 ? 'uso' : 'usos'}.`}>
      <View className="h-24 flex-row items-end gap-[3px] px-4 py-3" accessible accessibilityLabel="Usos por día en los últimos 30 días">
        {all.map((d) => (
          <View
            key={d.day}
            className="flex-1 rounded-sm"
            style={{ height: `${d.uses ? Math.max(8, (d.uses / max) * 100) : 4}%`, backgroundColor: d.uses ? c.accent : c.sunk }}
          />
        ))}
      </View>
    </ListSection>
  );
}
