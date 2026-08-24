import { Injectable, inject } from '@angular/core';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { Observable, defer } from 'rxjs';
import { ApiConfigService, tenantSlugFromHost } from '@core/config/api-config.service';
import { environment } from '@env/environment';

/** Body de POST /auth/invitations/accept (espejo de AcceptInvitationCommand). */
export interface AcceptInvitationRequest {
  invitationToken: string;
  name: string;
  lastName: string;
  password: string;
}

/** Subset de UserResponse que necesita la pantalla de confirmación. */
export interface AcceptedInvitationUser {
  id: string;
  email: string;
  name: string;
  lastName: string;
}

/**
 * Canje de una invitación de equipo (`POST /auth/invitations/accept`, `[AllowAnonymous]`).
 *
 * El invitado llega desde el correo a `<slug>.taxproffice.com/accept-invitation?token=…`
 * (lo compone Notification en AuthEventConsumers) y **no tiene sesión**, así que aquí
 * aplican las mismas dos decisiones que en el resto de recorridos públicos:
 *
 * 1. **Sin interceptores** (`HttpBackend`): nada de heredar el `Authorization` de otra
 *    sesión abierta en el mismo navegador, y un 401 no debe disparar el refresh ni el
 *    redirect a /login del `errorInterceptor`.
 * 2. **Base derivada del HOST**, porque `tenantBase()` lanza sin oficina resuelta y el
 *    invitado nunca inició sesión. Todo va dentro de `defer` para que ese fallo viaje
 *    por el canal de error del Observable en vez de romper de forma síncrona.
 */
@Injectable({ providedIn: 'root' })
export class InvitationService {
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    if (!environment.production) {
      return this.api.tenantUrl('/auth/invitations');
    }
    const slug = tenantSlugFromHost();
    if (slug) {
      return `https://${slug}.${environment.baseDomain}/auth/invitations`;
    }
    try {
      return this.api.tenantUrl('/auth/invitations');
    } catch {
      return this.api.systemUrl('/auth/invitations');
    }
  }

  /** 200 con el usuario creado, o 400 `Auth.InvalidInvitation` si el token no sirve. */
  accept(body: AcceptInvitationRequest): Observable<AcceptedInvitationUser> {
    return defer(() => this.http.post<AcceptedInvitationUser>(`${this.base}/accept`, body));
  }
}
