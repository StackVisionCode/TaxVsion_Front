import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router, UrlTree } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { environment } from '@env/environment';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

const CLIENT_PORTAL_ACTOR = 'CustomerPortal';

/**
 * Protege el shell autenticado del CRM (canActivateChild en la ruta del AppShell).
 * Sin sesión → /login con returnUrl. Con enrolamiento MFA pendiente → /login/setup-mfa.
 *
 * SEGURIDAD: el CRM es SOLO para el staff. Un actor `CustomerPortal` que llegue aquí (por el login
 * central del staff, un link mal armado, o navegación manual) NO debe entrar — se cierra su sesión
 * y se le manda al portal. Espejo inverso del clientPortalGuard del portal del cliente.
 */
export const authGuard: CanActivateChildFn = (_route, state) => {
  const tokenService = inject(TokenService);
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!tokenService.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }

  // Con el perfil ya hidratado se decide en el acto; si no, se resuelve /me para conocer el actor
  // ANTES de dejar entrar (el actorType autoritativo viene de /auth/me, nunca del JWT decodificado).
  const current = auth.currentUser();
  if (current) {
    return current.actorType === CLIENT_PORTAL_ACTOR ? rejectClientPortal(auth) : mfaGate(auth, router);
  }
  return auth.me().pipe(
    map(user => (user.actorType === CLIENT_PORTAL_ACTOR ? rejectClientPortal(auth) : mfaGate(auth, router))),
    // Si /me falla (red), no se bloquea por esto: el backend igual rechaza cada endpoint de staff.
    catchError(() => of(mfaGate(auth, router))),
  );
};

/** Enrolamiento MFA pendiente → setup; si no, pasa. */
function mfaGate(auth: AuthService, router: Router): boolean | UrlTree {
  return auth.mustEnrollMfa() ? router.createUrlTree(['/login/setup-mfa']) : true;
}

/** Cierra la sesión del CRM y saca al cliente hacia el portal (cruza de origen en prod). */
function rejectClientPortal(auth: AuthService): boolean {
  auth.logoutLocal();
  const target = environment.production
    ? `${window.location.origin}/portal/client/auth/login`
    : (environment.portalDevUrl ?? '') + '/client/auth/login';
  window.location.assign(target || '/login');
  return false;
}

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
