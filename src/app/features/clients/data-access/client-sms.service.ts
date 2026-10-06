import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { ClientSmsSendRequest, ClientSmsSendResponse } from './client-sms.model';

/** Marca de origen para la auditoría del backend (distinta de la del módulo SMS). */
const SOURCE_CONTEXT = 'crm-client-profile';

/**
 * Envío directo de UN SMS a un cliente desde su perfil: `POST /sms/messages` (permiso `sms.send`,
 * rate-limit por tenant/usuario). Réplica mínima del cliente de `features/sms` — sin importarlo.
 * El backend responde 200 con un resultado por item (ver `clientSmsOutcome`).
 */
@Injectable({ providedIn: 'root' })
export class ClientSmsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  send(customerId: string, to: string, message: string, recipientName: string | null): Observable<ClientSmsSendResponse> {
    const body: ClientSmsSendRequest = {
      messages: [
        {
          customerId,
          to,
          message,
          recipientName,
          media: null,
          idempotencyKey: crypto.randomUUID(),
          sourceContext: SOURCE_CONTEXT,
        },
      ],
    };
    return this.http.post<ClientSmsSendResponse>(this.api.tenantUrl('/sms/messages'), body);
  }
}
