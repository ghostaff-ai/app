import { fireEvent, render, screen } from '@testing-library/react-native';
import { LevelPicker } from '@/components/ui';

describe('LevelPicker', () => {
  it('offers Nada, Ver and Hablar and reports the one tapped', async () => {
    const onChange = jest.fn();
    await render(<LevelPicker label="Bea, Finanzas" value="read" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Ver, Bea, Finanzas' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'Hablar, Bea, Finanzas' }));
    expect(onChange).toHaveBeenCalledWith('talk');
  });

  it('does nothing when the chosen one is tapped again, or when disabled', async () => {
    const onChange = jest.fn();
    const { rerender } = await render(<LevelPicker label="Bea" value="none" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Nada, Bea' }));
    await rerender(<LevelPicker label="Bea" value="none" onChange={onChange} disabled />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Hablar, Bea' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
