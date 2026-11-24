import type { ChatMessage, GuidePart, GuideStep, GuideView } from '@ghostaff/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import GuideScreen from '@/app/(app)/guia/[id]';
import { GuideCard } from '@/components/chat/GuideCard';
import { AnnotatedShot } from '@/components/guide/AnnotatedShot';
import { type GuideControls, guidesToResume } from '@/lib/hooks/useGuideCards';

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
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));

const guide: GuidePart = { type: 'guide', guideId: 'g1', app: 'WordPress', why: 'Para publicar tus entradas', status: 'open' };

const controls = (over: Partial<GuideControls> = {}): GuideControls => ({
  canTalk: true,
  isOwner: true,
  owners: ['Ana'],
  resuming: () => false,
  open: jest.fn(),
  decide: jest.fn(async () => null),
  connect: jest.fn(async () => null),
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

  it('handed over: an owner connects the catalogue\'s app; a member reads who can', async () => {
    const handed: GuidePart = { ...guide, status: 'handed_over', connector: 'wordpress', decidedBy: 'Luis' };
    const o = owner();
    const { rerender } = await render(<GuideCard guide={handed} controls={o} />);
    await fireEvent.press(screen.getByText('Conectar WordPress.com'));
    await waitFor(() => expect(o.connect).toHaveBeenCalledWith('wordpress'));
    await rerender(<GuideCard guide={handed} controls={member()} />);
    expect(screen.queryByText('Conectar WordPress.com')).toBeNull();
    expect(screen.getByText('Lo conecta quien es propietario: Ana.')).toBeTruthy();
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
