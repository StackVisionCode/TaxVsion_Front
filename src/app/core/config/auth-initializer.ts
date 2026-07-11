import { EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { catchError, of } from 'rxjs';
import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';

/**
 * Al arrancar la app: si hay una sesión guardada (y no es modo mock), hidrata el
 * usuario actual con GET /auth/me. Best-effort — un 401 lo maneja el error interceptor
 * y aquí simplemente no bloqueamos el bootstrap.
 */
export function provideAuthInitializer(): EnvironmentProviders {
  return provideAppInitializer(() => {
    if (environment.authMock) {
      return;
    }
    const tokenService = inject(TokenService);
    const auth = inject(AuthService);
    if (!tokenService.isAuthenticated()) {
      return;
    }
    return auth.me().pipe(catchError(() => of(null)));
  });
}
