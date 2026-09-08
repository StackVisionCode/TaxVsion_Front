import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { PermissionService } from '@core/auth/permission.service';
import { ToastService } from '../../../../shared/ui/toast/toast.service';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { ClientRequestsStore } from '../../data-access/client-requests.store';
import {
  ClientRequestItem,
  requestStatusChipClass,
  requestStatusLabel,
} from '../../data-access/client-requests.model';

/** Permiso de gestión de client-requests (BuildingBlocks.Authorization.TasksPermissions). */
const CLIENT_REQUESTS_MANAGE = 'tasks.client_requests.manage';
const TASKS_READ = 'tasks.read';

/**
 * Sección "Requests from client" del perfil (Tasks.Api vía `/tasks/client-requests?customerId=`).
 *
 * Un ClientRequest es lo que la firma le pidió al cliente (agregado aparte de la tarea). Se lista
 * con el endpoint de staff por cliente, se crea con `POST /tasks/client-requests` y se cierra con
 * `POST /{id}/resolve` (Accept/Reject/Cancel). Aceptar/rechazar solo aplica cuando el cliente ya
 * envió algo (Submitted); rechazar exige motivo (el cliente tiene que saber qué corregir).
 */
@Component({
  selector: 'app-client-profile-requests',
  imports: [CommonModule, FormsModule, ModalComponent, ConfirmDialogComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-requests.component.html',
  styleUrl: './client-profile-requests.component.css',
})
export class ClientProfileRequestsComponent implements OnChanges {
  @Input() clientId = '';
  @Input() clientName = '';

  readonly store = inject(ClientRequestsStore);
  private readonly perms = inject(PermissionService);
  private readonly toast = inject(ToastService);

  readonly canRead = computed(() => this.perms.has(TASKS_READ));
  readonly canManage = computed(() => this.perms.has(CLIENT_REQUESTS_MANAGE));

  readonly statusChipClass = requestStatusChipClass;
  readonly statusLabel = requestStatusLabel;

  // ---------- Crear ----------
  readonly isCreateOpen = signal(false);
  readonly formTitle = signal('');
  readonly formDetails = signal('');
  readonly formDue = signal('');
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);

  readonly canCreate = computed(() => this.formTitle().trim().length > 0 && !this.creating());

  // ---------- Rechazar (motivo obligatorio) ----------
  readonly rejectItem = signal<ClientRequestItem | null>(null);
  readonly rejectReason = signal('');

  // ---------- Cancelar (confirmación) ----------
  readonly cancelItem = signal<ClientRequestItem | null>(null);
  readonly cancelMessage = computed(() => {
    const item = this.cancelItem();
    return item ? `"${item.title}" will be cancelled. The client no longer needs to send it.` : '';
  });

  ngOnChanges(): void {
    if (this.clientId) {
      this.store.load(this.clientId);
    }
  }

  retry(): void {
    this.store.refresh();
  }

  dismissActionError(): void {
    this.store.clearActionError();
  }

  documentSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatDue(dueDate: string): string {
    if (!dueDate) return 'No due date';
    return new Date(`${dueDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---------- Crear ----------

  openCreate(): void {
    this.formTitle.set('');
    this.formDetails.set('');
    this.formDue.set('');
    this.createError.set(null);
    this.isCreateOpen.set(true);
  }

  closeCreate(): void {
    this.isCreateOpen.set(false);
    this.createError.set(null);
  }

  confirmCreate(): void {
    if (!this.canCreate()) {
      return;
    }
    this.creating.set(true);
    this.createError.set(null);
    this.store.create(this.formTitle(), this.formDetails(), this.formDue(), null).subscribe({
      next: () => {
        this.creating.set(false);
        this.isCreateOpen.set(false);
        this.toast.success('Request sent to client');
      },
      error: err => {
        this.createError.set(toApiError(err).message);
        this.creating.set(false);
      },
    });
  }

  // ---------- Resolver ----------

  accept(item: ClientRequestItem): void {
    this.store.resolve(item.id, 'Accept', null);
    this.toast.success('Request accepted');
  }

  openReject(item: ClientRequestItem): void {
    this.rejectItem.set(item);
    this.rejectReason.set('');
  }

  closeReject(): void {
    this.rejectItem.set(null);
  }

  confirmReject(): void {
    const item = this.rejectItem();
    const reason = this.rejectReason().trim();
    if (!item || !reason) {
      return;
    }
    // El store resuelve con banner de acción si falla (mismo patrón que Notes).
    this.store.resolve(item.id, 'Reject', reason);
    this.rejectItem.set(null);
    this.toast.info('Request rejected — the client sees your note');
  }

  openCancel(item: ClientRequestItem): void {
    this.cancelItem.set(item);
  }

  confirmCancel(): void {
    const item = this.cancelItem();
    if (item) {
      this.store.resolve(item.id, 'Cancel', null);
      this.toast.success('Request cancelled');
    }
    this.cancelItem.set(null);
  }

  trackById(_index: number, item: ClientRequestItem): string {
    return item.id;
  }
}
