// Guided access: a guide that walks a non-technical person through giving an
// agent access to an app that has an HTTP API (a self-hosted WordPress, say).
// The steps are written by the model, one call per step, but only from a closed
// catalogue of blocks, so a screen always looks the same and a secret can only
// travel through a `secret` block. Where the access lands is one fixed shape
// (`GuideLanding`) that the engine checks and the agent uses without seeing it.
// Everything here is pure: the engine and the app share it.

import { ACCOUNT_PROVIDERS } from './connectors';

/** Where a guide stands. `GuidePart` (chat.ts) carries it into the thread. */
export type GuideStatus = 'open' | 'checked' | 'done' | 'rejected' | 'blocked' | 'handed_over';

/** How the app's API is signed: a user and password, a token, or a key in a named header. */
export type GuideAuth = 'basic' | 'bearer' | 'header';

/** What a guide may ask the person for. The secret ones go straight to the vault. */
export type GuideField = 'base_url' | 'username' | 'password' | 'token' | 'key';

/** The fields whose value is a secret. */
export type GuideSecretField = 'password' | 'token' | 'key';

/** The fields whose value is plain text and may travel in answers and in the check's values. */
export type GuideTextField = Exclude<GuideField, GuideSecretField>;

/**
 * Where the access lands, proposed by the agent when it starts the guide.
 * `base` is the address the person types plus `suffix`; `check` is a GET under
 * the base that must answer 2xx, optionally with a top-level JSON field that
 * must include a value.
 */
export type GuideLanding = {
  auth: GuideAuth;
  /** The header's name; only with `auth: 'header'`. */
  header?: string;
  /** Added after the person's address, e.g. «/wp-json». Starts with «/». */
  suffix?: string;
  check: { path: string; expect?: { field: string; includes: string } };
};

/** A photo of the person's screen, as the model reads it. */
export type GuidePhoto = { mediaType: 'image/jpeg'; data: string };

/** A circle or an arrow drawn on the person's screenshot; x and y are fractions (0-1) of the photo. */
export type GuideMark = { x: number; y: number; shape?: 'circle' | 'arrow' };

/** The reference drawings a `choice` option may show: the app ships them, the model only picks one. Never a URL. */
export const GUIDE_IMAGES = ['sidebar-left', 'menu-top', 'none'] as const;

export type GuideImage = (typeof GUIDE_IMAGES)[number];

/** The closed catalogue of blocks a step is made of. */
export type GuideBlock =
  | { type: 'title'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'choice'; question: string; options: { id: string; label: string; image?: GuideImage }[] }
  | { type: 'annotated_shot'; mark: GuideMark; caption?: string }
  | { type: 'copy_value'; label: string; value: string }
  | { type: 'secret'; field: GuideSecretField; label: string }
  | { type: 'field'; field: GuideTextField; label: string }
  | { type: 'confirm' }
  | { type: 'check' }
  | { type: 'scope'; text: string }
  | { type: 'use_connector'; connector: string };

/** One screen of the guide. `done.undo` says how to take the access back; `blocked` says why the guide cannot go on. */
export type GuideStep = { blocks: GuideBlock[]; done?: { undo: string }; blocked?: string };

/** What the person answered in a step. Never a secret. */
export type GuideAnswer =
  | { type: 'choice'; option: string }
  | { type: 'confirm'; ok: boolean }
  | { type: 'text'; field: GuideTextField; value: string };

/** What the guide's screen reads (GET /guides/:id on the engine). */
export interface GuideView {
  id: string;
  threadId: string;
  status: GuideStatus;
  app: string;
  goal: string;
  why: string;
  auth: GuideAuth;
  agentEmail: string;
  /** The step shown last; null before the first (ask for it with an empty step). */
  step: GuideStep | null;
  /** How many steps have been shown, for the progress dots. */
  steps: number;
  /** Whether the caller is an owner and the guide waits for one. */
  mayApprove: boolean;
  blockedReason: string | null;
  undo: string | null;
}

/** What the person typed, sent only in the check: the one place a secret travels. */
export type GuideCheckValues = Partial<Record<GuideField, string>>;

/** How the check went: what to fix next to which field, or where the guide stands now. */
export type GuideCheckOutcome = { ok: true; status: 'checked' | 'done' } | { ok: false; field?: GuideField; message: string };

const PROVIDER_IDS: readonly string[] = ACCOUNT_PROVIDERS;
const AUTHS: readonly GuideAuth[] = ['basic', 'bearer', 'header'];
const SECRET_FIELDS: readonly string[] = ['password', 'token', 'key'];
const TEXT_FIELDS: readonly string[] = ['base_url', 'username'];

const MAX_BLOCKS = 8;
const MAX_TITLE = 60;
const MAX_BULLETS = 3;
const MAX_BULLET = 90;

