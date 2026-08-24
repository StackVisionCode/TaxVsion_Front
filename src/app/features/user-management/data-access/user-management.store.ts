import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';
import { TeamMember } from '../ui/user-table/user-table.component';
import { UserManagementService } from './user-management.service';
import {
  CreateInvitationResponse,
  PermissionInfo,
  RoleSummary,
  TenantLimits,
  UserActorType,
  invitationToTeamMember,
  userToTeamMember,
} from './user-management.model';

/** Página de servidor: GET /auth/users y /auth/invitations paginan con `page`/`size` (1..100). */
const PAGE_SIZE = 8;

/**
 * Store del módulo User Management (Auth.Api vía `/auth/*`). A diferencia de
 * ClientsStore, acá la paginación es del servidor: cada cambio de página o de
 * búsqueda dispara un GET con `page`/`size` (y `search` en users). Mantiene dos
 * listas — miembros (users) e invitaciones Pending — más los catálogos de
 * roles/permisos y los límites del plan (asientos e invitaciones restantes).
 */
@Injectable({ providedIn: 'root' })
export class UserManagementStore {
  private readonly service = inject(UserManagementService);
  private readonly auth = inject(AuthService);

  // ---- Miembros (GET /auth/users, paginado en servidor) ----
  private readonly _members = signal<TeamMember[]>([]);
  private readonly _membersTotal = signal(0);
  private readonly _membersPage = signal(1);
  private readonly _membersLoading = signal(false);
  private readonly _membersError = signal<string | null>(null);
  private readonly _search = signal('');

  readonly members = this._members.asReadonly();
  readonly membersTotal = this._membersTotal.asReadonly();
  readonly membersPage = this._membersPage.asReadonly();
  readonly membersLoading = this._membersLoading.asReadonly();
  readonly membersError = this._membersError.asReadonly();
  readonly search = this._search.asReadonly();

  // ---- Invitaciones Pending (GET /auth/invitations?status=Pending) ----
  private readonly _invitations = signal<TeamMember[]>([]);
  private readonly _invitationsTotal = signal(0);
  private readonly _invitationsPage = signal(1);
  private readonly _invitationsLoading = signal(false);
  private readonly _invitationsError = signal<string | null>(null);

  readonly invitations = this._invitations.asReadonly();
  readonly invitationsTotal = this._invitationsTotal.asReadonly();
  readonly invitationsPage = this._invitationsPage.asReadonly();
  readonly invitationsLoading = this._invitationsLoading.asReadonly();
  readonly invitationsError = this._invitationsError.asReadonly();

  // ---- Catálogos y límites (best-effort: si fallan, la página sigue operable) ----
  private readonly _roles = signal<RoleSummary[]>([]);
  private readonly _permissions = signal<PermissionInfo[]>([]);
  private readonly _limits = signal<TenantLimits | null>(null);

  /** Roles activos del tenant, para el picker del panel de invitación/edición. */
  readonly roles = computed(() => this._roles().filter(role => role.isActive));
  readonly permissions = this._permissions.asReadonly();
  readonly limits = this._limits.asReadonly();

  readonly pageSize = PAGE_SIZE;
  /** Id del usuario logueado: su propia fila no muestra menú de acciones. */
  readonly currentUserId = computed(() => this.auth.currentUser()?.id ?? null);

  setSearch(term: string): void {
    this._search.set(term);
    this.loadMembers(1);
  }

  loadMembers(page: number = this._membersPage()): void {
    this._membersLoading.set(true);
    this._membersError.set(null);
    this._membersPage.set(page);
    this.service
      .getUsers({ page, size: PAGE_SIZE, search: this._search().trim() || undefined })
      .subscribe({
        next: result => {
          this._members.set(result.items.map(userToTeamMember));
          this._membersTotal.set(result.totalCount);
          this._membersLoading.set(false);
        },
        error: err => {
          this._membersError.set(toApiError(err).message);
          this._membersLoading.set(false);
        },
      });
  }

  loadInvitations(page: number = this._invitationsPage()): void {
    this._invitationsLoading.set(true);
    this._invitationsError.set(null);
    this._invitationsPage.set(page);
    this.service.getInvitations({ status: 'Pending', page, size: PAGE_SIZE }).subscribe({
      next: result => {
        this._invitations.set(result.items.map(invitationToTeamMember));
        this._invitationsTotal.set(result.totalCount);
        this._invitationsLoading.set(false);
      },
      error: err => {
        this._invitationsError.set(toApiError(err).message);
        this._invitationsLoading.set(false);
      },
    });
  }

  /** Roles + permisos + límites del plan. Cada uno best-effort e independiente. */
  loadCatalogs(): void {
    this.service.getRoles().subscribe({
      next: roles => this._roles.set(roles),
      error: err => console.warn('No se pudo cargar el catálogo de roles:', toApiError(err).message),
    });
    this.service.getPermissions().subscribe({
      next: permissions => this._permissions.set(permissions),
      error: err => console.warn('No se pudo cargar el catálogo de permisos:', toApiError(err).message),
    });
    this.refreshLimits();
  }

  refreshLimits(): void {
    this.service.getTenantLimits().subscribe({
      next: limits => this._limits.set(limits),
      error: err => console.warn('No se pudieron cargar los límites del tenant:', toApiError(err).message),
    });
  }

  /** POST /auth/invitations. Tras crear, recarga la lista de invitaciones y los límites. */
  invite(email: string, actorType: UserActorType, roleIds: string[]): Observable<CreateInvitationResponse> {
    const tenantId = this.auth.currentUser()?.tenant.id ?? environment.tenantId;
    return this.service
      .createInvitation({
        tenantId,
        email,
        actorType,
        customerId: null,
        roleIds: roleIds.length > 0 ? roleIds : null,
      })
      .pipe(
        tap(() => {
          this.loadInvitations(1);
          this.refreshLimits();
        }),
      );
  }

  /** PUT /auth/users/{id}/roles (204). Actualiza los chips de la fila con los nombres ya resueltos. */
  assignRoles(userId: string, roleIds: string[], roleNames: string[]): Observable<void> {
    return this.service.assignRoles(userId, roleIds).pipe(
      tap(() =>
        this._members.update(list =>
          list.map(member => (member.id === userId ? { ...member, roleNames } : member)),
        ),
      ),
    );
  }

  /** PATCH deactivate/reactivate (204). "Suspend" en la UI = deactivate en el backend. */
  setUserActive(userId: string, active: boolean): Observable<void> {
    const request$ = active ? this.service.reactivateUser(userId) : this.service.deactivateUser(userId);
    return request$.pipe(
      tap(() => {
        this._members.update(list =>
          list.map(member =>
            member.id === userId ? { ...member, status: active ? 'active' : 'suspended' } : member,
          ),
        );
        this.refreshLimits();
      }),
    );
  }

  resendInvitation(invitationId: string): Observable<void> {
    return this.service.resendInvitation(invitationId).pipe(tap(() => this.loadInvitations()));
  }

  /** POST cancel (204). Saca la fila de la lista y refresca límites (libera cupo de invitación). */
  cancelInvitation(invitationId: string): Observable<void> {
    return this.service.cancelInvitation(invitationId).pipe(
      tap(() => {
        this._invitations.update(list => list.filter(invitation => invitation.id !== invitationId));
        this._invitationsTotal.update(total => Math.max(0, total - 1));
        this.refreshLimits();
      }),
    );
  }
}
