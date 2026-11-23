import { fireEvent, render, screen } from '@testing-library/react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import Welcome from '@/app/(app)/bienvenida';

const calls: string[] = [];
const mockSave = jest.fn(async () => {
  calls.push('save');
});

jest.mock('@/lib/profile/ProfileContext', () => ({ useProfile: () => ({ save: mockSave }) }));
jest.mock('@/lib/auth/AuthContext', () => ({ useAuth: () => ({ session: null }) }));
jest.mock('@/components/ghost/GhostViewer', () => ({ GhostViewer: () => null }));

describe('Welcome', () => {
  it('closes the keyboard before saving the name, so the next step starts without it', async () => {
    jest.mocked(KeyboardController.dismiss).mockImplementation(async () => {
      calls.push('dismiss');
    });
    await render(<Welcome />);
    await fireEvent.changeText(screen.getByPlaceholderText('Nombre y apellido'), 'Ana');
    await fireEvent.press(screen.getByText('Seguir'));
    expect(calls).toEqual(['dismiss', 'save']);
    expect(mockSave).toHaveBeenCalledWith({ fullName: 'Ana', occupation: null, heardFrom: null });
  });
});
