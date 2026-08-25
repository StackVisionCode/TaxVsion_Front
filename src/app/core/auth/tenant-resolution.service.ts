import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, throwError } from 'rxjs';
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

  /**
   * ¿El subdominio actual resuelve a una oficina viva? Se llama SAME-ORIGIN (el propio host del
   * tenant) a by-host, que usa el MISMO resolver por Host que el login: 200 si el subdominio es
   * una oficina real y activa, 404 si no (host desconocido/apex). Same-origin a propósito: el CORS
   * de prod no incluye los subdominios de tenant, así que un GET a api.* se bloquearía. Un error
   * distinto de 404 se propaga: el guard lo trata como fail-open (mejor mostrar el login que
   * bloquear a un usuario legítimo por un fallo transitorio).
   */
  officeExists(): Observable<boolean> {
    return this.http.get(this.api.tenantUrl('/auth/tenant-resolution/by-host')).pipe(
      map(() => true),
      catchError((err: HttpErrorResponse) => (err.status === 404 ? of(false) : throwError(() => err))),
    );
  }
}
