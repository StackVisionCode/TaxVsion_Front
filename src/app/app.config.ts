import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withPreloading } from '@angular/router';

import { routes } from './app.routes';
import { httpProviders } from '@core/http/http.providers';
import { provideAuthInitializer } from '@core/config/auth-initializer';
import { provideThemeInitializer } from '@core/theme/theme-initializer';
import { PacedPreloadStrategy } from '@core/performance/paced-preload.strategy';

// NOTA: no hay RouteReuseStrategy. Se evaluó cachear las instancias de página para que
// volver a una sección no repitiera sus fetches, pero eso implica que su ngOnDestroy no
// corra — y aquí hay polling, sockets y listeners de llamada atados a ese ciclo de vida —
// y además desestabiliza los IntersectionObserver de los bloques @defer. El re-fetch al
// volver se resuelve con `FetchGate` (core/data/fetch-gate.ts) en los stores, que es donde
// está el estado y donde el coste real se puede evitar sin efectos colaterales.

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // El preloading pausado es lo que hace que la PRIMERA visita a una sección se sienta
    // como la segunda: sin él, el chunk de cada pantalla se descargaba recién al hacer clic.
    provideRouter(routes, withPreloading(PacedPreloadStrategy)),
    ...httpProviders,
    provideAuthInitializer(),
    provideThemeInitializer(),
  ]
};
