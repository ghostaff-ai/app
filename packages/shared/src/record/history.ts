import type { RecordAnswer, RecordDecision } from './porDecidir';

// The history of answers to agents' decisions, `agentes/historial-decisiones.csv`
// in Órdago's record: one row per answer, the evidence autonomy per kind is
// earned from. Port of the Órdago panel's lib/historial.ts. Pure.

export const HISTORY_PATH = 'agentes/historial-decisiones.csv';
export const HISTORY_HEADER = 'fecha,agente,tipo,decision,con_nota,dias,id';

export interface HistoryRow {
  fecha: string;
  agente: string;
  tipo: string;
  decision: 'ok' | 'no';
  conNota: boolean;
  dias: number;
  id: string;
}

const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000));

export function historyRow(d: RecordDecision, a: RecordAnswer): HistoryRow {
  return { fecha: a.fecha, agente: d.propone, tipo: d.tipo, decision: a.decision, conNota: !!a.nota?.trim(), dias: daysBetween(d.creada, a.fecha), id: d.id };
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The CSV with the row appended; `csv` empty or null when the file does not exist yet. */
export function appendHistoryRow(csv: string | null, row: HistoryRow): string {
  const base = csv?.trim() ? csv.replace(/\n*$/, '\n') : `${HISTORY_HEADER}\n`;
  if (!base.startsWith(HISTORY_HEADER)) throw new Error(`${HISTORY_PATH}: unexpected header`);
  return (
    base +
    [row.fecha, row.agente, row.tipo, row.decision, row.conNota ? 'si' : 'no', String(row.dias), row.id].map(cell).join(',') +
    '\n'
  );
}
