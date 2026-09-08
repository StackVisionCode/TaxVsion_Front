import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { ClientChatDirectoryEntry } from './client-chat.model';

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

  /** GET /communication/directory/customers?q=&limit= — `q` obligatorio (min 1 char), `limit` máx 25. */
  searchCustomers(term: string, limit = 10): Observable<ClientChatDirectoryEntry[]> {
    const params = new HttpParams().set('q', term).set('limit', limit);
    return this.http.get<ClientChatDirectoryEntry[]>(
      `${this.api.tenantUrl('/communication/directory')}/customers`,
      { params },
    );
  }
}
