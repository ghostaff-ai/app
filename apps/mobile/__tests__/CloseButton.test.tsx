import { fireEvent, render, screen } from '@testing-library/react-native';
import { CloseButton } from '@/components/CloseButton';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), replace: (p: string) => mockReplace(p), canGoBack: () => mockCanGoBack },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
});

describe('CloseButton', () => {
  it('goes back to where you were', async () => {
    await render(<CloseButton />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('goes to Hoy when the sheet was opened cold, with nothing behind it', async () => {
    mockCanGoBack = false;
    await render(<CloseButton />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('does what it is told instead, when told', async () => {
    const onPress = jest.fn();
    await render(<CloseButton onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });
});
