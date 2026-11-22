import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AskForConnector } from '@/components/connections/AskForConnector';

describe('asking for a connector we lack', () => {
  it('when the search finds nothing, offers to ask for exactly what was searched', async () => {
    const onAsk = jest.fn(async () => {});
    await render(<AskForConnector searched="  Glovo " asked={[]} onAsk={onAsk} />);
    expect(screen.getByText('Aún no tenemos «Glovo».')).toBeTruthy();
    await fireEvent.press(screen.getByText('Pedir Glovo'));
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('Glovo'));
    expect(await screen.findByText('Apuntado. Avisaremos cuando esté.')).toBeTruthy();
  });

  it('without a search, lets anyone name the app they miss', async () => {
    const onAsk = jest.fn(async () => {});
    await render(<AskForConnector searched="" asked={[]} onAsk={onAsk} />);
    expect(screen.getByText('¿Falta alguna?')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('¿Qué aplicación usáis?'), 'Factusol');
    await fireEvent.press(screen.getByText('Pedirla'));
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('Factusol'));
  });

  it('shows what the organisation already asked for, and who', async () => {
    await render(
      <AskForConnector searched="" asked={[{ name: 'Glovo', requestedByName: 'Bea', createdAt: '2026-11-19T21:00:00Z' }]} onAsk={jest.fn()} />,
    );
    expect(screen.getByText('Ya pedidas: Glovo (Bea)')).toBeTruthy();
  });

  it('an app already asked for is not asked again', async () => {
    const onAsk = jest.fn(async () => {});
    await render(<AskForConnector searched="glovo" asked={[{ name: 'Glovo', requestedByName: 'Bea', createdAt: '2026-11-19T21:00:00Z' }]} onAsk={onAsk} />);
    expect(screen.getByText('Ya la habéis pedido. Avisaremos cuando esté.')).toBeTruthy();
    expect(screen.queryByText('Pedir glovo')).toBeNull();
  });

  it('says so in words when asking fails', async () => {
    const onAsk = jest.fn(async () => {
      throw new Error('network');
    });
    await render(<AskForConnector searched="Glovo" asked={[]} onAsk={onAsk} />);
    await fireEvent.press(screen.getByText('Pedir Glovo'));
    expect(await screen.findByText('No se ha podido apuntar. Prueba otra vez.')).toBeTruthy();
  });
});
