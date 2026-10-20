import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  BulkNotificationResult,
  MarkNotificationReadResult,
  MarkAllNotificationsReadResult,
  NotificationListResult,
  NotificationsSinceResult,
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
 * - POST /notifications/read-all
 * - POST /notifications/mark-many-read     body { ids }
 * - POST /notifications/mark-many-unread   body { ids }
 * - POST /notifications/delete-many        body { ids }
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

  /**
   * Resync tras un corte de socket: pide notificaciones con `createdAtUtc > sinceUtc`
   * en orden ascendente. El store guarda el último `createdAtUtc` que vio y lo manda
   * acá para rellenar lo que llegó durante el corte sin tener que recargar la primera
   * página entera. Suple el `restoreSession` vacío del Redis adapter de Socket.IO
   * (§8 del MD de notificaciones).
   */
  since(params: { sinceUtc: string; limit?: number }): Observable<NotificationsSinceResult> {
    let query = new HttpParams().set('sinceUtc', params.sinceUtc);
    if (params.limit) {
      query = query.set('limit', params.limit);
    }
    return this.http.get<NotificationsSinceResult>(`${this.base}/notifications/since`, { params: query });
  }

  markRead(id: string): Observable<MarkNotificationReadResult> {
    return this.http.post<MarkNotificationReadResult>(`${this.base}/notifications/${id}/read`, {});
  }

  markAllRead(upToCreatedAtUtc: string | null): Observable<MarkAllNotificationsReadResult> {
    // Omitimos el campo cuando viene null para que el servidor decida el corte con su propio reloj;
    // así una laptop desincronizada no deja mensajes recientes sin marcar.
    const body = upToCreatedAtUtc ? { upToCreatedAtUtc } : {};
    return this.http.post<MarkAllNotificationsReadResult>(
      `${this.base}/notifications/read-all`,
      body,
    );
  }

  markManyRead(ids: readonly string[]): Observable<BulkNotificationResult> {
    return this.http.post<BulkNotificationResult>(`${this.base}/notifications/mark-many-read`, { ids });
  }

  markManyUnread(ids: readonly string[]): Observable<BulkNotificationResult> {
    return this.http.post<BulkNotificationResult>(`${this.base}/notifications/mark-many-unread`, { ids });
  }

  deleteMany(ids: readonly string[]): Observable<BulkNotificationResult> {
    return this.http.post<BulkNotificationResult>(`${this.base}/notifications/delete-many`, { ids });
  }
}
