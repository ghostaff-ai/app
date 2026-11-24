import type { ChatMessage, GuidePart, GuideStep, GuideView } from '@ghostaff/shared';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
import GuideScreen from '@/app/(app)/guia/[id]';
import { GuideCard } from '@/components/chat/GuideCard';
import { AnnotatedShot } from '@/components/guide/AnnotatedShot';
import { GuideBlocks } from '@/components/guide/GuideBlocks';
import { checkedWhen } from '@/lib/guide';
import { type GuideControls, guidesToResume, useGuideCards } from '@/lib/hooks/useGuideCards';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
// Stable, as the real useEngine is (memoised on the token).
const mockEngine = { url: 'http://engine', token: 't' };
jest.mock('@/lib/hooks/useConnections', () => ({ useEngine: () => mockEngine, useConnections: () => ({ items: [], reload: jest.fn() }) }));
jest.mock('@/lib/hooks/useAccountConnect', () => ({ useAccountConnect: () => ({ connect: jest.fn(), busy: null, ready: true }) }));
jest.mock('@/lib/org/ActiveOrgContext', () => ({ useActiveOrg: () => ({ active: { id: 'o1', role: 'member' } }) }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'g1' }),
  Stack: { Screen: () => null },
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true },
}));
// The keyboard's page needs the safe area, which only the app's root provides.
jest.mock('@/lib/keyboard', () => {
  const { View } = require('react-native');
  return {
    KeyboardForm: ({ children, footer }: { children: unknown; footer?: unknown }) => (
      <View>
        {children}
        {footer}
      </View>
    ),
  };
});
jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///picked.png' }] })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
// Each photo shrunk comes back as file:///shot-<n>.jpg, so a test can tell which one is drawn.
let mockShots = 0;
jest.mock('expo-image-manipulator', () => {
  const image = () => ({
    width: 800,
    height: 600,
    saveAsync: async () => ({ uri: `file:///shot-${++mockShots}.jpg`, width: 800, height: 600, base64: 'AAAA' }),
  });
  const context = { resize: () => context, renderAsync: async () => image() };
  return { ImageManipulator: { manipulate: () => context }, SaveFormat: { JPEG: 'jpeg' } };
});
const mockCopy = jest.fn(async (_text: string) => true);
jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockCopy(text) }));

const guide: GuidePart = { type: 'guide', guideId: 'g1', app: 'WordPress', why: 'Para publicar tus entradas', status: 'open' };

const controls = (over: Partial<GuideControls> = {}): GuideControls => ({
  canTalk: true,
  isOwner: true,
  owners: ['Ana'],
  resuming: () => false,
  open: jest.fn(),
  decide: jest.fn(async () => null),
  ...over,
});
const owner = () => controls();
const member = () => controls({ isOwner: false });
const reader = () => controls({ isOwner: false, canTalk: false });

