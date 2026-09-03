import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  InvitationResponse,
  PagedResult,
  PortalUserResponse,
  RequestPortalInvitationResponse,
} from './client-portal.model';

/**
 * Cliente HTTP de "Portal access": invitar vive en Customer.Api; el estado y la gestión
 * (invitaciones/usuarios de portal) en Auth.Api, ahora filtrables por `?customerId=`.
 */
@Injectable({ providedIn: 'root' })
export class ClientPortalService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  /** POST /customers/{id}/portal-invitations — sin body; 202. Perm `customers.manage` + admin. */
  invite(customerId: string): Observable<RequestPortalInvitationResponse> {
    return this.http.post<RequestPortalInvitationResponse>(
      this.api.tenantUrl(`/customers/${customerId}/portal-invitations`),
      {},
    );
  }

  /** GET /auth/invitations?customerId=&size= — invitaciones de este cliente (perm `users.invite`). */
  listInvitations(customerId: string, size = 50): Observable<PagedResult<InvitationResponse>> {
    const params = new HttpParams().set('customerId', customerId).set('page', 1).set('size', size);
    return this.http.get<PagedResult<InvitationResponse>>(this.api.tenantUrl('/auth/invitations'), { params });
  }

  /** GET /auth/users?customerId=&size= — usuario(s) de portal de este cliente (perm `users.view`). */
  listUsers(customerId: string, size = 10): Observable<PagedResult<PortalUserResponse>> {
    const params = new HttpParams().set('customerId', customerId).set('page', 1).set('size', size);
    return this.http.get<PagedResult<PortalUserResponse>>(this.api.tenantUrl('/auth/users'), { params });
  }

  /** POST /auth/invitations/{id}/resend — reenvía una invitación pendiente (perm `users.invite` + admin). */
  resendInvitation(invitationId: string): Observable<void> {
    return this.http.post<void>(this.api.tenantUrl(`/auth/invitations/${invitationId}/resend`), {});
  }

  /** POST /auth/invitations/{id}/cancel — cancela una invitación pendiente. */
  cancelInvitation(invitationId: string): Observable<void> {
    return this.http.post<void>(this.api.tenantUrl(`/auth/invitations/${invitationId}/cancel`), {});
  }

  /** PATCH /auth/users/{id}/deactivate — desactiva el usuario de portal (perm `users.manage`). */
  deactivateUser(userId: string): Observable<void> {
    return this.http.patch<void>(this.api.tenantUrl(`/auth/users/${userId}/deactivate`), {});
  }

  /** PATCH /auth/users/{id}/reactivate — reactiva el usuario de portal. */
  reactivateUser(userId: string): Observable<void> {
    return this.http.patch<void>(this.api.tenantUrl(`/auth/users/${userId}/reactivate`), {});
  }
}
