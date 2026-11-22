import { CONNECTORS } from '@ghostaff/shared';
import { render, screen } from '@testing-library/react-native';
import { ConnectorLogo, luminance } from '@/components/connections/ConnectorLogo';
import { BRAND_LOGOS } from '@/lib/brandLogos';
import { AI_ORDER, connectorWhat } from '@/lib/connections';

describe('connector logos', () => {
  it('each logo belongs to a connector or an AI account, so none is left behind when one is removed', () => {
    const ids = new Set<string>([...CONNECTORS.map((c) => c.id), ...AI_ORDER.map((p) => `ai-${p}`)]);
    for (const id of Object.keys(BRAND_LOGOS)) expect(ids).toContain(id);
  });

  it('draws the mark in black on a light brand colour and in white on a dark one', () => {
    expect(luminance('#FFE01B')).toBeGreaterThan(0.55); // Mailchimp's yellow
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#0078D4')).toBeLessThan(0.55);
  });

  it('shows the initial when there is no logo', async () => {
    await render(<ConnectorLogo id="holded" name="Holded" />);
    expect(screen.getByText('H')).toBeTruthy();
  });
});

describe('a connector under its name', () => {
  it('says what it is for, without repeating the name', () => {
    expect(connectorWhat({ title: 'Google: tus reseñas' })).toBe('Tus reseñas');
    expect(connectorWhat({ title: 'Google Search Console: tu web en Google' })).toBe('Tu web en Google');
  });

  it('every card in the catalogue has a name and what it is for', () => {
    for (const c of CONNECTORS) {
      expect(c.title).toContain(': ');
    }
  });
});
