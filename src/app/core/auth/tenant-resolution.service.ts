import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';

/**
 * "Encuentra tu oficina" (estilo Slack). Resuelve a qué tenant/subdominio pertenece un
 * usuario cuando aún no lo sabe (no tiene sesión ni el ?office= en la URL).
 *
 * Endpoint del SISTEMA (api.taxproffice.com): no resuelve tenant por Host, por eso va a
 * systemUrl y no a tenantUrl.
 */
@Injectable({ providedIn: 'root' })
export class TenantResolutionService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  /**
   * Pide al backend que envíe por correo los subdominios donde el email tiene cuenta activa.
   * Siempre 202: por diseño anti-enumeración no revela si el email existe ni cuántas oficinas
   * encontró — el resultado real llega solo por email. La UI debe mostrar el mismo mensaje
   * ("Si el correo tiene una oficina, te enviamos el link") pase lo que pase.
   */
  findOfficeByEmail(email: string): Observable<void> {
    return this.http.post<void>(this.api.systemUrl('/auth/tenant-resolution/by-email'), { email });
  }
}
