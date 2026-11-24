import type { GuideAnswer, GuideLanding, GuidePhoto, GuideStep } from '@ghostaff/shared';
import { describe, expect, it } from 'vitest';
import { type AiAccount, AiFailure, type ModelTurn, type Writer } from '../src/chat';
import { FALLBACK_STEP, type GuideModelDeps, type GuideState, guideSystemPrompt, nextStep, SHOW_STEP, showStepSpec } from '../src/guideModel';

const ORG = '10000000-0000-0000-0000-000000000001';

const wordpress: GuideLanding = {
  auth: 'basic',
  suffix: '/wp-json',
  check: { path: '/wp/v2/users/me?context=edit', expect: { field: 'roles', includes: 'editor' } },
};

const guide = (history: GuideState['history'] = []): GuideState => ({
  app: 'WordPress',
  goal: 'Redes puede publicar borradores en tu web',
  landing: wordpress,
  agentEmail: 'redes@panaderia.ghostaff.ai',
  history,
});

const PHOTO: GuidePhoto = { mediaType: 'image/jpeg', data: '/9j/4AAQSkZJRgABAQ' };

const openUsers: GuideStep = {
  blocks: [
    { type: 'title', text: 'Abre Usuarios' },
    { type: 'bullets', items: ['Pulsa «Usuarios» en la barra negra de la izquierda.'] },
    { type: 'confirm' },
  ],
};

const circled: GuideStep = {
  blocks: [
    { type: 'title', text: 'Pulsa aquí' },
    { type: 'annotated_shot', mark: { x: 0.08, y: 0.41, shape: 'circle' }, caption: 'Usuarios' },
    { type: 'confirm' },
  ],
};

type Request = Parameters<Writer>[0];

/**
 * A fake writer: each call plays the next scripted move. A move is a step to
 * send through `show_step` (as the model would), or text instead of the tool.
 */
function scripted(moves: Array<{ step: unknown } | { text: string } | { fail: Error } | { step: unknown; thenFail: Error }>) {
  const requests: Request[] = [];
  const write: Writer = async (req) => {
    requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
    const move = moves.shift();
    if (!move) throw new Error('no move left');
    if ('fail' in move) throw move.fail;
    if ('text' in move) {
      req.onText(move.text);
      return;
    }
    req.onTool(SHOW_STEP);
    const out = await req.tools.run(SHOW_STEP, move.step);
    expect(out.isError).toBe(false);
    if ('thenFail' in move) throw move.thenFail;
  };
  return { write, requests };
}

function deps(writers: Record<string, Writer>, accounts: AiAccount[] = [{ id: 'key-1', provider: 'anthropic' }]): GuideModelDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    orgId: ORG,
    asked,
    aiAccounts: async (org) => {
      expect(org).toBe(ORG);
      return accounts;
    },
    writerFor: async (org, account) => {
      expect(org).toBe(ORG);
      asked.push(account.id);
      const w = writers[account.id];
      if (!w) throw new AiFailure('refused', 'no writer');
      return w;
    },
  };
}

const imagesOf = (turns: ModelTurn[]) => turns.map((t) => t.images ?? []);

