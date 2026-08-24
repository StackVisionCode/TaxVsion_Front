import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { TeamMember, UserTableComponent } from '../../ui/user-table/user-table.component';
import { UserInvitePanelComponent } from '../../ui/user-invite-panel/user-invite-panel.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { UserManagementStore } from '../../data-access/user-management.store';

type TeamTab = 'members' | 'invitations';
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Página del módulo User Management (estilo "Aether"): directorio del
 * equipo/staff de la firma con roles e invitaciones, distinto de Profile
 * (que es la página del usuario logueado). Stats pastel arriba + barra de
 * búsqueda/"Invite member" + tabla con dos pestañas + panel de invitación/
 * edición. Los datos vienen de UserManagementStore (Auth.Api vía `/auth/*`):
 * Members = GET /auth/users con paginación y búsqueda del servidor;
 * Invitations = GET /auth/invitations?status=Pending. Suspend/Reactivate son
 * PATCH deactivate/reactivate (no hay delete de usuarios en el backend, así
 * que no existe "Remove member"); cancelar una invitación sí pide confirmación.
 * La fila del usuario logueado no muestra menú de acciones.
 */
@Component({
  selector: 'app-user-management-page',
  imports: [
    CommonModule,
    FormsModule,
    UserTableComponent,
    UserInvitePanelComponent,
    PaginationComponent,
    ConfirmDialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './user-management-page.component.html',
})
export class UserManagementPageComponent {
  private readonly store = inject(UserManagementStore);

  readonly members = this.store.members;
  readonly membersTotal = this.store.membersTotal;
  readonly membersPage = this.store.membersPage;
  readonly membersLoading = this.store.membersLoading;
  readonly membersError = this.store.membersError;

  readonly invitationsTotal = this.store.invitationsTotal;
  readonly invitationsPage = this.store.invitationsPage;
  readonly invitationsLoading = this.store.invitationsLoading;
  readonly invitationsError = this.store.invitationsError;

  readonly limits = this.store.limits;
  readonly currentUserId = this.store.currentUserId;
  readonly pageSize = this.store.pageSize;

  readonly tab = signal<TeamTab>('members');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingMember = signal<TeamMember | null>(null);
  readonly pendingCancel = signal<TeamMember | null>(null);

  private searchDebounce: ReturnType<typeof setTimeout> | undefined;

  readonly cancelMessage = computed(() => {
    const invitation = this.pendingCancel();
    return invitation
      ? `You're about to cancel the invitation for ${invitation.email}. They won't be able to join with the link they received.`
      : '';
  });

  readonly toast = signal<string | null>(null);
  readonly toastKind = signal<'success' | 'error'>('success');
  private toastTimer?: ReturnType<typeof setTimeout>;

  // Stats: total desde el listado paginado; activos/pendientes/asientos desde GET /auth/tenants/limits.
  readonly totalCount = this.store.membersTotal;
  readonly activeCount = computed(() => this.limits()?.activeUsers ?? '—');
  readonly pendingInvitesCount = computed(() => this.limits()?.pendingInvitations ?? this.invitationsTotal());
  readonly seatsLeft = computed(() => {
    const limits = this.limits();
    if (!limits) {
      return '—';
    }
    // maxUsers null = plan sin tope de asientos.
    return limits.maxUsers === null ? '∞' : (limits.availableSeats ?? '—');
  });

  /** El search de invitaciones filtra en cliente sobre la página cargada (el endpoint no busca por texto). */
  readonly visibleInvitations = computed<TeamMember[]>(() => {
    const query = this.search().trim().toLowerCase();
    const invitations = this.store.invitations();
    if (!query) {
      return invitations;
    }
    return invitations.filter(
      invitation => invitation.name.toLowerCase().includes(query) || invitation.email.toLowerCase().includes(query),
    );
  });

  constructor() {
    this.store.loadMembers(1);
    this.store.loadInvitations(1);
    this.store.loadCatalogs();
  }

  setTab(tab: TeamTab): void {
    this.tab.set(tab);
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    // Members se buscan en el servidor (query `search` de GET /auth/users), con debounce.
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.store.setSearch(value), SEARCH_DEBOUNCE_MS);
  }

  onMembersPageChange(page: number): void {
    this.store.loadMembers(page);
  }

  onInvitationsPageChange(page: number): void {
    this.store.loadInvitations(page);
  }

  openInvitePanel(): void {
    this.editingMember.set(null);
    this.isPanelOpen.set(true);
  }

  openEditPanel(member: TeamMember): void {
    this.editingMember.set(member);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
    this.editingMember.set(null);
  }

  /** El panel ya hizo el POST/PUT real y actualizó el store — acá solo toast + cierre. */
  handleSaved(email: string): void {
    this.showToast(this.editingMember() ? 'Member roles updated' : `Invite sent to ${email}`);
    if (!this.editingMember()) {
      this.tab.set('invitations');
    }
    this.closePanel();
  }

  resendInvite(member: TeamMember): void {
    this.store.resendInvitation(member.id).subscribe({
      next: () => this.showToast(`Invite resent to ${member.email}`),
      error: err => this.showToast(toApiError(err).message, 'error'),
    });
  }

  /** Suspend/Reactivate = PATCH /auth/users/{id}/deactivate|reactivate. */
  toggleSuspend(member: TeamMember): void {
    const reactivating = member.status === 'suspended';
    this.store.setUserActive(member.id, reactivating).subscribe({
      next: () => this.showToast(reactivating ? `${member.name} reactivated` : `${member.name} suspended`),
      error: err => this.showToast(toApiError(err).message, 'error'),
    });
  }

  cancelInvite(member: TeamMember): void {
    this.pendingCancel.set(member);
  }

  confirmCancelInvite(): void {
    const invitation = this.pendingCancel();
    if (!invitation) {
      return;
    }
    this.store.cancelInvitation(invitation.id).subscribe({
      next: () => this.showToast(`Invitation for ${invitation.email} cancelled`),
      error: err => this.showToast(toApiError(err).message, 'error'),
    });
    this.pendingCancel.set(null);
  }

  private showToast(message: string, kind: 'success' | 'error' = 'success'): void {
    this.toast.set(message);
    this.toastKind.set(kind);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 2500);
  }
}
