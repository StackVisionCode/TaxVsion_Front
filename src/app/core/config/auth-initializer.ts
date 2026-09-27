import { EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { catchError, of } from 'rxjs';
import { AccessStore } from '@core/access/access.store';
import { AuthService } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';

/**
 * Al arrancar la app: si hay una sesión guardada, hidrata el usuario actual con
 * GET /auth/me. En modo mock (`environment.authMock`) auth.me() ya resuelve local
 * sin tocar el backend — igual hay que llamarlo, porque el signal currentUser vive
 * en memoria y se pierde en cada reload aunque el token siga en storage. Best-effort:
 * un 401 lo maneja el error interceptor y aquí simplemente no bloqueamos el bootstrap.
 */
export function provideAuthInitializer(): EnvironmentProviders {
  return provideAppInitializer(() => {
    const tokenService = inject(TokenService);
    const auth = inject(AuthService);
    const access = inject(AccessStore);
    if (!tokenService.isAuthenticated()) {
      return;
    }
    // El gate de Términos lo va a pedir el authGuard inmediatamente después. Se arranca YA,
    // en paralelo con /auth/me, y el guard se engancha a la MISMA request memoizada
    // (AuthService.termsStatus) en vez de abrir una segunda en serie: eso es un round-trip
    // menos antes de pintar el shell. No se espera aquí a propósito — no debe bloquear.
    auth.termsStatus().subscribe({ error: () => {} });
    // El bootstrap de acceso (permisos efectivos + módulos del plan) va en paralelo y tampoco
    // bloquea: si el backend todavía no tiene A5, el store se queda con su respaldo y la UI se
    // comporta como hasta ahora.
    access.load();
    return auth.me().pipe(catchError(() => of(null)));
  });
}
