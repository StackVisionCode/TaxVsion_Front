import { HttpContextToken, HttpErrorResponse, HttpEvent, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, switchMap, throwError, timer } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { isRefreshRejected } from '@core/auth/refresh-failure';
import { TokenService } from '@core/auth/token.service';
import { SubscriptionStatusStore } from '@core/billing/subscription-status.store';
import { ThrottleNoticeService } from '@core/errors/throttle-notice.service';
import { readThrottle } from '@core/errors/throttling';
import { toApiError } from '@core/models/api-error.model';

/** Endpoints anónimos: un 401 aquí es un fallo legítimo, no dispara refresh. */
const ANON_AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/mfa/verify'];

/** Un GET rechazado por rate limit/load shedding con una espera corta se reintenta una vez, sin avisar. */
const MAX_AUTO_RETRY_SECONDS = 5;
const THROTTLE_RETRIED = new HttpContextToken<boolean>(() => false);

/**
 * - 429/503 de rate limit o load shedding: un aviso global único con cuenta regresiva (ver
 *   ThrottleNoticeService). Si es un GET y la espera es corta, antes se reintenta una vez en silencio.
 * - 401 en un endpoint protegido: intenta UN refresh (single-flight en AuthService) y reintenta con el
 *   token nuevo. Solo si el refresh token es rechazado se limpia la sesión y se va a /login; un 429,
 *   503 o corte de red al renovar deja la sesión intacta.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const tokenService = inject(TokenService);
  const subscriptionStatus = inject(SubscriptionStatusStore);
  const throttleNotice = inject(ThrottleNoticeService);

  const handleError = (err: unknown, request: HttpRequest<unknown>): Observable<HttpEvent<unknown>> => {
    // Suscripción de la firma en lapso (Expiración/Dunning, Fase 5). A diferencia del portal, al staff
    // admin NO se le cierra la sesión (puede entrar a pagar): solo se marca el estado bloqueado para que
    // el banner global aparezca y ofrezca renovar. El backend lo devuelve como 403 con este code.
    if (err instanceof HttpErrorResponse && toApiError(err).code === 'Auth.SubscriptionInactive') {
      subscriptionStatus.markBlockedFromError();
      return throwError(() => err);
    }

    const throttle = readThrottle(err);
    if (throttle) {
      const canRetry =
        request.method === 'GET' &&
        !request.context.get(THROTTLE_RETRIED) &&
        throttle.retryAfterSeconds !== null &&
        throttle.retryAfterSeconds <= MAX_AUTO_RETRY_SECONDS;
      if (!canRetry) {
        throttleNotice.notify(throttle);
        return throwError(() => err);
      }
      const retry = request.clone({ context: request.context.set(THROTTLE_RETRIED, true) });
      return timer(throttle.retryAfterSeconds! * 1000).pipe(
        switchMap(() => next(retry)),
        catchError(retryErr => handleError(retryErr, retry)),
      );
    }

    const isAnonAuthEndpoint = ANON_AUTH_ENDPOINTS.some(path => request.url.includes(path));
    const is401 = err instanceof HttpErrorResponse && err.status === 401;
    if (!is401 || isAnonAuthEndpoint || !tokenService.getRefreshToken()) {
      return throwError(() => err);
    }
    return auth.refresh().pipe(
      switchMap(tokens => next(request.clone({ setHeaders: { Authorization: `Bearer ${tokens.accessToken}` } }))),
      catchError(refreshErr => {
        if (!isRefreshRejected(refreshErr)) {
          const refreshThrottle = readThrottle(refreshErr);
          if (refreshThrottle) {
            throttleNotice.notify(refreshThrottle);
          }
          return throwError(() => refreshErr);
        }
        auth.logoutLocal();
        // Recarga dura: la sesión murió (el refresh token fue rechazado). Un reload completo, además de
        // llevar a /login, destruye los stores providedIn:'root' para que el próximo usuario de esta
        // pestaña no herede datos del saliente (ver navbar.logout).
        window.location.assign('/login');
        return throwError(() => refreshErr);
      }),
    );
  };

  return next(req).pipe(catchError((err: unknown) => handleError(err, req)));
};
