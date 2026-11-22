import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { CodeStep, RESEND_AFTER_S } from '@/components/auth/CodeStep';

const setup = async (over: Partial<Parameters<typeof CodeStep>[0]> = {}) => {
  const props = {
    email: 'ana@ejemplo.com',
    busy: false,
    onVerify: jest.fn(),
    onResend: jest.fn(() => Promise.resolve()),
    onChangeEmail: jest.fn(),
    ...over,
  };
  await render(<CodeStep {...props} />);
  return props;
};

describe('CodeStep', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('signs in on its own once the sixth digit is in, keeping only digits', async () => {
    const { onVerify } = await setup();
    const box = screen.getByLabelText('Código');
    await fireEvent.changeText(box, '332 5');
    expect(onVerify).not.toHaveBeenCalled();
    await fireEvent.changeText(box, '332 529');
    expect(onVerify).toHaveBeenCalledTimes(1);
    expect(onVerify).toHaveBeenCalledWith('332529');
  });

  it('does not send the same code twice while it is still being checked', async () => {
    const { onVerify } = await setup({ busy: true });
    await fireEvent.changeText(screen.getByLabelText('Código'), '332529');
    expect(onVerify).not.toHaveBeenCalled();
  });

  it('lets you resend only after the wait, then starts the wait again', async () => {
    const { onResend } = await setup();
    expect(screen.getByRole('button', { name: `Reenviar código en ${RESEND_AFTER_S} s` })).toBeDisabled();

    await act(async () => {
      jest.advanceTimersByTime(RESEND_AFTER_S * 1000);
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Reenviar código' }));
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Te hemos mandado otro.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `Reenviar código en ${RESEND_AFTER_S} s` })).toBeDisabled();
  });

  it('says where to look when the mail does not arrive, and lets you change the email', async () => {
    const { onChangeEmail } = await setup();
    expect(screen.getByText(/mira en spam o en promociones/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Usar otro correo' }));
    expect(onChangeEmail).toHaveBeenCalled();
  });
});