describe('the guide card in the chat', () => {
  it('open: «Empezar» for an owner and for a member who writes here, not for someone who only reads', async () => {
    const o = owner();
    const { rerender } = await render(<GuideCard guide={guide} controls={o} />);
    expect(screen.getByText('Necesito acceso a WordPress')).toBeTruthy();
    expect(screen.getByText('Para publicar tus entradas')).toBeTruthy();
    await fireEvent.press(screen.getByText('Empezar'));
    expect(o.open).toHaveBeenCalledWith('g1');
    await rerender(<GuideCard guide={guide} controls={member()} />);
    expect(screen.getByText('Empezar')).toBeTruthy();
    await rerender(<GuideCard guide={guide} controls={reader()} />);
    expect(screen.queryByText('Empezar')).toBeNull();
  });

  it('checked: an owner approves or rejects it; everyone else reads who has to approve it', async () => {
    const checked: GuidePart = { ...guide, status: 'checked', doneBy: 'Luis' };
    const o = owner();
    const { rerender } = await render(<GuideCard guide={checked} controls={o} />);
    await fireEvent.press(screen.getByText('Aprobar'));
    await waitFor(() => expect(o.decide).toHaveBeenCalledWith('g1', 'approve'));
    expect(screen.getByText('Rechazar')).toBeTruthy();
    await rerender(<GuideCard guide={checked} controls={member()} />);
    expect(screen.queryByText('Aprobar')).toBeNull();
    expect(screen.queryByText('Rechazar')).toBeNull();
    expect(screen.getByText('Falta que lo apruebe Ana')).toBeTruthy();
  });

  it('done: who did it and who approved it, with no action for anyone', async () => {
    const done: GuidePart = { ...guide, status: 'done', doneBy: 'Luis', decidedBy: 'Ana' };
    for (const c of [owner(), member()]) {
      await render(<GuideCard guide={done} controls={c} />);
      expect(screen.getByText('Hecho por Luis · aprobado por Ana')).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    }
  });

  it('rejected: «Rechazado por Ana», muted, with no action', async () => {
    for (const c of [owner(), member()]) {
      await render(<GuideCard guide={{ ...guide, status: 'rejected', decidedBy: 'Ana' }} controls={c} />);
      expect(screen.getByText('Rechazado por Ana')).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    }
  });

  it('blocked: the reason, with no action', async () => {
    const reason = 'Tu web no tiene https, y sin eso WordPress no deja crear la contraseña.';
    for (const c of [owner(), member()]) {
      await render(<GuideCard guide={{ ...guide, status: 'blocked', blockedReason: reason }} controls={c} />);
      expect(screen.getByText(reason)).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    }
  });

  it('handed over: it reads that it goes on with the account\'s card below, with no button of its own', async () => {
    const handed: GuidePart = { ...guide, status: 'handed_over', connector: 'wordpress', decidedBy: 'Luis' };
    for (const c of [owner(), member(), reader()]) {
      await render(<GuideCard guide={handed} controls={c} />);
      expect(screen.getByText('Mejor con el botón de WordPress.com')).toBeTruthy();
      expect(screen.getByText('Sigue con el botón de WordPress.com, aquí debajo.')).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    }
  });

  it('no action while the agent is still writing that message', async () => {
    await render(<GuideCard guide={guide} controls={owner()} writing />);
    expect(screen.queryByText('Empezar')).toBeNull();
  });
});

describe('when the agent goes on after a guide', () => {
  const message = (parts: ChatMessage['parts'], over: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'm1',
    threadId: 't1',
    authorKind: 'agent',
    authorUserId: null,
    authorAgentId: 'a1',
    authorName: 'Redes',
    parts,
    state: 'done',
    steps: [],
    createdAt: '2026-11-24T10:00:00Z',
    ...over,
  });

  it('a done guide in the agent\'s latest message, not one still waiting or an older one', () => {
    expect(guidesToResume([message([{ ...guide, status: 'done' }])])).toEqual([{ threadId: 't1', guideId: 'g1' }]);
    expect(guidesToResume([message([{ ...guide, status: 'checked' }])])).toEqual([]);
    expect(guidesToResume([message([{ ...guide, status: 'done' }]), message([{ type: 'text', text: 'Ya está.' }], { id: 'm2' })])).toEqual([]);
    expect(guidesToResume([message([{ ...guide, status: 'done' }], { state: 'working' })])).toEqual([]);
  });
});

describe('the guide screen', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
  const view = (step: GuideStep): GuideView => ({
    id: 'g1',
    threadId: 't1',
    status: 'open',
    app: 'WordPress',
    goal: 'Acceso a tu web',
    why: 'Para publicar tus entradas',
    auth: 'basic',
    agentEmail: 'redes@panaderia.ghostaff.ai',
    step,
    steps: 3,
    mayApprove: false,
    blockedReason: null,
    undo: null,
  });
  let requests: { url: string; method: string; body: string | undefined }[];

  beforeEach(() => {
    requests = [];
    const first: GuideStep = {
      blocks: [
        { type: 'title', text: 'Pega la contraseña' },
        { type: 'field', field: 'base_url', label: 'La dirección de tu web' },
        { type: 'secret', field: 'password', label: 'La contraseña de aplicación' },
        { type: 'confirm' },
      ],
    };
    const second: GuideStep = { blocks: [{ type: 'title', text: 'Lo compruebo' }, { type: 'field', field: 'username', label: 'Tu usuario' }, { type: 'check' }] };
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.endsWith('/guides/g1')) return ok(view(first));
      if (url.endsWith('/guides/g1/step')) return ok({ step: second, status: 'open' });
      if (url.endsWith('/guides/g1/check')) return ok({ ok: false, field: 'password', message: 'Esa contraseña no vale: tiene que ser la de aplicación' });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
  });

  it('keeps the secret masked on the screen and out of every step, and sends it only in the check', async () => {
    await render(<GuideScreen />);
    const secret = await screen.findByLabelText('La contraseña de aplicación');
    expect(secret.props.secureTextEntry).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('La dirección de tu web'), 'panaderia.es');
    await fireEvent.changeText(secret, 'abcd efgh ijkl mnop');
    await fireEvent.press(screen.getByText('Ya está'));
    await screen.findByText('Lo compruebo');

    const steps = requests.filter((r) => r.url.endsWith('/step'));
    expect(steps).toHaveLength(1);
    expect(steps[0]!.body).not.toContain('abcd efgh ijkl mnop');
    expect(JSON.parse(steps[0]!.body ?? '{}')).toEqual({ answer: { type: 'confirm', ok: true } });

    await fireEvent.changeText(screen.getByLabelText('Tu usuario'), 'ana');
    await fireEvent.press(screen.getByText('Comprobar'));
    expect(await screen.findByText('Esa contraseña no vale: tiene que ser la de aplicación')).toBeTruthy();
    const check = requests.find((r) => r.url.endsWith('/check'));
    expect(JSON.parse(check!.body ?? '{}')).toEqual({ values: { base_url: 'panaderia.es', username: 'ana', password: 'abcd efgh ijkl mnop' } });
    expect(requests.filter((r) => r.url.endsWith('/step')).every((r) => !r.body?.includes('abcd'))).toBe(true);
  });

  it('shows the goal, the progress and, always, «Enséñame tu pantalla»', async () => {
    await render(<GuideScreen />);
    expect(await screen.findByText('Acceso a tu web')).toBeTruthy();
    expect(screen.getByLabelText('Paso 3')).toBeTruthy();
    expect(screen.getByText('Enséñame tu pantalla')).toBeTruthy();
  });
});

