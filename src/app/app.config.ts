import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';

// NOTA: ComponentCacheRouteReuseStrategy (src/app/core/route-reuse/) quedó
// desactivada temporalmente — produce un "Maximum call stack size exceeded"
// en el router de Angular tras varias navegaciones, todavía sin resolver.
// El archivo se deja intacto para retomarlo más adelante.

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
  ]
};
