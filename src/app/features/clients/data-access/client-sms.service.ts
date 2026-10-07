import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { ClientSmsSendRequest, ClientSmsSendResponse } from './client-sms.model';

/**
 * Marca de origen: la MISMA del módulo SMS. El listado `GET /sms/messages` solo muestra los SMS
 * manuales del preparador (`crm-sms`); con otra marca, lo enviado desde el perfil no aparecía ni en
 * /sms ni en la pestaña SMS del cliente.
 */
const SOURCE_CONTEXT = 'crm-sms';

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
