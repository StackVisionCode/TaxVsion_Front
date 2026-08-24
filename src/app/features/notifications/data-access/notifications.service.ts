import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  MarkNotificationReadResult,
  NotificationListResult,
  UnreadCountResult,
} from './notifications.model';

/**
 * Cliente HTTP del centro de notificaciones (Communication vía Gateway,
 * `/communication` — mismo patrón que ChatService). La superficie HTTP real
 * del backend es exactamente esta (ver notifications.route.ts):
 *
 * - GET  /notifications?page&size[&unreadOnly]
 * - GET  /notifications/unread-count
 * - POST /notifications/{id}/read
 *
 * No hay delete (dismiss es Socket.IO-only), ni mark-as-unread, ni bulk
 * mark-all-read. El interceptor de auth agrega el Bearer token.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/communication');
  }

  list(
    params: { page?: number; size?: number; unreadOnly?: boolean } = {},
  ): Observable<NotificationListResult> {
    let query = new HttpParams();
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.size) {
      query = query.set('size', params.size);
    }
    // Solo se envía cuando es true: el backend usa z.coerce.boolean(), que
    // trataría el string "false" como verdadero.
    if (params.unreadOnly) {
      query = query.set('unreadOnly', params.unreadOnly);
    }
    return this.http.get<NotificationListResult>(`${this.base}/notifications`, { params: query });
  }

  unreadCount(): Observable<UnreadCountResult> {
    return this.http.get<UnreadCountResult>(`${this.base}/notifications/unread-count`);
  }

  markRead(id: string): Observable<MarkNotificationReadResult> {
    return this.http.post<MarkNotificationReadResult>(`${this.base}/notifications/${id}/read`, {});
  }
}
