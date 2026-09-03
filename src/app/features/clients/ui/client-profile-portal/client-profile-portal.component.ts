import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toApiError } from '@core/models/api-error.model';
import { PermissionService } from '@core/auth/permission.service';
import { ToastService } from '../../../../shared/ui/toast/toast.service';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { ClientPermissions } from '../../data-access/client-permissions';
import { ClientPortalStore } from '../../data-access/client-portal.store';
import { portalStatusChipClass, portalStatusLabel } from '../../data-access/client-portal.model';

/** Permisos de Auth para gestionar el acceso de portal (BuildingBlocks.Authorization). */
const USERS_INVITE = 'users.invite';
const USERS_VIEW = 'users.view';
const USERS_MANAGE = 'users.manage';

/**
 * Pestaña "Portal access" del perfil de cliente. Reemplaza la vieja "Permissions" (que era un ACL
 * de archivos falso). Muestra el estado real del acceso al portal del cliente e invita/gestiona:
 *  - Estado derivado de Auth (invitaciones + usuario de portal, filtrados por `customerId` — campo
 *    agregado al backend en esta fase).
 *  - Invitar: Customer.Api `POST /customers/{id}/portal-invitations` (perm `customers.manage`+admin).
 *  - Reenviar/cancelar invitación: Auth (perm `users.invite`+admin). Activar/desactivar usuario:
 *    Auth (perm `users.manage`).
 */
@Component({
  selector: 'app-client-profile-portal',
  imports: [CommonModule, ConfirmDialogComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-portal.component.html',
  styleUrl: './client-profile-portal.component.css',
})
export class ClientProfilePortalComponent implements OnChanges {
  @Input() clientId = '';
  @Input() clientEmail = '';
  @Input() clientName = '';

  readonly store = inject(ClientPortalStore);
  private readonly perms = inject(PermissionService);
  private readonly clientPerms = inject(ClientPermissions);
  private readonly toast = inject(ToastService);

  readonly canInvite = this.clientPerms.canInvitePortal;
  readonly canManageInvites = computed(() => this.perms.has(USERS_INVITE) && this.perms.isAdmin());
  readonly canManageUsers = computed(() => this.perms.has(USERS_MANAGE));
  readonly canReadStatus = computed(() => this.perms.has(USERS_INVITE) || this.perms.has(USERS_VIEW));

  readonly access = this.store.access;
  readonly statusLabel = portalStatusLabel;
  readonly statusChipClass = portalStatusChipClass;

  readonly busy = signal(false);

  /** Diálogo de confirmación genérico (cancelar invitación / desactivar). */
  readonly confirm = signal<{ kind: 'cancel' | 'deactivate'; heading: string; message: string; confirmLabel: string } | null>(
    null,
  );

  ngOnChanges(): void {
    if (this.clientId) {
      this.store.load(this.clientId, this.clientEmail);
    }
  }

  retry(): void {
    this.store.refresh();
  }

  formatDate(iso: string | null): string {
    if (!iso) {
      return '—';
    }
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---------- Acciones ----------

  invite(): void {
    this.run(this.store.invite(), 'Portal invitation sent');
  }

  resend(): void {
    const id = this.access().pendingInvitationId;
    if (id) {
      this.run(this.store.resend(id), 'Invitation resent');
    }
  }

  reactivate(): void {
    const id = this.access().portalUserId;
    if (id) {
      this.run(this.store.reactivate(id), 'Portal access reactivated');
    }
  }

  askCancel(): void {
    this.confirm.set({
      kind: 'cancel',
      heading: 'Cancel invitation',
      message: 'The pending invitation will be cancelled. The client can no longer use its link.',
      confirmLabel: 'Cancel invitation',
    });
  }

  askDeactivate(): void {
    this.confirm.set({
      kind: 'deactivate',
      heading: 'Deactivate portal access',
      message: `${this.clientName || 'This client'} will no longer be able to sign in to the portal until reactivated.`,
      confirmLabel: 'Deactivate',
    });
  }

  onConfirm(): void {
    const dialog = this.confirm();
    this.confirm.set(null);
    if (!dialog) {
      return;
    }
    if (dialog.kind === 'cancel') {
      const id = this.access().pendingInvitationId;
      if (id) {
        this.run(this.store.cancel(id), 'Invitation cancelled');
      }
    } else {
      const id = this.access().portalUserId;
      if (id) {
        this.run(this.store.deactivate(id), 'Portal access deactivated');
      }
    }
  }

  private run(action: ReturnType<ClientPortalStore['invite']>, successMessage: string): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    action.subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success(successMessage);
      },
      error: err => {
        this.busy.set(false);
        this.toast.error(toApiError(err).message);
      },
    });
  }
}
