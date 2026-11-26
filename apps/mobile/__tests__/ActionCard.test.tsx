import type { ActionPart } from '@ghostaff/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ActionCard, changedTexts } from '@/components/chat/Message';

// The decision card reads the database; these tests are about other parts.
jest.mock('@/components/chat/DecisionInChat', () => ({ DecisionInChat: () => null, DecisionQuote: () => null }));

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

  it('without editable text there is no «Editar»', async () => {
    await render(<ActionCard action={action} canDecide onDecide={jest.fn(async () => {})} />);
    expect(screen.queryByText('Editar')).toBeNull();
  });
});

describe('«Editar»: changing what the agent drafted before approving it', () => {
  const editable: ActionPart = { ...action, editable: [{ field: 'caption', label: 'Texto', value: 'Torneo del sábado', max: 2200, multiline: true }] };

  it('an owner changes the text and approves it: only the change is sent', async () => {
    const onDecide = jest.fn(async () => {});
    await render(<ActionCard action={editable} canDecide onDecide={onDecide} />);
    await fireEvent.press(screen.getByText('Editar'));
    await fireEvent.changeText(screen.getByLabelText('Texto'), 'Torneo del sábado a las 10');
    await fireEvent.press(screen.getByText('Aprobar'));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith('a1', 'approve', { caption: 'Torneo del sábado a las 10' }));
  });

  it('«Cancelar» goes back to the draft as it was, and approving then sends no change', async () => {
    const onDecide = jest.fn(async () => {});
    await render(<ActionCard action={editable} canDecide onDecide={onDecide} />);
    await fireEvent.press(screen.getByText('Editar'));
    await fireEvent.changeText(screen.getByLabelText('Texto'), 'Otra cosa');
    expect(screen.queryByText('Rechazar')).toBeNull();
    await fireEvent.press(screen.getByText('Cancelar'));
    expect(screen.getByText(/Torneo del sábado/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Aprobar'));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith('a1', 'approve'));
  });

  it('an emptied text is not sent', async () => {
    const onDecide = jest.fn(async () => {});
    await render(<ActionCard action={editable} canDecide onDecide={onDecide} />);
    await fireEvent.press(screen.getByText('Editar'));
    await fireEvent.changeText(screen.getByLabelText('Texto'), '  ');
    await fireEvent.press(screen.getByText('Aprobar'));
    expect(screen.getByText('Ningún texto puede quedar vacío.')).toBeTruthy();
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('nobody but who decides sees «Editar»; once done, the card says it ran with changes', async () => {
    await render(<ActionCard action={editable} canDecide={false} />);
    expect(screen.queryByText('Editar')).toBeNull();
    await render(<ActionCard action={{ ...editable, status: 'done', decidedBy: 'Ana', edited: true }} canDecide />);
    expect(screen.getByText('Hecho · Ana · con cambios')).toBeTruthy();
  });

  it('sends only what differs, and nothing with an empty text', () => {
    const fields = [
      { field: 'subject', label: 'Asunto', value: 'Hola', max: 300 },
      { field: 'text', label: 'Texto', value: 'Buenas', max: 300, multiline: true },
    ];
    expect(changedTexts(fields, { subject: 'Hola', text: 'Buenas tardes' })).toEqual({ text: 'Buenas tardes' });
    expect(changedTexts(fields, { subject: '', text: 'Buenas' })).toBeNull();
  });
});