describe('the mark on the person\'s photo', () => {
  it('is drawn at the position the model gave, over the last photo sent', async () => {
    await render(<AnnotatedShot shot={{ uri: 'file:///shot.jpg', width: 1000, height: 2000 }} mark={{ x: 0.3, y: 0.6 }} caption="Pulsa aquí" />);
    const mark = StyleSheet.flatten(screen.getByTestId('guide-mark').props.style);
    expect(mark.left).toBe('30%');
    expect(mark.top).toBe('60%');
    expect(screen.getByText('Pulsa aquí')).toBeTruthy();
    expect(screen.getByLabelText(/Tu captura/)).toBeTruthy();
  });

  it('without the photo on this device, asks to send it again', async () => {
    await render(<AnnotatedShot shot={null} mark={{ x: 0.3, y: 0.6 }} caption="Pulsa aquí" />);
    expect(screen.queryByTestId('guide-mark')).toBeNull();
    expect(screen.getByText('Vuelve a enviar tu foto para verla marcada.')).toBeTruthy();
  });
});

// Fix round 1 (task review).

const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
const baseView = (step: GuideStep | null): GuideView => ({
  id: 'g1',
  threadId: 't1',
  status: 'open',
  app: 'WordPress',
  goal: 'Acceso a tu web',
  why: 'Para publicar tus entradas',
  auth: 'basic',
  agentEmail: 'redes@panaderia.ghostaff.ai',
  step,
  steps: 1,
  mayApprove: false,
  blockedReason: null,
  undo: null,
});

describe('a photo that fails to send', () => {
  it('keeps the previous step\'s mark on the previous photo', async () => {
    const marked: GuideStep = { blocks: [{ type: 'title', text: 'Pulsa aquí' }, { type: 'annotated_shot', mark: { x: 0.5, y: 0.5 } }, { type: 'confirm' }] };
    const stepReplies = [reply(200, { step: marked, status: 'open' }), reply(413, { error: 'too_big', message: 'Esa foto es demasiado grande. Prueba con una captura más pequeña.' })];
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/guides/g1')) return reply(200, baseView({ blocks: [{ type: 'title', text: '¿Dónde estás?' }, { type: 'confirm' }] }));
      if (url.endsWith('/step')) return stepReplies.shift()!;
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const sendPhoto = async () => {
      await fireEvent.press(screen.getByText('Enséñame tu pantalla'));
      await fireEvent.press(screen.getByText('Elegir una captura'));
    };

    await render(<GuideScreen />);
    await screen.findByText('¿Dónde estás?');
    await sendPhoto();
    await screen.findByText('Pulsa aquí');
    const first = screen.getByTestId('guide-shot').props.source;
    expect(first).toEqual({ uri: expect.stringMatching(/shot-\d+\.jpg$/) });

    await sendPhoto();
    expect(await screen.findByText('Esa foto es demasiado grande. Prueba con una captura más pequeña.')).toBeTruthy();
    expect(screen.getByText('Pulsa aquí')).toBeTruthy();
    expect(screen.getByTestId('guide-shot').props.source).toEqual(first);
  });
});

