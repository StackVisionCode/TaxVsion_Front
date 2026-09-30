import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { ClientSmsSendRequest, ClientSmsSendResponse } from './client-sms.model';

/**
 * Envío directo de SMS desde el perfil: `POST /sms/messages` (Sms.Api, permiso `sms.send`).
 * Réplica mínima de lo que usa `features/sms` — sin importarla. Responde 200 con un resultado
 * POR ITEM (un destino inválido no es un 4xx: vuelve como `Failed` + `errorCode`).
 */
@Injectable({ providedIn: 'root' })
export class ClientSmsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  send(req: ClientSmsSendRequest): Observable<ClientSmsSendResponse> {
    return this.http.post<ClientSmsSendResponse>(this.api.tenantUrl('/sms/messages'), req);
  }
}
