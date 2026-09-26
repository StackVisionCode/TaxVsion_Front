import { UserTableComponent } from './user-table.component';

/**
 * El estado 'removed' (offboarded) es terminal: se etiqueta "Removed" y usa un chip NEUTRO (gris), no el
 * rojo de 'suspended' — no es un estado accionable. (Que el menú "..." se oculte en filas removed es
 * lógica de plantilla, cubierta por el build AOT + E2E.)
 */
describe('UserTableComponent — removed status', () => {
  const component = new UserTableComponent();

  it('labels removed as "Removed"', () => {
    expect(component.statusLabel('removed')).toBe('Removed');
  });

  it('uses a neutral (non-red) chip for removed', () => {
    const chip = component.statusChip('removed');
    expect(chip).toContain('gray');
    expect(chip).not.toContain('red');
  });

  it('uses a neutral dot for removed', () => {
    expect(component.statusDotClass('removed')).toBe('bg-gray-400');
  });
});
