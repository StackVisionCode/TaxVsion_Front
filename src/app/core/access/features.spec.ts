import { Routes } from '@angular/router';
import { routes } from '../../app.routes';
import { accessCanMatch } from './access.guard';
import { FEATURES, NON_FEATURE_ROUTES, featureByRoute } from './features';

/**
 * B0 — el criterio de aceptación de la fase: el 100 % de las rutas del shell está mapeado.
 *
 * Lee el router REAL, no una copia: una ruta nueva sin feature rompe este test el día que se agrega,
 * que es cuando sale barato arreglarlo. Si al mapa lo mantuviéramos a mano, la primera pantalla que
 * alguien agregue sin pasar por acá queda fuera del menú y del guard sin que nadie se entere.
 */
describe('registro de features', () => {
  /** Los hijos del shell: el nodo con `canActivateChild` y varias rutas hijas. */
  function shellChildren(all: Routes): Routes {
    const shell = all.find(route => route.canActivateChild && (route.children?.length ?? 0) > 1);
    if (!shell?.children) throw new Error('No se encontró el shell en app.routes.ts');
    return shell.children;
  }

  const shell = shellChildren(routes);

  const shellRoutes = shell
    .map(route => route.path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0);

  it('encuentra las rutas del shell', () => {
    expect(shellRoutes.length).toBeGreaterThan(20);
    expect(shellRoutes).toContain('clients');
  });

  it('mapea todas las rutas del shell', () => {
    const unmapped = shellRoutes.filter(
      path => !featureByRoute(path) && !NON_FEATURE_ROUTES.includes(path),
    );

    expect(
      unmapped,
      `Estas rutas del shell no tienen feature: ${unmapped.join(', ')}. Agregalas a FEATURES, o a ` +
        'NON_FEATURE_ROUTES si son una redirección y no una pantalla.',
    ).toEqual([]);
  });

  it('no declara features de rutas que no existen', () => {
    // Una feature puede apuntar a una SUBRUTA (`clients/import`): tiene su propio permiso aunque
    // viva dentro de otra pantalla. Basta con que su primer segmento sea una ruta del shell — el
    // guard resuelve por prefijo (`featureForUrl`), así que el mapeo sigue siendo exacto.
    const orphans = FEATURES.map(feature => feature.route).filter(
      route => !shellRoutes.includes(route) && !shellRoutes.includes(route.split('/')[0]),
    );

    expect(orphans, `Features sin ruta en el shell: ${orphans.join(', ')}.`).toEqual([]);
  });

  it('no repite ids ni rutas', () => {
    expect(new Set(FEATURES.map(f => f.id)).size).toBe(FEATURES.length);
    expect(new Set(FEATURES.map(f => f.route)).size).toBe(FEATURES.length);
  });

  it('usa códigos de permission, nunca nombres de rol', () => {
    // Un código es `area.cosa` o `area.cosa.detalle`, siempre en minúsculas. Un nombre de rol
    // ("TenantAdmin") no tiene puntos: si alguien mete uno, el store de B2 nunca lo encontraría.
    const codes = FEATURES.flatMap(feature => feature.anyOf);

    for (const code of codes) {
      expect(code, `"${code}" no parece un código de permission`).toMatch(
        /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/,
      );
    }
  });

  // ---------- B4: el router y el registro no pueden desincronizarse ----------

  it('cada ruta con feature declara la MISMA que el registro', () => {
    // `data.feature` existe para que el guard no tenga que adivinar por la ruta. El precio es un
    // dato repetido, y este test es lo que impide que las dos copias se separen.
    for (const route of shell) {
      const declared = route.data?.['feature'];
      if (declared === undefined) {
        continue;
      }
      const expected = featureByRoute(route.path!)?.id;
      expect(declared, `la ruta "${route.path}" declara "${declared}"`).toBe(expected);
    }
  });

  it('toda ruta del shell que es una feature pasa por el guard', () => {
    const unguarded = shell.filter(route => {
      const path = route.path;
      if (typeof path !== 'string' || path.length === 0 || !featureByRoute(path)) {
        return false;
      }
      return route.data?.['feature'] === undefined || !route.canMatch?.includes(accessCanMatch);
    });

    expect(
      unguarded.map(route => route.path),
      'Estas rutas son features pero no las gatea nadie: una URL escrita a mano entra igual.',
    ).toEqual([]);
  });

  it('las páginas de aviso NO se gatean', () => {
    // Si el guard pudiera rebotar `/forbidden`, una denegación sería un bucle de redirecciones.
    const notices = shell.filter(route => ['forbidden', 'not-available', 'error'].includes(route.path ?? ''));

    expect(notices.length).toBe(3);
    for (const notice of notices) {
      expect(notice.data?.['feature'], `"${notice.path}" no puede declarar feature`).toBeUndefined();
      expect(notice.canMatch, `"${notice.path}" no puede tener canMatch`).toBeUndefined();
    }
  });

  it('toda feature tiene una etiqueta legible', () => {
    for (const feature of FEATURES) {
      expect(feature.label, `la feature "${feature.id}" no tiene label`).toBeTruthy();
      // En inglés y como lo leería una persona: nunca el id crudo.
      expect(feature.label, `"${feature.label}" parece un id, no una etiqueta`).not.toMatch(/^[a-z-]+$/);
    }
  });
});
