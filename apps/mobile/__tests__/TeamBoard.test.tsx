import type { Agent, ChatThread, Decision, OrgMember } from '@ghostaff/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { TeamBoard } from '@/components/team/TeamBoard';

type Space = { id: string; slug: string; name: string; kind: 'company'; role: 'owner' | 'member'; displayName: string };

const agent = (id: string, name: string, ghost: Agent['ghost'], department: Agent['department'], isMain = false): Agent =>
  ({ id, orgId: 'o', name, ghost, department, isMain, description: null, task: '', runner: 'chat' }) as unknown as Agent;

let mockTeam: {
  active: Space | null;
  agents: { items: Agent[]; loading: boolean; error: string | null };
  threads: ChatThread[];
  members: OrgMember[];
  decisions: Decision[];
  working: Set<string>;
  noAi: boolean;
  owner: boolean;
  reload: () => void;
  reloadThreads: () => void;
};

jest.mock('@/lib/tabs', () => ({ useTabScreenTop: () => 0 }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/SpaceSwitcher', () => ({ SpaceSwitcher: () => null }));
jest.mock('@/components/chat/Message', () => ({ Avatar: () => null }));
jest.mock('@/lib/hooks/useTeam', () => ({ useTeam: () => mockTeam }));

const space: Space = { id: 'o', slug: 'ordago', name: 'Órdago', kind: 'company', role: 'owner', displayName: 'Jaime' };
const secretaria = agent('s', 'Secretaría', 'secretaria', 'direccion', true);
const cuentas = agent('c', 'Cuentas', 'finanzas', 'finanzas');
const redes = agent('r', 'Redes', 'redes', 'marketing');
const general: ChatThread = {
  id: 'g',
  kind: 'general',
  agentId: null,
  title: 'General',
  createdAt: '2026-11-27T08:00:00Z',
  lastMessageAt: '2026-11-27T09:00:00Z',
  lastAuthor: 'Álvaro',
  lastText: 'hola',
  lastVoiceMs: null,
  unread: true,
  following: true,
};

beforeEach(() => {
  jest.mocked(router.push).mockClear();
  mockTeam = {
    active: space,
    agents: { items: [secretaria, cuentas, redes], loading: false, error: null },
    threads: [general],
    members: [
      { userId: 'u1', displayName: 'Jaime', role: 'owner' },
      { userId: 'u2', displayName: 'Álvaro', role: 'owner' },
    ],
    decisions: [{ id: 'd1', answer: null, agent: { id: 'c', name: 'Cuentas', ghost: 'finanzas' } } as Decision],
    working: new Set(['r']),
    noAi: false,
    owner: true,
    reload: jest.fn(),
    reloadThreads: jest.fn(),
  };
});

describe('TeamBoard', () => {
  it('puts General first, then the main agent, then the others and «Contratar»', async () => {
    await render(<TeamBoard />);
    expect(screen.getByTestId('general')).toBeOnTheScreen();
    expect(screen.getByTestId('agent-secretaria')).toBeOnTheScreen();
    expect(screen.getByTestId('agent-finanzas')).toBeOnTheScreen();
    expect(screen.getByTestId('agent-redes')).toBeOnTheScreen();
    expect(screen.getByTestId('add-agent')).toBeOnTheScreen();
    expect(screen.getByTestId('general-unread')).toBeOnTheScreen();
  });

  it('shows above each ghost what it is doing', async () => {
    await render(<TeamBoard />);
    expect(screen.getByText('Te espera')).toBeOnTheScreen();
    expect(screen.getByText('Trabajando')).toBeOnTheScreen();
  });

  it('opens the main agent’s chat, and any other agent’s page', async () => {
    await render(<TeamBoard />);
    await fireEvent.press(screen.getByTestId('agent-secretaria'));
    expect(router.push).toHaveBeenCalledWith('/chat/s');
    await fireEvent.press(screen.getByTestId('agent-finanzas'));
    expect(router.push).toHaveBeenCalledWith('/agente/c');
  });

  it('leaves «Contratar» to an owner', async () => {
    mockTeam.owner = false;
    await render(<TeamBoard />);
    expect(screen.queryByTestId('add-agent')).toBeNull();
  });

  it('has no General for someone alone', async () => {
    mockTeam.members = [{ userId: 'u1', displayName: 'Jaime', role: 'owner' }];
    await render(<TeamBoard />);
    expect(screen.queryByTestId('general')).toBeNull();
  });
});
