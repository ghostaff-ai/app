import { parseClock, routineRefusal, titleFrom } from '@/lib/routines';

describe('the routine form (agent-routines.md)', () => {
  it('reads an hour as people write it', () => {
    expect(parseClock('9')).toEqual({ hour: 9, minute: 0 });
    expect(parseClock('9:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseClock(' 18.05 ')).toEqual({ hour: 18, minute: 5 });
    expect(parseClock('8h15')).toEqual({ hour: 8, minute: 15 });
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('9:7')).toBeNull();
    expect(parseClock('mañana')).toBeNull();
  });

  it('names a routine from what it does when the person gives no name', () => {
    expect(titleFrom('  Mándame el resumen  de ventas ')).toBe('Mándame el resumen de ventas');
    expect(titleFrom('Revisa las facturas pendientes de todos los proveedores y dime cuáles vencen')).toBe(
      'Revisa las facturas pendientes de todos…',
    );
  });

  it('says why the database refused, in words', () => {
    expect(routineRefusal({ code: '54000' })).toMatch(/10 tareas programadas/);
    expect(routineRefusal({ code: '42501' })).toMatch(/propietario/);
    expect(routineRefusal(new Error('fetch failed'))).toMatch(/Vuelve a intentarlo/);
  });
});
