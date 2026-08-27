import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { environment } from '@env/environment';
import { ApiConfigService } from '../config/api-config.service';
import { TokenService } from './token.service';
import { AuthTokens } from './auth.model';
import {
  DiscoverLoginResponse,
  DiscoverOutcome,
  HandoffSession,
  HandoffTicketView,
} from './central-login.model';

/**
 * Orquesta el login central multi-tenant. discover/handoff son cross-tenant y anónimos, así que
 * van al HOST DE SISTEMA (api.taxproffice.com): en app.taxproffice.com no hay slug y tenantBase()
 * lanzaría. El canje (from-ticket) sí va al host del subdominio destino, porque corre YA en esa
 * oficina, tras el redirect — es lo que hace que la sesión viva en ese origen.
 */
@Injectable({ providedIn: 'root' })
export class CentralLoginService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly tokenService = inject(TokenService);

  /** Paso 1: password contra cada oficina. */
  discover(email: string, password: string): Observable<DiscoverOutcome> {
    return this.http
      .post<DiscoverLoginResponse>(`${this.api.systemBase()}/auth/discover-login`, { email, password })
      .pipe(map(res => interpret(res)));
  }

  /** Paso 2 (selector/MFA): elige oficina y resuelve el segundo factor; devuelve el vale. */
  handoff(sessionRef: string, chosenTenantId: string, mfaCode: string | null): Observable<HandoffTicketView> {
    return this.http.post<HandoffTicketView>(`${this.api.systemBase()}/auth/session/handoff`, {
      discoverySessionRef: sessionRef,
      chosenTenantId,
      mfaCode: mfaCode || null,
    });
  }

  /** Paso 3 (ya en el subdominio): canjea el vale por tokens de sesión y los persiste. */
  exchangeTicket(ticket: string): Observable<HandoffSession> {
    return this.http
      .post<HandoffSession>(`${this.api.tenantBase()}/auth/session/from-ticket`, { ticket })
      .pipe(tap(session => this.tokenService.setSession(toTokens(session))));
  }

  /**
   * URL de aterrizaje en la oficina destino. En prod cruza de app.* al subdominio real (otro
   * origen), por eso es absoluta y se navega con window.location. En dev un solo host atiende todo.
   *
   * <paramref name="portal"/>: el destino es el portal del cliente (`/portal/client/auth/continue`)
   * en vez del CRM del staff (`/auth/continue`). En dev el portal es OTRA SPA (otro puerto), así que
   * se usa `portalDevUrl` si está configurado.
   */
  continueUrl(subdomain: string, ticket: string, returnUrl?: string | null, portal = false): string {
    const params = new URLSearchParams({ ticket });
    if (returnUrl) {
      params.set('returnUrl', returnUrl);
    }

    if (!environment.production) {
      // El portal en dev corre en otro origen; sin base-href sus rutas cuelgan de /client.
      if (portal && environment.portalDevUrl) {
        return `${environment.portalDevUrl}/client/auth/continue?${params.toString()}`;
      }
      return `/auth/continue?${params.toString()}`;
    }

    const path = portal ? '/portal/client/auth/continue' : '/auth/continue';
    return `https://${subdomain}.${environment.baseDomain}${path}?${params.toString()}`;
  }
}

/** El canje trae el flag de setup además de los tokens; TokenService solo necesita los tokens. */
function toTokens(session: HandoffSession): AuthTokens {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresInSeconds: session.expiresInSeconds,
  };
}

function interpret(res: DiscoverLoginResponse): DiscoverOutcome {
  if (res.subdomain && res.ticket) {
    return { kind: 'direct', subdomain: res.subdomain, ticket: res.ticket, isClientPortal: res.isClientPortal === true };
  }
  if (res.discoverySessionRef && res.offices) {
    return { kind: 'select', sessionRef: res.discoverySessionRef, offices: res.offices };
  }
  throw new Error('Unexpected discover-login response from the server.');
}
