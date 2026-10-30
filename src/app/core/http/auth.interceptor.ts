import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TokenService } from '@core/auth/token.service';
import { ApiConfigService } from '@core/config/api-config.service';
import { ANONYMOUS_REQUEST } from './anonymous-request';

/** Adjunta `Authorization: Bearer <accessToken>` a las peticiones al API cuando hay token (nunca a las públicas). */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(TokenService).getAccessToken();
  const isApiRequest = inject(ApiConfigService).isApiUrl(req.url);
  if (token && isApiRequest && !req.context.get(ANONYMOUS_REQUEST)) {
    return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
  }
  return next(req);
};
