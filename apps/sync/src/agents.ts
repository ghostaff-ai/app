import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type AgentRepo, type AgentSecrets, isSecretEnv, isSecretName } from '@ghostaff/shared/record';
import { parse } from 'yaml';

// Órdago's agents as Ghostaff agents (docs/plans/ongoing/ordago-agents-in-ghostaff.md,
// step 2): each `proyectos/<proyecto>/agentes/<agente>.yaml` of ghostaff-ai/agents
// becomes a row in `agents` that runs as its job (`ordago_job`), with the
// department and ghost Álvaro chose (2026-11-21). With `runner: 'ghostaff'`
// (step 5) it runs on Ghostaff's own runner instead, with its task, model,
// tools, turns and timetable copied from its yaml, and the limits its legacy
// start-up gave it (item 4 of «What Ghostaff builds for it»):
// - `recursos.timeout` is its runs' timeout; `recursos.cpu`/`memoria` pick the
//   runner's job size (Cloud Run cannot size one execution). `reintentos` is
//   left out: a run's nonce gives its spec once, so a retry could not start;
//   a run that fails says so, and a person asks again.
// - `ritmo` is its cap of runs a day and its CI rule.
// - `prohibidas` only leave `herramientas`: our runner starts Claude Code with
//   `--permission-mode dontAsk --allowedTools <herramientas>`, which denies
//   every tool not listed (tried 2026-11-26: WebFetch and WebSearch denied,
//   also inside a subagent), so there is no list of forbidden ones to keep.
// Worked out without the database, so it can be tested.

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
  /**
   * Its yaml's `repos` besides the record (the project's `cerebro`): read-only, unless named in `--writes`
   * (pushes to any branch but `main` and `beta`) or in its `push_a_main` (`main` too).
   */
  repos: AgentRepo[];
  /**
   * Whether its runs read the other agents' runs (Ghostaff's transcripts): when its yaml's `gcp` granted it the
   * project's transcripts bucket, as Dirección's does for its weekly review.
   */
  reads_org_runs: boolean;
  /** `recursos.timeout`, in seconds. */
  timeout_seconds: number;
  /** From `recursos.cpu` and `memoria`: `large` past 2 CPU or 4 GiB. */
  size: 'standard' | 'large';
  /** `ritmo.max_ejecuciones_por_dia`. */
  max_runs_per_day: number | null;
  /** `ritmo.repo_ci` and `max_ci_en_cola`. */
  ci_repo: string | null;
  max_ci_queued: number | null;
  /** Its yaml's `secretos`: each variable → the organisation's secret it becomes (`org set-secret`), named without the project's prefix. */
  secrets: AgentSecrets;
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
  /**
   * Repos these agents may push to (not `main` or `beta`): the yamls don't say, since the old jobs could
   * write every repo they cloned, so whoever moves them names it (SEO and Producto push to `ordago-apps`).
   */
  writes?: string[];
  /** No timetable: they run only when someone writes to them (while their old job keeps the timetable). */
  onDemand?: boolean;
}

type AgentYaml = {
  descripcion?: string;
  horario?: string;
  prompt?: string;
  modelo?: string;
  herramientas?: unknown;
  max_turnos?: number;
  repos?: unknown;
  push_a_main?: unknown;
  gcp?: unknown;
  prohibidas?: unknown;
  recursos?: { cpu?: unknown; memoria?: unknown; timeout?: unknown };
  ritmo?: { max_ejecuciones_por_dia?: unknown; repo_ci?: unknown; max_ci_en_cola?: unknown };
  secretos?: unknown;
};

type ProjectYaml = { cerebro?: string; gcp?: { proyecto?: string; region?: string; bucket_transcripciones?: string } };

/** The longest run the runner's jobs allow (scripts/deploy-runner.sh, --task-timeout). */
const MAX_TIMEOUT_SECONDS = 10_800;
const DEFAULT_TIMEOUT_SECONDS = 3600;

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((t): t is string => typeof t === 'string') : []);

/** The repos it clones besides the record: read-only unless named in `writes`, or in its `push_a_main` (main too). */
function otherRepos(a: AgentYaml, record: string, writes: string[]): AgentRepo[] {
  const toMain = new Set(strings(a.push_a_main).map((r) => r.toLowerCase()));
  const write = new Set(writes.map((r) => r.toLowerCase()));
  return [...new Set(strings(a.repos))]
    .filter((r) => r.toLowerCase() !== record.toLowerCase())
    .map((repo) => {
      const main = toMain.has(repo.toLowerCase());
      return main ? { repo, write: true, main: true } : { repo, write: write.has(repo.toLowerCase()) };
    });
}

/** Whether the agent's yaml grants it the project's transcripts bucket: in the old system, reading the other agents' runs. */
function readsTranscripts(a: AgentYaml, bucket: string | undefined): boolean {
  if (!bucket || !Array.isArray(a.gcp)) return false;
  return a.gcp.some((g: { recursos?: unknown }) => strings(g?.recursos).includes(`bucket:${bucket}`));
}