describe('a guide that cannot be opened', () => {
  const opening = (answer: () => Promise<Response>) => {
    globalThis.fetch = jest.fn(answer) as typeof fetch;
  };

  it('one that no longer exists says so, with no retry', async () => {
    opening(async () => reply(404, { error: 'not_found', message: 'guide not found' }));
    await render(<GuideScreen />);
    expect(await screen.findByText('Esta guía ya no existe.')).toBeTruthy();
    expect(screen.queryByText('Reintentar')).toBeNull();
  });

  it('one the person may not read says so, with no retry', async () => {
    opening(async () => reply(403, { error: 'not_allowed', message: 'you may not read this conversation' }));
    await render(<GuideScreen />);
    expect(await screen.findByText('No puedes ver esta guía.')).toBeTruthy();
    expect(screen.queryByText('Reintentar')).toBeNull();
    expect(screen.queryByText('Solo puede hacerlo quien escribe en esta conversación.')).toBeNull();
  });

  it('without a connection offers to try again, and opens it when it can', async () => {
    let online = false;
    opening(async () => {
      if (!online) throw new TypeError('Network request failed');
      return reply(200, baseView({ blocks: [{ type: 'title', text: 'Entra en tu WordPress' }, { type: 'confirm' }] }));
    });
    await render(<GuideScreen />);
    expect(await screen.findByText('No hay conexión.')).toBeTruthy();
    online = true;
    await fireEvent.press(screen.getByText('Reintentar'));
    expect(await screen.findByText('Entra en tu WordPress')).toBeTruthy();
  });
});

describe('deciding a member\'s grant from the card', () => {
  it('Aprobar and then Rechazar while the first runs sends one decision', async () => {
    let finish: (v: string | null) => void = () => {};
    const decide = jest.fn(() => new Promise<string | null>((resolve) => (finish = resolve)));
    await render(<GuideCard guide={{ ...guide, status: 'checked', doneBy: 'Luis' }} controls={controls({ decide })} />);
    await fireEvent.press(screen.getByText('Aprobar'));
    await fireEvent.press(screen.getByText('Rechazar'));
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith('g1', 'approve');
    finish(null);
    await waitFor(() => expect(screen.getByText('Rechazar')).toBeTruthy());
  });
});

describe('a value to copy', () => {
  it('«Copiar» copies exactly the value and says it did', async () => {
    const noop = () => {};
    await render(
      <GuideBlocks
        step={{ blocks: [{ type: 'copy_value', label: 'El correo del agente', value: 'redes@panaderia.ghostaff.ai' }, { type: 'confirm' }] }}
        values={{}}
        onValue={noop}
        fieldError={null}
        shot={null}
        busy={null}
        onAnswer={noop}
        onCheck={noop}
        missing={[]}
        connector={{ canConnect: false, run: async () => null }}
      />,
    );
    await fireEvent.press(screen.getByLabelText('Copiar El correo del agente'));
    await waitFor(() => expect(mockCopy).toHaveBeenCalledWith('redes@panaderia.ghostaff.ai'));
    expect(await screen.findByText('Copiado')).toBeTruthy();
  });
});


// Final review: an owner approves from the guide's screen (R19 b), and a member reads the truth there.

