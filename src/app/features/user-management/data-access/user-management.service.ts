import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  AssignRolesRequest,
  CreateInvitationRequest,
  CreateInvitationResponse,
  EligibleSuccessor,
  InvitationStatus,
  InvitationSummary,
  OffboardImpactItem,
  PagedResult,
  PermissionInfo,
  RoleSummary,
  SetPermissionOverridesRequest,
  TenantLimits,
  UserEffectiveAccess,
  UserSummary,
  actorTypeLabel,
} from './user-management.model';

/** Un servicio del fan-out de impacto: su prefijo del Gateway, cómo extraer el número y cómo mostrarlo. */
interface ImpactSource {
  path: string;
  field: string;
  key: string;
  label: string;
  action: string;
  icon: string;
}

// Los 7 servicios que exponen `GET /<svc>/offboarding-impact/{userId}` (punto 3.2). El front compone la
// preview; si alguno no responde, ese renglón queda `available: false` (degradación por-servicio).
const IMPACT_SOURCES: readonly ImpactSource[] = [
  { path: '/customers', field: 'assignedClients', key: 'clients', label: 'Clients', action: 'reassigned', icon: 'people-outline' },
  { path: '/tasks', field: 'openTasks', key: 'tasks', label: 'Open tasks', action: 'reassigned', icon: 'checkbox-outline' },
  { path: '/calendar', field: 'futureAppointments', key: 'appointments', label: 'Appointments', action: 'organizer moved', icon: 'calendar-outline' },
  { path: '/correspondence', field: 'openDrafts', key: 'drafts', label: 'Email drafts', action: 'moved', icon: 'mail-outline' },
  { path: '/storage', field: 'activeShareLinks', key: 'shareLinks', label: 'Share links', action: 'revoked', icon: 'link-outline' },
  { path: '/connectors', field: 'personalMailboxes', key: 'mailboxes', label: 'Personal mailboxes', action: 'disconnected', icon: 'at-outline' },
  { path: '/communication', field: 'activeMeetings', key: 'meetings', label: 'Meetings', action: 'host moved', icon: 'videocam-outline' },
];

interface GetUsersParams {
  page?: number;
  size?: number;
  search?: string;
  isActive?: boolean;
  /** Personal o clientes de portal. Sin valor el backend devuelve los dos, que casi nunca es lo que se quiere. */
  accountKind?: 'Staff' | 'Portal';
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
    if (params.accountKind) {
      query = query.set('accountKind', params.accountKind);
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

  /**
   * POST /auth/users/{id}/offboard — 204. Retiro TERMINAL del tenant con handover: el trabajo activo del
   * empleado se reasigna a `successorUserId`, o se ruta a la oficina si es null. Requiere users.manage +
   * actor admin (TenantAdmin/PlatformAdmin).
   */
  offboardUser(id: string, successorUserId: string | null): Observable<void> {
    return this.http.post<void>(`${this.base}/users/${id}/offboard`, { successorUserId });
  }

  /**
   * Preview de impacto: fan-out a los 7 servicios `GET /<svc>/offboarding-impact/{userId}`. Cada llamada
   * degrada sola (catchError → available:false) para que un servicio caído no tumbe toda la preview.
   */
  getOffboardImpact(userId: string): Observable<OffboardImpactItem[]> {
    return forkJoin(
      IMPACT_SOURCES.map(source =>
        this.http
          .get<Record<string, number>>(`${this.api.tenantUrl(source.path)}/offboarding-impact/${userId}`)
          .pipe(
            map(response => this.toImpactItem(source, response[source.field] ?? 0, true)),
            catchError(() => of(this.toImpactItem(source, 0, false))),
          ),
      ),
    );
  }

  private toImpactItem(source: ImpactSource, count: number, available: boolean): OffboardImpactItem {
    return { key: source.key, label: source.label, action: source.action, icon: source.icon, count, available };
  }

  /** Staff activo (no portal) distinto del que se retira — candidatos a sucesor para el picker del diálogo. */
  getEligibleSuccessors(excludeUserId: string): Observable<EligibleSuccessor[]> {
    return this.getUsers({ page: 1, size: 100, isActive: true, accountKind: 'Staff' }).pipe(
      map(result =>
        result.items
          .filter(user => user.id !== excludeUserId)
          .map(user => ({
            id: user.id,
            name: `${user.name} ${user.lastName}`.trim() || user.email,
            subtitle: user.roles[0] ?? actorTypeLabel(user.actorType),
          })),
      ),
    );
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

  /**
   * GET /auth/users/{id}/effective-access — the user's role-granted permissions grouped by module,
   * each flagged if currently denied. Feeds the "Edit access" drawer. Requires permission roles.manage.
   */
  getEffectiveAccess(userId: string): Observable<UserEffectiveAccess> {
    return this.http.get<UserEffectiveAccess>(`${this.base}/users/${userId}/effective-access`);
  }

  /**
   * PUT /auth/users/{id}/permission-overrides — 204 No Content. Deny-only, replace-set: `deniedPermissionIds`
   * fully replaces the user's deny set (an empty array clears every override). Requires permission roles.manage.
   */
  setPermissionOverrides(userId: string, deniedPermissionIds: string[]): Observable<void> {
    const body: SetPermissionOverridesRequest = { deniedPermissionIds };
    return this.http.put<void>(`${this.base}/users/${userId}/permission-overrides`, body);
  }
}