describe('a step of a guide, from the model', () => {
  it('gives the step the model sent through show_step, which is never a write', async () => {
    const s = scripted([{ step: openUsers }]);
    const step = await nextStep(deps({ 'key-1': s.write }), guide());
    expect(step).toEqual(openUsers);
    const [req] = s.requests;
    expect(req?.tools.specs.map((t) => t.name)).toEqual([SHOW_STEP]);
    expect(req?.tools.writes(SHOW_STEP, openUsers)).toBe(false);
    expect(req?.system).toBe(guideSystemPrompt(guide()));
    const prompt = req?.messages.map((m) => m.content).join('\n') ?? '';
    expect(prompt).toContain('WordPress');
    expect(prompt).toContain('Redes puede publicar borradores en tu web');
    expect(prompt).toContain('redes@panaderia.ghostaff.ai');
  });

  it('the photo reaches the writer as an image on the last turn only', async () => {
    const history: GuideState['history'] = [
      { type: 'step', step: openUsers },
      { type: 'photo' },
      { type: 'answer', answer: { type: 'confirm', ok: false } },
    ];
    // The first try is wrong, so the retry is a longer conversation: the photo moves to its last turn.
    const s = scripted([{ step: { blocks: [] } }, { step: circled }]);
    const step = await nextStep(deps({ 'key-1': s.write }), guide(history), { type: 'confirm', ok: false }, PHOTO);
    expect(step).toEqual(circled);
    expect(s.requests).toHaveLength(2);
    for (const req of s.requests) {
      const images = imagesOf(req.messages);
      expect(images.at(-1)).toEqual([PHOTO]);
      expect(images.slice(0, -1).flat()).toEqual([]);
      expect(req.messages.at(-1)?.role).toBe('user');
    }
    expect(s.requests[1]?.messages.length).toBeGreaterThan(1);
  });

  it('sends no image without a photo, and refuses a mark when there is no photo to draw it on', async () => {
    const s = scripted([{ step: circled }, { step: openUsers }]);
    const step = await nextStep(deps({ 'key-1': s.write }), guide());
    expect(step).toEqual(openUsers);
    for (const req of s.requests) expect(imagesOf(req.messages).flat()).toEqual([]);
    expect(s.requests[1]?.messages.at(-1)?.content).toMatch(/annotated_shot/);
  });

  it('an invalid step, then a valid one, gives the valid one', async () => {
    const fourBullets = { blocks: [{ type: 'bullets', items: ['a', 'b', 'c', 'd'] }] };
    const s = scripted([{ step: fourBullets }, { step: openUsers }]);
    const step = await nextStep(deps({ 'key-1': s.write }), guide());
    expect(step).toEqual(openUsers);
    const retry = s.requests[1]?.messages ?? [];
    expect(retry.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(retry[1]?.content).toContain('"d"');
    expect(retry[2]?.content).toContain('bullets takes one to 3 items');
  });

  it('two invalid steps give the fallback', async () => {
    const tokenForBasic = { blocks: [{ type: 'secret', field: 'token', label: 'Tu token' }] };
    const markOutside = { blocks: [{ type: 'annotated_shot', mark: { x: 1.4, y: 0.2 } }] };
    const s = scripted([{ step: tokenForBasic }, { step: markOutside }]);
    expect(await nextStep(deps({ 'key-1': s.write }), guide(), undefined, PHOTO)).toEqual(FALLBACK_STEP);
    expect(s.requests).toHaveLength(2);
  });

  it('text instead of the tool counts as invalid', async () => {
    const s = scripted([{ text: 'Abre Usuarios en tu WordPress.' }, { text: 'Vale.' }]);
    expect(await nextStep(deps({ 'key-1': s.write }), guide())).toEqual(FALLBACK_STEP);
    const retry = s.requests[1]?.messages ?? [];
    expect(retry[1]).toMatchObject({ role: 'assistant', content: 'Abre Usuarios en tu WordPress.' });
    expect(retry[2]?.content).toMatch(/show_step/);
  });

  it('the fallback is «Enséñame tu pantalla» and passes the catalogue', async () => {
    expect(FALLBACK_STEP.blocks[0]).toEqual({ type: 'title', text: 'Enséñame tu pantalla' });
    const { parseGuideStep } = await import('@ghostaff/shared');
    expect(parseGuideStep(FALLBACK_STEP, wordpress)).toEqual({ step: FALLBACK_STEP });
  });

  it('no secret value is in any turn', async () => {
    const SECRET = 'abcd EFGH ijkl MNOP qrst UVWX';
    // Answers come from the app as JSON: one claiming to carry a secret field is dropped, never forwarded.
    const smuggled = { type: 'text', field: 'password', value: SECRET } as unknown as GuideAnswer;
    const history: GuideState['history'] = [
      { type: 'step', step: { blocks: [{ type: 'field', field: 'base_url', label: 'La dirección de tu web' }, { type: 'secret', field: 'password', label: 'La contraseña de aplicación' }] } },
      { type: 'answer', answer: { type: 'text', field: 'base_url', value: 'miweb.com' } },
      { type: 'answer', answer: smuggled },
    ];
    const s = scripted([{ step: { blocks: [{ type: 'check' }] } }]);
    await nextStep(deps({ 'key-1': s.write }), guide(history), smuggled);
    const [req] = s.requests;
    const everything = JSON.stringify(req?.messages) + (req?.system ?? '');
    expect(everything).toContain('miweb.com');
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('qrst');
  });

  it('tries the next account only when one fails before giving a step', async () => {
    const broken = scripted([{ fail: new AiFailure('limited', 'at its limit') }]);
    const good = scripted([{ step: openUsers }]);
    const d = deps({ sub: broken.write, 'key-1': good.write }, [
      { id: 'sub', provider: 'claude' },
      { id: 'key-1', provider: 'anthropic' },
    ]);
    expect(await nextStep(d, guide())).toEqual(openUsers);
    expect(d.asked).toEqual(['sub', 'key-1']);

    // A step already sent is kept even if the writer fails afterwards.
    const late = scripted([{ step: openUsers, thenFail: new Error('stream cut') }]);
    const d2 = deps({ sub: late.write, 'key-1': good.write }, [
      { id: 'sub', provider: 'claude' },
      { id: 'key-1', provider: 'anthropic' },
    ]);
    expect(await nextStep(d2, guide())).toEqual(openUsers);
    expect(d2.asked).toEqual(['sub']);
  });

  it('fails when the organisation has no AI account, or none answers', async () => {
    await expect(nextStep(deps({}, []), guide())).rejects.toBeInstanceOf(AiFailure);
    const broken = scripted([{ fail: new AiFailure('failed', 'down') }]);
    await expect(nextStep(deps({ 'key-1': broken.write }), guide())).rejects.toThrow('down');
  });

  it('keeps only the first step sent in one call', async () => {
    const write: Writer = async (req) => {
      expect((await req.tools.run(SHOW_STEP, openUsers)).isError).toBe(false);
      expect((await req.tools.run(SHOW_STEP, circled)).isError).toBe(true);
      expect((await req.tools.run('other_tool', {})).isError).toBe(true);
    };
    expect(await nextStep(deps({ 'key-1': write }), guide())).toEqual(openUsers);
  });
});

describe('the show_step tool and the prompt', () => {
  it('offers only the fields the landing allows', () => {
    const blockOf = (auth: GuideLanding['auth'], type: string) => {
      const blocks = showStepSpec({ ...wordpress, auth, ...(auth === 'header' ? { header: 'X-Key' } : {}) }).input_schema.properties.blocks as {
        items: { anyOf: Array<{ properties: { type: { const: string }; field?: { enum: string[] } } }> };
      };
      return blocks.items.anyOf.find((b) => b.properties.type.const === type);
    };
    expect(blockOf('basic', 'secret')?.properties.field?.enum).toEqual(['password']);
    expect(blockOf('basic', 'field')?.properties.field?.enum).toEqual(['base_url', 'username']);
    expect(blockOf('bearer', 'secret')?.properties.field?.enum).toEqual(['token']);
    expect(blockOf('header', 'field')?.properties.field?.enum).toEqual(['base_url']);
  });

  it('carries the text rules and the walls', () => {
    const p = guideSystemPrompt(guide());
    expect(p).toMatch(/español/);
    expect(p).toMatch(/«Pulsa»/);
    expect(p).toMatch(/nunca.*contraseña de la persona|contraseña.*propia/i);
    expect(p).toMatch(/https/);
    expect(p).toMatch(/plugin de seguridad/);
    expect(p).toMatch(/blocked/);
  });
});
