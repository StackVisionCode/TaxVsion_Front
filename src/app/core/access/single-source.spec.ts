import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * B2, criterio de aceptación: nadie lee los permisos por su cuenta.
 *
 * Mientras cada componente preguntaba `currentUser().permissions`, la misma pregunta tenía tantas
 * respuestas como pantallas: una miraba el permiso pero no el plan, otra usaba el actor type. El
 * único lugar autorizado a leerlo es el respaldo del propio store.
 */
describe('una sola fuente de autorización', () => {
  const ROOT = join(process.cwd(), 'src', 'app');
  const ALLOWED = join('core', 'access', 'access.store.ts');

  function typescriptFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(entry => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return typescriptFiles(full);
      return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
    });
  }

  it('solo el store lee los permisos del perfil de sesión', () => {
    const offenders = typescriptFiles(ROOT)
      .filter(file => /currentUser\(\)\??\.\s*permissions/.test(readFileSync(file, 'utf8')))
      .map(file => file.slice(ROOT.length + 1))
      .filter(file => file !== ALLOWED);

    expect(
      offenders,
      `Estos archivos leen los permisos directamente: ${offenders.join(', ')}. Usá PermissionService ` +
        'o AccessStore, que además miran el módulo del plan.',
    ).toEqual([]);
  });
});
