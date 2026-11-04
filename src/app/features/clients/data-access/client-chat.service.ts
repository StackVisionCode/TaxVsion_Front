import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { readOnlyRequestContext } from '@core/http/read-only-request';
import { ClientChatDirectoryEntry, ClosedChatMessagesPage, ClosedClientChat } from './client-chat.model';

/**
 * Cliente HTTP fino sobre el directorio de Communication (`/communication/directory/customers`,
 * staff-only) para la tarjeta "Chat" del perfil. Es la única fuente que dice si un cliente es
 * chateable: trae `portalUserId` (o null). Requiere permiso de chat del CRM; sin él responde 403
 * y la tarjeta se oculta en vez de afirmar un estado que no puede verificar.
 */
@Injectable({ providedIn: 'root' })
export class ClientChatService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  /**
   * POST /communication/directory/customers/search — `q` obligatorio (1-100), `limit` máx 25. El
   * término (el email del cliente) va en el cuerpo para no dejarlo en los logs de la URL.
   */
  searchCustomers(term: string, limit = 10): Observable<ClientChatDirectoryEntry[]> {
    return this.http.post<ClientChatDirectoryEntry[]>(
      `${this.api.tenantUrl('/communication/directory')}/customers/search`,
      { q: term, limit },
      { context: readOnlyRequestContext() },
    );
  }

  /** Chats del cliente cerrados al retirarse su preparador (solo lectura para la oficina con acceso). */
  listClosedChats(customerId: string): Observable<{ items: ClosedClientChat[] }> {
    return this.http.get<{ items: ClosedClientChat[] }>(
      `${this.api.tenantUrl('/communication/customers')}/${customerId}/closed-chats`,
      { context: readOnlyRequestContext() },
    );
  }

  /** Historial de un chat, de lo más nuevo a lo más viejo; `before` pide la página anterior. */
  getMessages(conversationId: string, before: string | null = null): Observable<ClosedChatMessagesPage> {
    const params: Record<string, string> = { take: '50' };
    if (before) {
      params['before'] = before;
    }
    return this.http.get<ClosedChatMessagesPage>(
      `${this.api.tenantUrl('/communication/conversations')}/${conversationId}/messages`,
      { params, context: readOnlyRequestContext() },
    );
  }
}
