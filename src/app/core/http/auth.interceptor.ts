import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '@env/environment';
import { TokenService } from '@core/auth/token.service';

/** Adjunta `Authorization: Bearer <accessToken>` a las peticiones al API cuando hay token. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(TokenService).getAccessToken();
  const isApiRequest = !environment.apiUrl || req.url.startsWith(environment.apiUrl);
  if (token && isApiRequest) {
    return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
  }
  return next(req);
};
