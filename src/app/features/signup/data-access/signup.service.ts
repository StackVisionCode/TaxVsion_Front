import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import {
  CreatedTenant,
  SignupPlan,
  SubdomainAvailability,
  SubdomainReservation,
} from './signup.model';

/**
 * Llamadas HTTP del alta self-service. Route-scoped (@Injectable sin providedIn): vive solo
 * mientras la rama /signup está activa. Base = gateway YARP (environment.apiUrl).
 */
@Injectable()
export class SignupService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Catálogo público de planes. */
  list(): Observable<SignupPlan[]> {
    return this.http.get<SignupPlan[]>(`${this.base}/plans`);
  }

  /** Disponibilidad del subdominio (anónimo). */
  checkSubdomain(slug: string): Observable<SubdomainAvailability> {
    return this.http.get<SubdomainAvailability>(`${this.base}/auth/subdomains/check-availability`, {
      params: { slug },
    });
  }

  /** Reserva el subdominio y devuelve el ticket de registro firmado (anónimo). */
  reserveSubdomain(slug: string, email: string): Observable<SubdomainReservation> {
    return this.http.post<SubdomainReservation>(`${this.base}/auth/subdomains/reserve`, {
      slug,
      email,
    });
  }

  /**
   * Crea el tenant. Requiere el ticket como Bearer — se pasa explícito porque en el alta no hay
   * sesión todavía (el authInterceptor no adjunta nada cuando no hay token, así que no lo pisa).
   * El body incluye subdomain/adminEmail aunque el ticket ya los lleva: el backend valida el modelo.
   */
  createTenant(
    registrationTicket: string,
    body: { name: string; subdomain: string; adminEmail: string; defaultTimeZoneId: string }
  ): Observable<CreatedTenant> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${registrationTicket}` });
    return this.http.post<CreatedTenant>(`${this.base}/tenants`, body, { headers });
  }

  /** Acepta la invitación del admin y fija su contraseña (anónimo). */
  acceptInvitation(body: {
    invitationToken: string;
    name: string;
    lastName: string;
    password: string;
  }): Observable<unknown> {
    return this.http.post(`${this.base}/auth/invitations/accept`, body);
  }

  /** Versión vigente de los términos (autenticado). */
  termsVersion(): Observable<{ currentVersion: string }> {
    return this.http.get<{ currentVersion: string }>(`${this.base}/auth/tenant/terms/status`);
  }

  /** Acepta los términos del tenant (autenticado). */
  acceptTerms(version: string): Observable<unknown> {
    return this.http.post(`${this.base}/auth/tenant/terms/accept`, { version });
  }
}
