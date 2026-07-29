import { EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { ThemeService } from './theme.service';

/**
 * Fuerza la instanciación de ThemeService al arrancar la app (providedIn: 'root'
 * es lazy — sin esto, el color guardado no se aplicaría hasta que algo lo
 * inyectara por primera vez, ej. al abrir Settings), así el color elegido ya
 * está aplicado en :root antes del primer render.
 */
export function provideThemeInitializer(): EnvironmentProviders {
  return provideAppInitializer(() => {
    inject(ThemeService);
  });
}
