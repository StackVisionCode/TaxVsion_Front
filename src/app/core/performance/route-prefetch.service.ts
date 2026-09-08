import { Injectable } from '@angular/core';

/**
 * Precarga (fetch + parse) de los chunks de una sección ANTES de navegar a ella.
 *
 * NO usa el Router: dispara los MISMOS `import()` que el Router usaría. Como el módulo
 * resuelto es el mismo archivo, esbuild emite UN solo chunk y el `import()` del Router
 * después resuelve del module cache del navegador (cero red). Los alias `@features/*`
 * resuelven al mismo archivo que las rutas relativas de `app.routes.ts`, así que no
 * duplican chunk.
 *
 * `router.navigateByUrl` anticipado NO sirve para esto: navegaría de verdad, dispararía
 * el authGuard, montaría el shell y desmontaría el login a mitad de la animación.
 *
 * OJO: hay DOS niveles que precargar por sección — el `*.routes.ts` (loadChildren) y el
 * componente de página (loadComponent). Precargar solo el primero deja el segundo RTT
 * intacto y la mejora no se nota.
 */
@Injectable({ providedIn: 'root' })
export class RoutePrefetchService {
  private readonly started = new Set<string>();

  /** Dashboard completo (rutas + página). Se dispara al recibir los tokens del login. */
  warmDashboard(): Promise<unknown> {
    return this.once('dashboard', () =>
      Promise.all([
        import('@features/dashboard/dashboard.routes'),
        import('@features/dashboard/components/dashboard-page/dashboard-page.component'),
      ]),
    );
  }

  private once(key: string, load: () => Promise<unknown>): Promise<unknown> {
    if (this.started.has(key)) {
      return Promise.resolve();
    }
    this.started.add(key);
    // Un fallo de red aquí es irrelevante: el Router reintentará el import() al navegar.
    // Se libera la clave para que un reintento posterior vuelva a precargar.
    return load().catch(() => {
      this.started.delete(key);
    });
  }
}
