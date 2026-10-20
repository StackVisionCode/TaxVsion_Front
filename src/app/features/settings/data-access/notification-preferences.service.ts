import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  NotificationPreference,
  SetNotificationPreferenceRequest,
} from './notification-preferences.model';

/**
 * Cliente HTTP de las preferencias de notificación del staff — endpoints:
 *   - GET /notifications/preferences → matriz completa Category × Channel con
 *     el estado efectivo (default Enabled=true si no hay fila, Locked=true para
 *     Security).
 *   - PUT /notifications/preferences con `{ category, channel, enabled }` →
 *     upsert de una sola celda.
 *
 * Autoservicio: no requiere permiso especial (el UserId sale del JWT del request,
 * nunca del body — mismo patrón que push-devices).
 */
@Injectable({ providedIn: 'root' })
export class NotificationPreferencesService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/notifications/preferences');
  }

  list(): Observable<NotificationPreference[]> {
    return this.http.get<NotificationPreference[]>(this.base);
  }

  set(request: SetNotificationPreferenceRequest): Observable<void> {
    return this.http.put<void>(this.base, request);
  }
}
