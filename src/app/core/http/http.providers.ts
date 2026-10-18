import { EnvironmentProviders, Provider } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './auth.interceptor';
import { seatSlotGatedInterceptor } from './seat-slot-gated.interceptor';
import { errorInterceptor } from './error.interceptor';

/**
 * HttpClient con los interceptores funcionales en orden:
 * 1. `auth` adjunta el Bearer (todas las requests autenticadas lo necesitan antes del fetch).
 * 2. `seatSlotGated` (SG-8) atrapa el 403 `seats.user_slot_gated` y lleva a `/blocked/seat-suspended`.
 * 3. `error` resuelve throttle, módulo-no-contratado, refresh/401 y rutas de token por correo.
 */
export const httpProviders: Array<Provider | EnvironmentProviders> = [
  provideHttpClient(withInterceptors([authInterceptor, seatSlotGatedInterceptor, errorInterceptor])),
];
