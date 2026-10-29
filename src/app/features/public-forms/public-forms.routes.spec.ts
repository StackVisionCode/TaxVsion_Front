import { AppShellComponent } from '../../layout/app-shell/app-shell.component';
import { routes } from '../../app.routes';
import { describe, expect, it } from 'vitest';

describe('public form routes', () => {
  it.each([
    ['f/:token', 'directed'],
    ['intake/:token', 'intake'],
  ])('mantiene %s fuera del shell autenticado', (path, kind) => {
    const route = routes.find((candidate) => candidate.path === path);
    const shellIndex = routes.findIndex((candidate) => candidate.component === AppShellComponent);
    const routeIndex = routes.indexOf(route!);

    expect(route).toBeDefined();
    expect(routeIndex).toBeGreaterThanOrEqual(0);
    expect(routeIndex).toBeLessThan(shellIndex);
    expect(route?.canActivate).toBeUndefined();
    expect(route?.canMatch).toBeUndefined();
    expect(route?.data?.['kind']).toBe(kind);
    expect(route?.data?.['preload']).toBe(false);
  });
});