describe('a guide waiting for an owner, on its screen', () => {
  const closing: GuideStep = { blocks: [{ type: 'title', text: 'Acceso comprobado' }], done: { undo: 'Quita el usuario redes@panaderia.ghostaff.ai en WordPress.' } };
  const checkedView = (mayApprove: boolean): GuideView => ({ ...baseView(closing), status: 'checked', mayApprove, undo: closing.done!.undo });
  let requests: string[];
  let approve: () => Promise<Response>;

  const serve = (v: GuideView) => {
    requests = [];
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/guides/g1')) return reply(200, v);
      if (url.endsWith('/guides/g1/approve')) return approve();
      if (url.endsWith('/guides/g1/reject')) return reply(200, { status: 'rejected' });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
  };

  beforeEach(() => {
    approve = async () => reply(200, { status: 'done', resumed: true });
  });

  it('an owner reads what approving does and approves it there; no step is asked', async () => {
    serve(checkedView(true));
    await render(<GuideScreen />);
    expect(await screen.findByText(/Si lo apruebas, el agente tendrá este acceso/)).toBeTruthy();
    expect(screen.queryByText(/Falta que lo apruebe/)).toBeNull();
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Aprobar' }));
    });
    expect(await screen.findByText(/Aprobado: el agente ya tiene el acceso/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
    expect(requests.filter((u) => u.endsWith('/approve'))).toHaveLength(1);
    expect(requests.some((u) => u.endsWith('/step'))).toBe(false);
  });

  it('an owner rejects it there', async () => {
    serve(checkedView(true));
    await render(<GuideScreen />);
    await act(async () => {
      await fireEvent.press(await screen.findByRole('button', { name: 'Rechazar' }));
    });
    expect(await screen.findByText(/Rechazado: el agente no tiene este acceso/)).toBeTruthy();
  });

  it('a failed approval says why next to the buttons and keeps them', async () => {
    approve = async () => reply(409, { error: 'already_decided', message: 'x' });
    serve(checkedView(true));
    await render(<GuideScreen />);
    await act(async () => {
      await fireEvent.press(await screen.findByRole('button', { name: 'Aprobar' }));
    });
    expect(await screen.findByText('Ya lo ha decidido otra persona.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeTruthy();
  });

  it('whoever did it, not an owner, reads that an owner has to approve it, with nothing to press', async () => {
    serve(checkedView(false));
    await render(<GuideScreen />);
    expect(await screen.findByText(/Falta que lo apruebe quien es propietario/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
  });
});

describe('the secret field on the web', () => {
  it('asks the browser not to fill in the person\'s own password', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const noop = () => {};
    await render(
      <GuideBlocks
        step={{ blocks: [{ type: 'secret', field: 'password', label: 'La contraseña de aplicación' }, { type: 'confirm' }] }}
        values={{}}
        onValue={noop}
        fieldError={null}
        shot={null}
        busy={null}
        onAnswer={noop}
        onCheck={noop}
        missing={[]}
        connector={{ canConnect: false, run: async () => null }}
      />,
    );
    expect(screen.getByLabelText('La contraseña de aplicación').props.autoComplete).toBe('new-password');
    jest.restoreAllMocks();
  });
});

describe('when a guide was checked', () => {
  const now = new Date('2026-11-24T18:00:00+01:00');
  it('reads as today, yesterday or the day', () => {
    expect(checkedWhen('2026-11-24T09:00:00+01:00', now)).toBe('hoy');
    expect(checkedWhen('2026-11-23T23:30:00+01:00', now)).toBe('ayer');
    expect(checkedWhen('2026-11-20T10:00:00+01:00', now)).toBe('el 20 nov');
  });
});

describe('an owner approving from the card', () => {
  const agentMessage = (status: GuidePart['status']): ChatMessage => ({
    id: 'm1',
    threadId: 't1',
    authorKind: 'agent',
    authorUserId: null,
    authorAgentId: 'a1',
    authorName: 'Redes',
    parts: [{ ...guide, status }],
    state: 'done',
    steps: [],
    createdAt: '2026-11-24T10:00:00Z',
  });

  it('leaves the agent going on to the engine, which does it as whoever did the guide: this chat does not resume it too', async () => {
    const urls: string[] = [];
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return reply(200, String(input).endsWith('/approve') ? { status: 'done', resumed: true } : { resumed: true });
    }) as typeof fetch;
    const { result, rerender } = await renderHook(({ messages }: { messages: ChatMessage[] }) => useGuideCards({ messages, isOwner: true, owners: ['Ana'], canTalk: true }), {
      initialProps: { messages: [agentMessage('checked')] },
    });
    await act(async () => {
      expect(await result.current.decide('g1', 'approve')).toBeNull();
    });
    await rerender({ messages: [agentMessage('done')] });
    await act(async () => {});
    expect(urls.filter((u) => u.endsWith('/approve'))).toHaveLength(1);
    expect(urls.filter((u) => u.endsWith('/resume'))).toHaveLength(0);
  });

  it('when the engine could not let the agent go on yet, this chat does it once the conversation moves', async () => {
    const urls: string[] = [];
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return reply(200, String(input).endsWith('/approve') ? { status: 'done', resumed: false } : { resumed: true });
    }) as typeof fetch;
    const { result, rerender } = await renderHook(({ messages }: { messages: ChatMessage[] }) => useGuideCards({ messages, isOwner: true, owners: ['Ana'], canTalk: true }), {
      initialProps: { messages: [agentMessage('checked')] },
    });
    await act(async () => {
      await result.current.decide('g1', 'approve');
    });
    await rerender({ messages: [agentMessage('done')] });
    await waitFor(() => expect(urls.filter((u) => u.endsWith('/resume'))).toHaveLength(1));
  });
});
