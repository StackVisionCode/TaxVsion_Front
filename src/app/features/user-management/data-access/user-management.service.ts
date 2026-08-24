import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  AssignRolesRequest,
  CreateInvitationRequest,
  CreateInvitationResponse,
  InvitationStatus,
  InvitationSummary,
  PagedResult,
  PermissionInfo,
  RoleSummary,
  TenantLimits,
  UserSummary,
} from './user-management.model';

interface GetUsersParams {
  page?: number;
  size?: number;
  search?: string;
  isActive?: boolean;
}

interface GetInvitationsParams {
  status?: InvitationStatus;
  page?: number;
  size?: number;
}

/** Cliente HTTP fino sobre Users/Invitations/Roles controllers (`/auth/*`, servicio Auth.Api vía Gateway). */
@Injectable({ providedIn: 'root' })
export class UserManagementService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/auth');
  }

  getUsers(params: GetUsersParams): Observable<PagedResult<UserSummary>> {
    let query = new HttpParams();
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.size) {
      query = query.set('size', params.size);
    }
    if (params.search) {
      query = query.set('search', params.search);
    }
    if (params.isActive !== undefined) {
      query = query.set('isActive', params.isActive);
    }
    return this.http.get<PagedResult<UserSummary>>(`${this.base}/users`, { params: query });
  }

  getUserById(id: string): Observable<UserSummary> {
    return this.http.get<UserSummary>(`${this.base}/users/${id}`);
  }

  /** PATCH /auth/users/{id}/deactivate — 204 No Content. Requiere permiso users.manage. */
  deactivateUser(id: string): Observable<void> {
    return this.http.patch<void>(`${this.base}/users/${id}/deactivate`, {});
  }

  /** PATCH /auth/users/{id}/reactivate — 204 No Content. Requiere permiso users.manage. */
  reactivateUser(id: string): Observable<void> {
    return this.http.patch<void>(`${this.base}/users/${id}/reactivate`, {});
  }

  /** PUT /auth/users/{id}/roles — reemplaza el set completo. Requiere permiso roles.manage. */
  assignRoles(id: string, roleIds: string[]): Observable<void> {
    const body: AssignRolesRequest = { roleIds };
    return this.http.put<void>(`${this.base}/users/${id}/roles`, body);
  }

  /** POST /auth/invitations — 201 Created. Requiere permiso users.invite + actor TenantAdmin. */
  createInvitation(req: CreateInvitationRequest): Observable<CreateInvitationResponse> {
    return this.http.post<CreateInvitationResponse>(`${this.base}/invitations`, req);
  }

  getInvitations(params: GetInvitationsParams): Observable<PagedResult<InvitationSummary>> {
    let query = new HttpParams();
    if (params.status) {
      query = query.set('status', params.status);
    }
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.size) {
      query = query.set('size', params.size);
    }
    return this.http.get<PagedResult<InvitationSummary>>(`${this.base}/invitations`, { params: query });
  }

  /** POST /auth/invitations/{id}/resend — 204 No Content. */
  resendInvitation(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/invitations/${id}/resend`, {});
  }

  /** POST /auth/invitations/{id}/cancel — 204 No Content. */
  cancelInvitation(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/invitations/${id}/cancel`, {});
  }

  /** GET /auth/roles — roles del tenant (RolesController exige permiso roles.manage). */
  getRoles(): Observable<RoleSummary[]> {
    return this.http.get<RoleSummary[]>(`${this.base}/roles`);
  }

  /** GET /auth/permissions — catálogo global de permisos (mismo controller de roles). */
  getPermissions(): Observable<PermissionInfo[]> {
    return this.http.get<PermissionInfo[]>(`${this.base}/permissions`);
  }

  /** GET /auth/tenants/limits — plan, asientos usados/disponibles e invitaciones restantes. */
  getTenantLimits(): Observable<TenantLimits> {
    return this.http.get<TenantLimits>(`${this.base}/tenants/limits`);
  }
}