type Failure = { error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** What each auth lets a guide ask the person for, and nothing else. */
export function fieldsFor(auth: GuideAuth): readonly GuideField[] {
  switch (auth) {
    case 'basic':
      return ['base_url', 'username', 'password'];
    case 'bearer':
      return ['base_url', 'token'];
    case 'header':
      return ['base_url', 'key'];
  }
}

/** Checks the landing the agent proposes. The error is for the model. */
export function parseLanding(raw: unknown): GuideLanding | Failure {
  if (!isRecord(raw)) return { error: 'landing must be an object' };
  const { auth, header, suffix, check } = raw;
  if (typeof auth !== 'string' || !AUTHS.includes(auth as GuideAuth)) {
    return { error: 'landing.auth must be basic, bearer or header' };
  }
  const landing: GuideLanding = { auth: auth as GuideAuth, check: { path: '' } };
  if (auth === 'header') {
    if (typeof header !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(header)) {
      return { error: 'landing.header must name the header when auth is header' };
    }
    landing.header = header;
  } else if (header !== undefined) {
    return { error: 'landing.header is only for auth header' };
  }
  if (suffix !== undefined) {
    if (typeof suffix !== 'string' || !/^\/[\w./-]*[\w.-]$/.test(suffix)) {
      return { error: 'landing.suffix must start with / and have no trailing /' };
    }
    landing.suffix = suffix;
  }
  if (!isRecord(check) || typeof check.path !== 'string' || !check.path.startsWith('/') || check.path.startsWith('//')) {
    return { error: 'landing.check.path must be a path under the base, starting with /' };
  }
  landing.check = { path: check.path };
  if (check.expect !== undefined) {
    const e = check.expect;
    if (!isRecord(e) || typeof e.field !== 'string' || !e.field || typeof e.includes !== 'string' || !e.includes) {
      return { error: 'landing.check.expect needs a field and a value it includes' };
    }
    landing.check.expect = { field: e.field, includes: e.includes };
  }
  return landing;
}

/**
 * Whether a label asks for a secret, in Spanish or English, ignoring case and
 * accents. Long words match inside others («contraseñas», «apitoken»); «key»
 * and «pin» only as words, so «pintura» passes. Errs on refusing.
 */
function namesASecret(label: string): boolean {
  const plain = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /contrasen|password|passwd|clave|token|secret/.test(plain) || /\b(keys?|pins?)\b/.test(plain);
}

function parseBlock(raw: unknown, landing: GuideLanding): GuideBlock | Failure {
  if (!isRecord(raw) || typeof raw.type !== 'string') return { error: 'each block must be an object with a type' };
  const text = (v: unknown, max: number, what: string): string | Failure => {
    if (typeof v !== 'string' || !v.trim()) return { error: `${what} must be a non-empty string` };
    if (v.length > max) return { error: `${what} is ${v.length} characters; the limit is ${max}` };
    return v;
  };
  switch (raw.type) {
    case 'title': {
      const t = text(raw.text, MAX_TITLE, 'title');
      return typeof t === 'string' ? { type: 'title', text: t } : t;
    }
    case 'bullets': {
      const items = raw.items;
      if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BULLETS) {
        return { error: `bullets takes one to ${MAX_BULLETS} items` };
      }
      const out: string[] = [];
      for (const item of items) {
        const t = text(item, MAX_BULLET, 'a bullets item');
        if (typeof t !== 'string') return { error: `bullets: ${t.error}` };
        out.push(t);
      }
      return { type: 'bullets', items: out };
    }
    case 'choice': {
      const q = text(raw.question, MAX_TITLE, 'choice question');
      if (typeof q !== 'string') return q;
      const opts = raw.options;
      if (!Array.isArray(opts) || opts.length < 2 || opts.length > 4) return { error: 'choice takes two to four options' };
      const options: { id: string; label: string; image?: GuideImage }[] = [];
      for (const o of opts) {
        if (!isRecord(o) || typeof o.id !== 'string' || !o.id) return { error: 'each choice option needs an id' };
        const l = text(o.label, MAX_BULLET, 'a choice option label');
        if (typeof l !== 'string') return l;
        const option: { id: string; label: string; image?: GuideImage } = { id: o.id, label: l };
        if (o.image !== undefined) {
          if (typeof o.image !== 'string' || !(GUIDE_IMAGES as readonly string[]).includes(o.image)) {
            return { error: `choice option image must be one of: ${GUIDE_IMAGES.join(', ')}` };
          }
          option.image = o.image as GuideImage;
        }
        options.push(option);
      }
      return { type: 'choice', question: q, options };
    }
    case 'annotated_shot': {
      const m = raw.mark;
      const inUnit = (n: unknown) => typeof n === 'number' && n >= 0 && n <= 1;
      if (!isRecord(m) || !inUnit(m.x) || !inUnit(m.y)) return { error: 'annotated_shot mark x and y must be between 0 and 1' };
      const mark: GuideMark = { x: m.x as number, y: m.y as number };
      if (m.shape === 'circle' || m.shape === 'arrow') mark.shape = m.shape;
      const block: GuideBlock = { type: 'annotated_shot', mark };
      if (raw.caption !== undefined) {
        const c = text(raw.caption, MAX_BULLET, 'annotated_shot caption');
        if (typeof c !== 'string') return c;
        block.caption = c;
      }
      return block;
    }
    case 'copy_value': {
      const l = text(raw.label, MAX_BULLET, 'copy_value label');
      if (typeof l !== 'string') return l;
      const v = text(raw.value, 200, 'copy_value value');
      if (typeof v !== 'string') return v;
      return { type: 'copy_value', label: l, value: v };
    }
    case 'secret': {
      const f = raw.field;
      if (typeof f !== 'string' || !SECRET_FIELDS.includes(f) || !fieldsFor(landing.auth).includes(f as GuideField)) {
        return { error: `secret field ${String(f)} is not allowed for auth ${landing.auth}; allowed: ${fieldsFor(landing.auth).filter((x) => SECRET_FIELDS.includes(x)).join(', ')}` };
      }
      const l = text(raw.label, MAX_BULLET, 'secret label');
      return typeof l === 'string' ? { type: 'secret', field: f as GuideSecretField, label: l } : l;
    }
    case 'field': {
      const f = raw.field;
      if (typeof f !== 'string' || !TEXT_FIELDS.includes(f) || !fieldsFor(landing.auth).includes(f as GuideField)) {
        return { error: `field ${String(f)} is not allowed for auth ${landing.auth}; allowed: ${fieldsFor(landing.auth).filter((x) => TEXT_FIELDS.includes(x)).join(', ')}` };
      }
      const l = text(raw.label, MAX_BULLET, 'field label');
      if (typeof l !== 'string') return l;
      // What is typed in a field travels to the model: one that names a secret would carry it there.
      if (namesASecret(l)) {
        return { error: `field label «${l}» names a secret; a field is plain text, ask for a password, token or key only with a secret block` };
      }
      return { type: 'field', field: f as GuideTextField, label: l };
    }
    case 'confirm':
      return { type: 'confirm' };
    case 'check':
      return { type: 'check' };
    case 'scope': {
      const t = text(raw.text, MAX_BULLET, 'scope text');
      return typeof t === 'string' ? { type: 'scope', text: t } : t;
    }
    case 'use_connector': {
      if (typeof raw.connector !== 'string' || !PROVIDER_IDS.includes(raw.connector)) {
        return { error: `use_connector: unknown connector ${String(raw.connector)}` };
      }
      return { type: 'use_connector', connector: raw.connector };
    }
    default:
      return { error: `unknown block type ${raw.type}` };
  }
}

