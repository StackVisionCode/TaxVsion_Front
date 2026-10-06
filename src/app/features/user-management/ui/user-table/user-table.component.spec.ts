import { UserTableComponent } from './user-table.component';

/**
 * El estado 'removed' (offboarded) es terminal: se etiqueta "Removed" y usa un tono NEUTRO (gris
 * apagado), no el 'danger' de 'suspended' — no es un estado accionable. (Que el menú "..." se oculte en
 * filas removed es lógica de plantilla, cubierta por el build AOT + E2E.)
 */
describe('UserTableComponent — removed status', () => {
  const component = new UserTableComponent();

  it('labels removed as "Removed"', () => {
    expect(component.statusLabel('removed')).toBe('Removed');
  });

  it('uses a neutral (non-danger) tone for removed', () => {
    expect(component.statusTone('removed')).toBe('muted');
    expect(component.statusTone('suspended')).toBe('danger');
  });
});