/** `10800s` → 10800, within what the jobs allow. */
function timeoutOf(slug: string, r: AgentYaml['recursos']): number {
  if (r?.timeout === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const m = typeof r.timeout === 'string' ? /^(\d+)s$/.exec(r.timeout) : null;
  const n = m ? Number(m[1]) : NaN;
  if (!(n >= 60 && n <= MAX_TIMEOUT_SECONDS)) throw new Error(`${slug}.yaml: recursos.timeout must be 60s to ${MAX_TIMEOUT_SECONDS}s`);
  return n;
}

/** `16Gi` → 16, `512Mi` → 0.5; NaN when it is neither. */
function gib(x: unknown): number {
  const m = typeof x === 'string' ? /^(\d+(?:\.\d+)?)(Gi|Mi)$/.exec(x) : null;
  return m ? Number(m[1]) / (m[2] === 'Mi' ? 1024 : 1) : NaN;
}

/** The standard job has 2 CPU and 4 GiB, the large one 4 CPU and 16 GiB: the smallest that holds what it asked for. */
function sizeOf(slug: string, r: AgentYaml['recursos']): 'standard' | 'large' {
  if (r?.cpu === undefined && r?.memoria === undefined) return 'standard';
  const cpu = Number(r?.cpu ?? 0);
  const mem = r?.memoria === undefined ? 0 : gib(r.memoria);
  if (!(cpu >= 0 && cpu <= 4) || !(mem >= 0 && mem <= 16)) throw new Error(`${slug}.yaml: recursos past 4 CPU and 16Gi, the largest job`);
  return cpu > 2 || mem > 4 ? 'large' : 'standard';
}

function ritmoOf(slug: string, r: AgentYaml['ritmo']): Pick<ImportedRunnerAgent, 'max_runs_per_day' | 'ci_repo' | 'max_ci_queued'> {
  if (!r) return { max_runs_per_day: null, ci_repo: null, max_ci_queued: null };
  const cap = r.max_ejecuciones_por_dia;
  if (!(Number.isInteger(cap) && (cap as number) >= 1 && (cap as number) <= 48)) throw new Error(`${slug}.yaml: ritmo.max_ejecuciones_por_dia must be 1 to 48`);
  const hasCi = r.repo_ci !== undefined || r.max_ci_en_cola !== undefined;
  if (hasCi && !(isRepo(r.repo_ci) && Number.isInteger(r.max_ci_en_cola) && (r.max_ci_en_cola as number) >= 0 && (r.max_ci_en_cola as number) <= 100)) {
    throw new Error(`${slug}.yaml: ritmo needs both repo_ci (owner/name) and max_ci_en_cola (0 to 100)`);
  }
  return { max_runs_per_day: cap as number, ci_repo: hasCi ? (r.repo_ci as string) : null, max_ci_queued: hasCi ? (r.max_ci_en_cola as number) : null };
}

const isRepo = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s);

/** Its tools without the forbidden ones (`Bash` also takes out `Bash(git:*)`): what is not listed is denied anyway. */
function allowedTools(a: AgentYaml): string[] {
  const forbidden = strings(a.prohibidas);
  return strings(a.herramientas).filter((t) => !forbidden.some((f) => t === f || t.startsWith(`${f}(`)));
}

/**
 * Its secrets: the yaml maps each variable to a secret in the project's Google Cloud (`ordago-elevenlabs`); in
 * Ghostaff it is the organisation's secret of the same name without the project's prefix (`elevenlabs`).
 */
function secretsOf(slug: string, a: AgentYaml, project: string): AgentSecrets {
  if (a.secretos === undefined || a.secretos === null) return {};
  if (typeof a.secretos !== 'object' || Array.isArray(a.secretos)) throw new Error(`${slug}.yaml: secretos is a map of VARIABLE to secret`);
  const out: AgentSecrets = {};
  for (const [env, from] of Object.entries(a.secretos as Record<string, unknown>)) {
    const name = typeof from === 'string' ? from.replace(new RegExp(`^${project}-`), '') : '';
    if (!isSecretEnv(env)) throw new Error(`${slug}.yaml: ${env} cannot be a secret's variable on our runner`);
    if (!isSecretName(name)) throw new Error(`${slug}.yaml: ${String(from)} is not a secret name Ghostaff takes`);
    out[env] = name;
  }
  return out;
}

function onOurRunner(
  slug: string,
  a: AgentYaml,
  conf: ProjectYaml,
  writes: string[],
  project: string,
): Omit<ImportedRunnerAgent, keyof ImportedBase | 'runner' | 'job_project' | 'job_region' | 'job_name' | 'job_identity'> {
  const record = conf.cerebro ?? '';
  const tools = allowedTools(a);
  if (typeof a.prompt !== 'string' || !a.prompt.trim()) throw new Error(`${slug}.yaml has no prompt`);
  if (typeof a.modelo !== 'string' || !a.modelo) throw new Error(`${slug}.yaml has no modelo`);
  if (tools.length === 0) throw new Error(`${slug}.yaml has no herramientas`);
  return {
    task: a.prompt.trim(),
    model: a.modelo,
    tools,
    max_turns: Number.isInteger(a.max_turnos) && a.max_turnos! > 0 ? a.max_turnos! : 100,
    repos: otherRepos(a, record, writes),
    reads_org_runs: readsTranscripts(a, conf.gcp?.bucket_transcripciones),
    timeout_seconds: timeoutOf(slug, a.recursos),
    size: sizeOf(slug, a.recursos),
    ...ritmoOf(slug, a.ritmo),
    secrets: secretsOf(slug, a, project),
  };
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
  const conf = parse(readFileSync(join(projectDir, 'proyecto.yaml'), 'utf8')) as ProjectYaml;
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
      const base = { slug, ...place, description: sentence(a.descripcion), schedule: !opts.onDemand && typeof a.horario === 'string' ? a.horario : null };
      if (opts.runner === 'ghostaff') {
        return { ...base, runner: 'ghostaff', ...onOurRunner(slug, a, conf, opts.writes ?? [], project), job_project: null, job_region: null, job_name: null, job_identity: null };
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
