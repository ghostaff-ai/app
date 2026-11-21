import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';

// Órdago's agents as Ghostaff agents (docs/plans/ongoing/ordago-agents-in-ghostaff.md,
// step 2): each `proyectos/<proyecto>/agentes/<agente>.yaml` of ghostaff-ai/agents
// becomes a row in `agents` that runs as its job (`ordago_job`), with the
// department and ghost Álvaro chose (2026-11-21). With `runner: 'ghostaff'`
// (step 5) it runs on Ghostaff's own runner instead, with its task, model,
// tools, turns and timetable copied from its yaml. Worked out without the
// database, so it can be tested.

/** Álvaro, 2026-11-21: five departments; `prueba` stays out. */
const PLACES: Record<string, { name: string; ghost: string; department: string }> = {
  direccion: { name: 'Dirección', ghost: 'base', department: 'direccion' },
  correo: { name: 'Correo', ghost: 'secretaria', department: 'direccion' },
  finanzas: { name: 'Finanzas', ghost: 'finanzas', department: 'finanzas' },
  legal: { name: 'Legal', ghost: 'base', department: 'legal' },
  producto: { name: 'Producto', ghost: 'base', department: 'producto' },
  desarrollo: { name: 'Desarrollo', ghost: 'base', department: 'producto' },
  comercial: { name: 'Comercial', ghost: 'base', department: 'marketing' },
  organico: { name: 'Orgánico', ghost: 'redes', department: 'marketing' },
  seo: { name: 'SEO', ghost: 'redes', department: 'marketing' },
  productor: { name: 'Productor', ghost: 'productor', department: 'marketing' },
  lamesa: { name: 'La Mesa', ghost: 'productor', department: 'marketing' },
};

export const LEFT_OUT = new Set(['prueba']);

interface ImportedBase {
  slug: string;
  name: string;
  ghost: string;
  department: string;
  description: string | null;
  schedule: string | null;
}

/** Still its job in Órdago's project (step 2). */
export interface ImportedJobAgent extends ImportedBase {
  runner: 'ordago_job';
  job_project: string;
  job_region: string;
  job_name: string;
  job_identity: string;
}

/** On Ghostaff's own runner (step 5): its task, model, tools and turns from its yaml; no job. */
export interface ImportedRunnerAgent extends ImportedBase {
  runner: 'ghostaff';
  task: string;
  model: string;
  tools: string[];
  max_turns: number;
  job_project: null;
  job_region: null;
  job_name: null;
  job_identity: null;
}

export type ImportedAgent = ImportedJobAgent | ImportedRunnerAgent;

export interface ImportOptions {
  /** `ghostaff`: the agents imported run on our runner instead of their job. */
  runner?: 'ghostaff';
  /** Only these slugs. */
  only?: string[];
}

type AgentYaml = { descripcion?: string; horario?: string; prompt?: string; modelo?: string; herramientas?: unknown; max_turnos?: number };

function onOurRunner(slug: string, a: AgentYaml): Pick<ImportedRunnerAgent, 'task' | 'model' | 'tools' | 'max_turns'> {
  const tools = Array.isArray(a.herramientas) ? a.herramientas.filter((t): t is string => typeof t === 'string') : [];
  if (typeof a.prompt !== 'string' || !a.prompt.trim()) throw new Error(`${slug}.yaml has no prompt`);
  if (typeof a.modelo !== 'string' || !a.modelo) throw new Error(`${slug}.yaml has no modelo`);
  if (tools.length === 0) throw new Error(`${slug}.yaml has no herramientas`);
  return { task: a.prompt.trim(), model: a.modelo, tools, max_turns: Number.isInteger(a.max_turnos) && a.max_turnos! > 0 ? a.max_turnos! : 100 };
}

/** «dice qué dice la ley…» → «Dice qué dice la ley…», on one line. */
function sentence(s: unknown): string | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = s.replace(/\s+/g, ' ').trim().slice(0, 1000);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The agents of one project folder (`…/agents/proyectos/ordago`). */
export function readProjectAgents(projectDir: string, opts: ImportOptions = {}): ImportedAgent[] {
  const project = basename(projectDir);
  const conf = parse(readFileSync(join(projectDir, 'proyecto.yaml'), 'utf8')) as { gcp?: { proyecto?: string; region?: string } };
  const gcp = conf.gcp?.proyecto;
  const region = conf.gcp?.region;
  if (!gcp || !region) throw new Error(`${projectDir}/proyecto.yaml has no gcp.proyecto and gcp.region`);
  const dir = join(projectDir, 'agentes');
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.slice(0, -'.yaml'.length))
    .filter((slug) => !LEFT_OUT.has(slug) && (!opts.only || opts.only.includes(slug)))
    .sort()
    .map((slug): ImportedAgent => {
      const a = parse(readFileSync(join(dir, `${slug}.yaml`), 'utf8')) as AgentYaml;
      const place = PLACES[slug] ?? { name: slug.charAt(0).toUpperCase() + slug.slice(1), ghost: 'base', department: 'direccion' };
      const base = { slug, ...place, description: sentence(a.descripcion), schedule: typeof a.horario === 'string' ? a.horario : null };
      if (opts.runner === 'ghostaff') {
        return { ...base, runner: 'ghostaff', ...onOurRunner(slug, a), job_project: null, job_region: null, job_name: null, job_identity: null };
      }
      const job = `${project}-${slug}`;
      return {
        ...base,
        runner: 'ordago_job' as const,
        job_project: gcp,
        job_region: region,
        job_name: job,
        job_identity: `${job}@${gcp}.iam.gserviceaccount.com`,
      };
    });
}
