import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';
import { SubscriptionStatusStore } from '@core/billing/subscription-status.store';
import { toApiError } from '@core/models/api-error.model';

/** Endpoints anónimos: un 401 aquí es un fallo legítimo, no dispara refresh. */
const ANON_AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/mfa/verify'];

/**
 * Ante un 401 en un endpoint protegido intenta UN refresh (single-flight en
 * AuthService) y reintenta la petición con el nuevo token. Si el refresh falla,
 * limpia la sesión y redirige a /login.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const tokenService = inject(TokenService);
  const router = inject(Router);
  const subscriptionStatus = inject(SubscriptionStatusStore);

  const isAnonAuthEndpoint = ANON_AUTH_ENDPOINTS.some(path => req.url.includes(path));

  return next(req).pipe(
    catchError((err: unknown) => {
      // Suscripción de la firma en lapso (Expiración/Dunning, Fase 5). A diferencia del portal, al staff
      // admin NO se le cierra la sesión (puede entrar a pagar): solo se marca el estado bloqueado para que
      // el banner global aparezca y ofrezca renovar. El backend lo devuelve como 403 con este code.
      if (err instanceof HttpErrorResponse && toApiError(err).code === 'Auth.SubscriptionInactive') {
        subscriptionStatus.markBlockedFromError();
        return throwError(() => err);
      }

      const is401 = err instanceof HttpErrorResponse && err.status === 401;
      if (!is401 || isAnonAuthEndpoint || !tokenService.getRefreshToken()) {
        return throwError(() => err);
      }
      return auth.refresh().pipe(
        switchMap(tokens =>
          next(req.clone({ setHeaders: { Authorization: `Bearer ${tokens.accessToken}` } })),
        ),
        catchError(refreshErr => {
          auth.logoutLocal();
          void router.navigateByUrl('/login');
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};
