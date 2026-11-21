import type { ActionPart } from '@ghostaff/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ActionCard } from '@/components/chat/Message';

const action: ActionPart = {
  type: 'action',
  actionId: 'a1',
  label: 'Publicar en Instagram',
  preview: 'kind: reel\ncaption: Torneo del sábado',
  status: 'pending',
};

describe('an action an agent proposes', () => {
  it('an owner sees what it will do and can approve it', async () => {
    const onDecide = jest.fn(async () => {});
    await render(<ActionCard action={action} canDecide onDecide={onDecide} />);
    expect(screen.getByText('Publicar en Instagram')).toBeTruthy();
    expect(screen.getByText(/Torneo del sábado/)).toBeTruthy();
    expect(screen.getByText('Pendiente de aprobación')).toBeTruthy();
    await fireEvent.press(screen.getByText('Aprobar'));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith('a1', 'approve'));
  });

  it('anyone else sees it wait for an owner, with no buttons', async () => {
    await render(<ActionCard action={action} canDecide={false} />);
    expect(screen.queryByText('Aprobar')).toBeNull();
    expect(screen.getByText('Lo aprueba quien es propietario de la empresa.')).toBeTruthy();
  });

  it('once done, says who approved it and shows the link', async () => {
    await render(
      <ActionCard
        action={{ ...action, status: 'done', decidedBy: 'Ana', result: '{"published":true,"link":"https://instagram.com/p/xyz"}' }}
        canDecide
      />,
    );
    expect(screen.getByText('Hecho · Ana')).toBeTruthy();
    expect(screen.getByText('https://instagram.com/p/xyz')).toBeTruthy();
    expect(screen.queryByText('Aprobar')).toBeNull();
  });
});
