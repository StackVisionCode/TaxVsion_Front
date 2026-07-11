import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * Protege el shell autenticado (canActivateChild en la ruta del AppShell).
 * Sin sesión → /login con returnUrl. Con enrolamiento MFA pendiente → /login/setup-mfa.
 */
export const authGuard: CanActivateChildFn = (_route, state) => {
  const tokenService = inject(TokenService);
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!tokenService.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  if (auth.mustEnrollMfa()) {
    return router.createUrlTree(['/login/setup-mfa']);
  }
  return true;
};

/** Mantiene fuera de login/registro a quien ya tiene una sesión válida. */
export const guestGuard: CanActivateFn = () => {
  const tokenService = inject(TokenService);
  const auth = inject(AuthService);
  const router = inject(Router);

  if (tokenService.isAuthenticated() && !auth.mustEnrollMfa()) {
    return router.createUrlTree(['/dashboard']);
  }
  return true;
};

/** El paso 2 de MFA requiere un reto pendiente; si no, vuelve a /login. */
export const mfaVerifyGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.pendingMfa() !== null ? true : router.createUrlTree(['/login']);
};

/** El enrolamiento TOTP requiere sesión + flag mustEnrollMfa. */
export const mfaSetupGuard: CanActivateFn = () => {
  const tokenService = inject(TokenService);
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!tokenService.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }
  return auth.mustEnrollMfa() ? true : router.createUrlTree(['/dashboard']);
};
