import { DESKTOP_MIN_WIDTH, desktopSection, isDesktopWidth } from '@/lib/layout';

describe('isDesktopWidth', () => {
  it('is a desktop only on the web, from the breakpoint up', () => {
    expect(isDesktopWidth('web', DESKTOP_MIN_WIDTH)).toBe(true);
    expect(isDesktopWidth('web', 1440)).toBe(true);
    expect(isDesktopWidth('web', DESKTOP_MIN_WIDTH - 1)).toBe(false);
  });

  it('keeps the phone layout on native, however wide (a tablet in landscape)', () => {
    expect(isDesktopWidth('ios', 1366)).toBe(false);
    expect(isDesktopWidth('android', 1280)).toBe(false);
  });
});

describe('desktopSection', () => {
  it('keeps Equipo’s list beside a chat and every page about an agent or a conversation', () => {
    expect(desktopSection('/')).toEqual({ nav: 'equipo', list: 'team', open: null });
    expect(desktopSection('/chat/a1')).toEqual({ nav: 'equipo', list: 'team', open: 'a1' });
    expect(desktopSection('/conversacion/t1')).toEqual({ nav: 'equipo', list: 'team', open: 't1' });
    expect(desktopSection('/agente/a1')).toEqual({ nav: 'equipo', list: 'team', open: 'a1' });
    expect(desktopSection('/herramientas/a1').nav).toBe('equipo');
    expect(desktopSection('/rutinas/a1').list).toBe('team');
  });

  it('gives hiring a page of its own, under Equipo', () => {
    expect(desktopSection('/anadir-agente')).toEqual({ nav: 'equipo', list: null, open: null });
  });

  it('leaves Decisiones without a list: the deck stays centred', () => {
    expect(desktopSection('/decisiones')).toEqual({ nav: 'decisiones', list: null, open: null });
    expect(desktopSection('/decision/d1').nav).toBe('decisiones');
  });

  it('keeps Conexiones’ list beside a connection, not beside the catalogue', () => {
    expect(desktopSection('/empresa/conexiones')).toEqual({ nav: 'conexiones', list: 'connections', open: null });
    expect(desktopSection('/empresa/conexiones/google')).toEqual({ nav: 'conexiones', list: 'connections', open: 'google' });
    expect(desktopSection('/empresa/conexiones/ia/anthropic')).toEqual({ nav: 'conexiones', list: 'connections', open: 'ia' });
    expect(desktopSection('/empresa/conexiones/anadir')).toEqual({ nav: 'conexiones', list: null, open: null });
  });

  it('marks Registro and Empresa apart', () => {
    expect(desktopSection('/empresa/registro').nav).toBe('registro');
    expect(desktopSection('/empresa/memoria').nav).toBe('memoria');
    expect(desktopSection('/memoria/proveedores/gestoria.md').nav).toBe('memoria');
    // An agent's own memory is under the agent, in Equipo.
    expect(desktopSection('/agente/a1/memoria/como-trabajo.md')).toEqual({ nav: 'equipo', list: 'team', open: 'a1' });
    expect(desktopSection('/empresa').nav).toBe('empresa');
    expect(desktopSection('/invitar').nav).toBe('empresa');
  });

  it('marks nothing on a page of no section', () => {
    expect(desktopSection('/organizaciones')).toEqual({ nav: null, list: null, open: null });
  });
});
