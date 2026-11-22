import { render, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';
import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { stepsFor } from '@/lib/onboarding';

jest.mock('@/components/ghost/GhostViewer', () => ({ GhostViewer: () => null }));
// The column that rides on the keyboard, made visible to the test.
jest.mock('@/lib/keyboard', () => {
  const { View } = require('react-native');
  return { KeyboardColumn: ({ children }: { children: unknown }) => <View testID="keyboard-column">{children}</View> };
});

const action = <Text>Seguir</Text>;

describe('OnboardingStep', () => {
  it('shows how far along you are, one dot per step', async () => {
    await render(<OnboardingStep ghost="base" step={2} of={4} title="¿Para qué?" action={action} />);
    expect(screen.getAllByTestId('step-dot')).toHaveLength(4);
    expect(screen.getAllByTestId('step-dot').filter((d) => d.props.accessibilityState?.selected)).toHaveLength(2);
    expect(screen.getByLabelText('Paso 2 de 4')).toBeOnTheScreen();
  });

  it('draws no dots when it is not part of the way in', async () => {
    await render(<OnboardingStep ghost="base" title="Conecta tu IA" action={action} />);
    expect(screen.queryAllByTestId('step-dot')).toHaveLength(0);
  });

  it('pins the main button to the bottom, riding on the keyboard', async () => {
    await render(<OnboardingStep ghost="base" step={1} of={3} title="¿Cómo te llamas?" line="Así firmarás." action={action} />);
    const footer = within(screen.getByTestId('keyboard-column')).getByTestId('onboarding-footer');
    expect(within(footer).getByText('Seguir')).toBeOnTheScreen();
    expect(screen.getByText('Así firmarás.')).toBeOnTheScreen();
  });
});

describe('stepsFor', () => {
  it('counts the way in: three for you, four for a company, and the shorter way before choosing', () => {
    expect(stepsFor('personal')).toBe(3);
    expect(stepsFor('company')).toBe(4);
    expect(stepsFor(null)).toBe(3);
  });
});
