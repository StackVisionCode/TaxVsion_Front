import { EnvironmentProviders, Provider } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './auth.interceptor';
import { errorInterceptor } from './error.interceptor';

/** HttpClient con los interceptores funcionales de auth (Bearer) y error (refresh/401). */
export const httpProviders: Array<Provider | EnvironmentProviders> = [
  provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
];
