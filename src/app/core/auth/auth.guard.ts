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
 * central, un link mal armado, o navegación manual) NO debe entrar — se cierra su sesión y se le
 * manda al portal. Espejo inverso del clientPortalGuard del portal del cliente.
 *
 * El actorType se lee del **JWT firmado** (claim de confianza), NO de /auth/me: /me puede estar
 * bloqueado por el gate de Términos (409) y no debe decidir el acceso — de lo contrario un cliente
 * cuyo /me diera 409 se colaba al CRM por el fallo del guard.
 */
export const authGuard: CanActivateChildFn = (_route, state) => {
  const tokenService = inject(TokenService);
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!tokenService.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }

  if (actorTypeFromToken(tokenService.getAccessToken()) === CLIENT_PORTAL_ACTOR) {
    return rejectClientPortal(auth);
  }

  // Staff: gate de Términos. Se publicó una versión nueva del ToS post-onboarding → hay que
  // aceptarla. Cacheado por sesión (no re-chequea en cada navegación). El endpoint terms/status
  // está exento del bloqueo del middleware.
  if (auth.termsAccepted()) {
    return mfaGate(auth, router);
  }
  return auth.termsStatus().pipe(
    map(status => {
      if (!status.accepted) {
        return router.createUrlTree(['/terms']);
      }
      auth.markTermsAccepted();
      return mfaGate(auth, router);
    }),
    // Fail-open SOLO para el gate de Términos (es UX): si el status falla (red), no se bloquea al
    // staff — el backend igual rechaza los datos con 409. El chequeo de actor (seguridad) ya pasó.
    catchError(() => of(mfaGate(auth, router))),
  );
};

/** Lee el claim `actor_type` del JWT sin verificar la firma (la valida el backend en cada request). */
function actorTypeFromToken(token: string | null): string | null {
  if (!token) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.actor_type === 'string' ? payload.actor_type : null;
  } catch {
    return null;
  }
}

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
