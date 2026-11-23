import type { AccountAskPart, ChatMessage } from '@ghostaff/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccountAskCard } from '@/components/chat/AccountAskCard';
import { type AskControls, asksToResume } from '@/lib/hooks/useAccountAsks';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const ask: AccountAskPart = {
  type: 'account_ask',
  askId: 'k1',
  connector: 'notion',
  name: 'Notion',
  why: 'Para leer tus notas de la reunión',
  need: 'connect',
  status: 'open',
};

const controls = (over: Partial<AskControls> = {}): AskControls => ({
  canConnect: true,
  owners: ['Ana'],
  requested: () => false,
  resuming: () => false,
  act: jest.fn(async () => null),
  ...over,
});

describe('an agent asking for an account in the chat', () => {
  it('an owner sees what it needs and why, and connects it from the card', async () => {
    const c = controls();
    await render(<AccountAskCard ask={ask} controls={c} />);
    expect(screen.getByText('Necesito acceso a Notion')).toBeTruthy();
    expect(screen.getByText('Para leer tus notas de la reunión')).toBeTruthy();
    await fireEvent.press(screen.getByText('Conectar Notion'));
    await waitFor(() => expect(c.act).toHaveBeenCalledWith(ask));
  });

  it('a member reads who can connect it, with no button', async () => {
    await render(<AccountAskCard ask={ask} controls={controls({ canConnect: false, owners: ['Ana', 'Jaime'] })} />);
    expect(screen.queryByText('Conectar Notion')).toBeNull();
    expect(screen.getByText('Lo conecta quien es propietario: Ana, Jaime.')).toBeTruthy();
  });

  it('says what went wrong next to the button', async () => {
    await render(<AccountAskCard ask={ask} controls={controls({ act: async () => 'No has dado permiso, así que no hemos conectado nada.' })} />);
    await fireEvent.press(screen.getByText('Conectar Notion'));
    expect(await screen.findByText('No has dado permiso, así que no hemos conectado nada.')).toBeTruthy();
  });

  it('an account it lost, and one it was not given, each with its own button', async () => {
    const { rerender } = await render(<AccountAskCard ask={{ ...ask, need: 'reconnect' }} controls={controls()} />);
    expect(screen.getByText('Notion ya no me da acceso')).toBeTruthy();
    expect(screen.getByText('Volver a conectar')).toBeTruthy();
    await rerender(<AccountAskCard ask={{ ...ask, need: 'grant' }} controls={controls()} />);
    expect(screen.getByText('Notion está conectada, pero no la tengo')).toBeTruthy();
    expect(screen.getByText('Darle acceso')).toBeTruthy();
  });

  it('an app we lack can be asked for by anyone, once', async () => {
    const lacking: AccountAskPart = { ...ask, connector: undefined, name: 'Gmail', need: 'unsupported' };
    const { rerender } = await render(<AccountAskCard ask={lacking} controls={controls({ canConnect: false })} />);
    expect(screen.getByText('Todavía no podemos conectar Gmail')).toBeTruthy();
    expect(screen.getByText('Pedirlo')).toBeTruthy();
    await rerender(<AccountAskCard ask={lacking} controls={controls({ canConnect: false, requested: () => true })} />);
    expect(screen.queryByText('Pedirlo')).toBeNull();
    expect(screen.getByText(/^Pedido\./)).toBeTruthy();
  });

  it('once done, says who connected it, with no button', async () => {
    await render(<AccountAskCard ask={{ ...ask, status: 'done', doneBy: 'Ana' }} controls={controls()} />);
    expect(screen.getByText('Conectada por Ana')).toBeTruthy();
    expect(screen.queryByText('Conectar Notion')).toBeNull();
  });

  it('no button while the agent is still writing that message', async () => {
    await render(<AccountAskCard ask={ask} controls={controls()} writing />);
    expect(screen.queryByText('Conectar Notion')).toBeNull();
  });
});

describe('when the agent goes on by itself', () => {
  let n = 0;
  const message = (over: Partial<ChatMessage>): ChatMessage => ({
    id: `m${++n}`,
    threadId: 't1',
    authorKind: 'agent',
    authorUserId: null,
    authorAgentId: 'a1',
    authorName: 'Redes',
    parts: [],
    state: 'done',
    steps: [],
    createdAt: '2026-11-23T10:00:00Z',
    ...over,
  });
  const withAsk = (a: AccountAskPart, over: Partial<ChatMessage> = {}) => message({ parts: [{ type: 'text', text: 'Necesito Notion.' }, a], ...over });
  const always = () => true;

  it('the open card of the agent\'s latest message, once the account is there', () => {
    expect(asksToResume([withAsk(ask)], always)).toEqual([{ threadId: 't1', askId: 'k1' }]);
    expect(asksToResume([withAsk(ask)], () => false)).toEqual([]);
  });

  it('not an older card, a done one, an app we lack, or a message still being written', () => {
    expect(asksToResume([withAsk(ask), message({ parts: [{ type: 'text', text: 'Otra cosa.' }] })], always)).toEqual([]);
    expect(asksToResume([withAsk({ ...ask, status: 'done' })], always)).toEqual([]);
    expect(asksToResume([withAsk({ ...ask, need: 'unsupported', connector: undefined })], always)).toEqual([]);
    expect(asksToResume([withAsk(ask, { state: 'working' })], always)).toEqual([]);
  });

  it('still the agent\'s latest message when the person wrote after it', () => {
    const person = message({ authorKind: 'person', authorAgentId: null, authorUserId: 'u1', authorName: 'Ana', parts: [{ type: 'text', text: 'Vale, ahora lo conecto' }] });
    expect(asksToResume([withAsk(ask), person], always)).toEqual([{ threadId: 't1', askId: 'k1' }]);
  });
});
