import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
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
   * ¿Existe una oficina viva en este slug? Sirve para no mostrar el login en subdominios que no
   * son ninguna oficina (tecleados al azar). Se llama SAME-ORIGIN (el propio host del tenant),
   * no a api.*: el CORS del backend no incluye los subdominios de tenant, y este endpoint está
   * exento de la resolución por Host, así que responde también en un subdominio inexistente.
   * Solo hay oficina viva cuando available=false + reason "TenantDomain.SlugTaken"; libre,
   * reservado a medio registro o formato inválido => no hay oficina.
   */
  officeExists(slug: string): Observable<boolean> {
    return this.http
      .get<{ available: boolean; reason: string | null }>(
        this.api.tenantUrl('/auth/subdomains/check-availability'),
        { params: { slug } },
      )
      .pipe(map(r => r.available === false && r.reason === 'TenantDomain.SlugTaken'));
  }
}
