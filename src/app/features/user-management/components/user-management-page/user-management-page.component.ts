import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take, takeWhile, timer, switchMap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { TeamMember, UserTableComponent } from '../../ui/user-table/user-table.component';
import { UserInvitePanelComponent } from '../../ui/user-invite-panel/user-invite-panel.component';
import { EditAccessDrawerComponent } from '../../ui/edit-access-drawer/edit-access-drawer.component';
import { OffboardDialogComponent } from '../../ui/offboard-dialog/offboard-dialog.component';
import {
  SEAT_CHECKOUT_INTENT_KEY,
  SeatPurchaseModalComponent,
} from '../../ui/seat-purchase-modal/seat-purchase-modal.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { UserManagementStore } from '../../data-access/user-management.store';
import { SeatPurchaseStore } from '../../../subscription/data-access/seat-purchase.store';

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
 * PATCH deactivate/reactivate; "Remove from office" es el retiro terminal
 * (POST offboard) con su diálogo de impacto + sucesor. Suspend y offboard piden
 * confirmación; cancelar una invitación también. La fila del usuario logueado no
 * muestra menú de acciones.
 */
@Component({
  selector: 'app-user-management-page',
  imports: [
    CommonModule,
    FormsModule,
    UserTableComponent,
    UserInvitePanelComponent,
    EditAccessDrawerComponent,
    OffboardDialogComponent,
    SeatPurchaseModalComponent,
    PaginationComponent,
    ConfirmDialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './user-management-page.component.html',
})
export class UserManagementPageComponent {
  private readonly store = inject(UserManagementStore);
  private readonly seatStore = inject(SeatPurchaseStore);
  private readonly toastService = inject(ToastService);

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
  readonly permissions = this.store.permissions;
  readonly currentUserId = this.store.currentUserId;
  readonly pageSize = this.store.pageSize;

  readonly tab = signal<TeamTab>('members');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingMember = signal<TeamMember | null>(null);
  readonly pendingCancel = signal<TeamMember | null>(null);
  readonly pendingSuspend = signal<TeamMember | null>(null);
  readonly pendingOffboard = signal<TeamMember | null>(null);
  readonly isSeatModalOpen = signal(false);

  /** The member whose "Edit access" drawer is open (null = closed). */
  readonly accessMember = signal<TeamMember | null>(null);

  private searchDebounce: ReturnType<typeof setTimeout> | undefined;

  readonly cancelMessage = computed(() => {
    const invitation = this.pendingCancel();
    return invitation
      ? `You're about to cancel the invitation for ${invitation.email}. They won't be able to join with the link they received.`
      : '';
  });

  readonly suspendMessage = computed(() => {
    const member = this.pendingSuspend();
    return member
      ? `${member.name} won't be able to sign in until you reactivate them. Their data and assignments stay as they are.`
      : '';
  });

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
    this.resumePendingSeatCheckout();
  }

  /** "Buy seats" (cabecera o desde el panel de invitación al tope): abre el modal de compra. */
  openSeatModal(): void {
    this.isPanelOpen.set(false);
    this.isSeatModalOpen.set(true);
  }

  closeSeatModal(): void {
    this.isSeatModalOpen.set(false);
  }

  /** Cobro off-session exitoso: refrescar el cupo y avisar. El redirect no pasa por acá (navega afuera). */
  handleSeatsPurchased(): void {
    this.store.refreshLimits();
    this.showToast('Seats added. You can invite now.');
    this.closeSeatModal();
  }

  /**
   * Al volver del hosted-checkout (redirect), si quedó un intentId en sessionStorage, poll-ea el estado hasta
   * que el webhook aprovisione (Provisioned) o falle. Éxito → refresca el cupo. Molde de espera acotada (20
   * intentos × 2.5s) para no colgar si el webhook demora.
   */
  private resumePendingSeatCheckout(): void {
    let intentId: string | null = null;
    try {
      intentId = sessionStorage.getItem(SEAT_CHECKOUT_INTENT_KEY);
      sessionStorage.removeItem(SEAT_CHECKOUT_INTENT_KEY);
    } catch {
      intentId = null;
    }
    if (!intentId) {
      return;
    }

    const id = intentId;
    this.showToast('Confirming your payment…');
    timer(0, 2500)
      .pipe(
        switchMap(() => this.seatStore.getCheckoutStatus(id)),
        takeWhile(status => status.status === 'Pending' || status.status === 'Paid', true),
        take(20),
      )
      .subscribe({
        next: status => {
          if (status.status === 'Provisioned') {
            this.store.refreshLimits();
            this.showToast(`Added ${status.quantity} seat${status.quantity === 1 ? '' : 's'}. You can invite now.`);
          } else if (status.status === 'Failed') {
            this.showToast('The seat payment did not go through.', 'error');
          }
        },
        error: () => this.showToast('Could not confirm the seat payment.', 'error'),
      });
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

  /** "Edit access" (menú de la fila) abre el drawer de permisos de ese miembro. */
  openAccessDrawer(member: TeamMember): void {
    this.accessMember.set(member);
  }

  closeAccessDrawer(): void {
    this.accessMember.set(null);
  }

  /** El drawer ya hizo el PUT de overrides y quedó limpio — acá solo toast + cierre. */
  handleAccessSaved(): void {
    this.showToast('Access updated');
    this.closeAccessDrawer();
  }

  /** "Manage roles" desde el drawer delega en el panel de edición de roles existente (asignación rápida). */
  handleManageRoles(member: TeamMember): void {
    this.closeAccessDrawer();
    this.openEditPanel(member);
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

  /**
   * Suspend/Reactivate = PATCH /auth/users/{id}/deactivate|reactivate. Reactivar no es destructivo →
   * directo; suspender corta el acceso → pide confirmación primero (FE-1b).
   */
  toggleSuspend(member: TeamMember): void {
    if (member.status === 'suspended') {
      this.performSetActive(member, true);
      return;
    }
    this.pendingSuspend.set(member);
  }

  confirmSuspend(): void {
    const member = this.pendingSuspend();
    if (member) {
      this.performSetActive(member, false);
    }
    this.pendingSuspend.set(null);
  }

  private performSetActive(member: TeamMember, active: boolean): void {
    this.store.setUserActive(member.id, active).subscribe({
      next: () => this.showToast(active ? `${member.name} reactivated` : `${member.name} suspended`),
      error: err => this.showToast(toApiError(err).message, 'error'),
    });
  }

  /** "Remove from office" (retiro terminal) — pide confirmación. */
  offboard(member: TeamMember): void {
    this.pendingOffboard.set(member);
  }

  /**
   * FE-2: el diálogo emite el sucesor elegido (o null = rutar a la oficina). El backend marca el estado
   * terminal, reasigna el trabajo activo y libera el asiento.
   */
  confirmOffboard(successorUserId: string | null): void {
    const member = this.pendingOffboard();
    if (member) {
      this.store.offboardUser(member.id, successorUserId).subscribe({
        next: () => this.showToast(`${member.name} removed from the office`),
        error: err => this.showToast(toApiError(err).message, 'error'),
      });
    }
    this.pendingOffboard.set(null);
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

  // Toast global compartido (app-toast-host, montado una vez en la raíz): flotante y visible en toda
  // la app, a diferencia del chip inline anterior que estaba pegado al título y era fácil no verlo —
  // p.ej. al remover un miembro parecía que "no avisaba nada".
  private showToast(message: string, kind: 'success' | 'error' = 'success'): void {
    if (kind === 'error') {
      this.toastService.error(message);
    } else {
      this.toastService.success(message);
    }
  }
}