/**
 * Checks a step the model sent through `show_step` against the catalogue and
 * its limits. The error is written for the model, which is asked once more with it.
 */
export function parseGuideStep(raw: unknown, landing: GuideLanding): { step: GuideStep } | Failure {
  if (!isRecord(raw) || !Array.isArray(raw.blocks)) return { error: 'the step needs a blocks array' };
  if (raw.blocks.length < 1 || raw.blocks.length > MAX_BLOCKS) return { error: `blocks takes one to ${MAX_BLOCKS} blocks` };
  const blocks: GuideBlock[] = [];
  for (const b of raw.blocks) {
    const parsed = parseBlock(b, landing);
    if ('error' in parsed) return parsed;
    blocks.push(parsed);
  }
  const step: GuideStep = { blocks };
  if (raw.done !== undefined) {
    if (!isRecord(raw.done) || typeof raw.done.undo !== 'string' || !raw.done.undo.trim()) {
      return { error: 'done needs an undo line' };
    }
    step.done = { undo: raw.done.undo };
  }
  if (raw.blocked !== undefined) {
    if (typeof raw.blocked !== 'string' || !raw.blocked.trim()) return { error: 'blocked must say why' };
    step.blocked = raw.blocked;
  }
  return { step };
}

/**
 * The address as the person typed it («miweb.com», «https://miweb.com/wp-admin/»)
 * becomes its https origin plus the suffix. The error is shown to the person.
 */
export function normaliseBase(input: string, suffix = ''): { base: string } | Failure {
  const typed = input.trim();
  if (/^http:\/\//i.test(typed)) return { error: 'Tu web tiene que empezar por https' };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'Esa dirección no parece una web' };
  }
  if (url.protocol !== 'https:') return { error: 'Tu web tiene que empezar por https' };
  if (!url.hostname.includes('.')) return { error: 'Esa dirección no parece una web' };
  return { base: `${url.origin}${suffix}` };
}

/** Lowercase, diacritics stripped, anything else a dash, no dashes at the ends. */
function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The provider id of a guided access: «x» plus the app's name reduced to
 * [a-z0-9], at most 31 characters (the database check). The «x» only
 * guarantees a leading letter: guided accesses belong to one agent and have
 * their own uniqueness, so they never collide with catalogue ids.
 */
export function guidedProvider(app: string): string {
  const slug = slugify(app).replace(/-/g, '');
  return `x${slug || 'app'}`.slice(0, 31);
}

/** The agent's own address, the identity it has in the customer's tool. */
export function agentEmail(orgSlug: string, agent: { slug: string | null; name: string }): string {
  const local = agent.slug || slugify(agent.name) || 'agente';
  return `${local}@${orgSlug}.ghostaff.ai`;
}
