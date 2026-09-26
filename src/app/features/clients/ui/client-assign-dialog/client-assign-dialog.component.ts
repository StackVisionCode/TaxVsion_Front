import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA, Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, of } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CustomerAssignee } from '../../data-access/clients.model';
import { ClientsStore } from '../../data-access/clients.store';
import { StaffDirectoryStore, StaffMember } from '../../data-access/staff-directory.store';

/** Cliente objetivo del diálogo en modo single (solo lo que se necesita para el encabezado + las llamadas). */
export interface AssignDialogClient {
  id: string;
  displayName: string;
}

interface AssigneeRow {
  userId: string;
  isPrimary: boolean;
  member?: StaffMember;
}

/**
 * Diálogo para asignar clientes a staff. Dos modos:
 * - single: gestiona los asignados de UN cliente (responsable + accesos), con estrella para el primary.
 * - bulk: elige UN miembro y le da acceso a los N clientes seleccionados (reparto de cartera).
 * Solo lectura del staff vía StaffDirectoryStore (resuelve nombre/avatar). Emite `closed(changed)`.
 */
@Component({
  selector: 'app-client-assign-dialog',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-assign-dialog.component.html',
})
export class ClientAssignDialogComponent {
  private readonly store = inject(ClientsStore);
  private readonly staff = inject(StaffDirectoryStore);
  private readonly toast = inject(ToastService);

  @Input() isOpen = false;
  @Input() mode: 'single' | 'bulk' = 'single';
  @Input() customerIds: string[] = [];

  @Input() set client(value: AssignDialogClient | null) {
    this._client.set(value);
    if (value && this.mode === 'single') {
      this.loadAssignees(value.id);
    }
  }

  @Output() closed = new EventEmitter<boolean>();

  private readonly _client = signal<AssignDialogClient | null>(null);
  private readonly _rawAssignees = signal<CustomerAssignee[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly query = signal('');
  readonly pickerOpen = signal(false);
  readonly bulkTarget = signal<StaffMember | null>(null);
  readonly bulkResult = signal<{ assigned: number; alreadyAssigned: number; notFound: number } | null>(null);

  private changed = false;

  constructor() {
    // El staff se necesita para el picker y para resolver los avatares de los asignados.
    this.staff.ensureLoaded();
  }

  readonly clientName = computed(() => this._client()?.displayName ?? '');

  readonly heading = computed(() => (this.mode === 'bulk' ? 'Assign to team member' : 'Assign staff'));

  readonly subheading = computed(() =>
    this.mode === 'bulk'
      ? `${this.customerIds.length} ${this.customerIds.length === 1 ? 'client' : 'clients'} selected`
      : this.clientName(),
  );

  /** Asignados actuales resueltos a staff (reactivo al directorio: los avatares se rellenan al cargar). */
  readonly assignees = computed<AssigneeRow[]>(() => {
    const members = this.staff.members();
    const byId = new Map(members.map(m => [m.userId, m]));
    return this._rawAssignees().map(a => ({ userId: a.userId, isPrimary: a.isPrimary, member: byId.get(a.userId) }));
  });

  private readonly hasPrimary = computed(() => this._rawAssignees().some(a => a.isPrimary));

  /** Staff del picker: en single se ocultan los ya asignados; en bulk se muestran todos. */
  readonly pickerResults = computed(() => {
    const assigned = new Set(this._rawAssignees().map(a => a.userId));
    return this.staff.search(this.query()).filter(m => this.mode === 'bulk' || !assigned.has(m.userId));
  });

  // ---------- single ----------

  private loadAssignees(id: string): void {
    this._rawAssignees.set([]);
    this.loading.set(true);
    this.store
      .getById(id)
      .pipe(catchError(() => of(null)))
      .subscribe(detail => {
        this.loading.set(false);
        this._rawAssignees.set(detail?.assignees ?? []);
      });
  }

  /** Agrega a un miembro: si el cliente no tiene responsable, queda de responsable; si no, acceso adicional. */
  add(member: StaffMember): void {
    const client = this._client();
    if (!client || this.saving()) {
      return;
    }
    this.query.set('');
    this.pickerOpen.set(false);
    const op = this.hasPrimary()
      ? this.store.grantAccess(client.id, member.userId)
      : this.store.assignPreparer(client.id, member.userId);
    this.run(op, client.id);
  }

  makePrimary(row: AssigneeRow): void {
    const client = this._client();
    if (!client || row.isPrimary || this.saving()) {
      return;
    }
    this.run(this.store.assignPreparer(client.id, row.userId), client.id);
  }

  remove(row: AssigneeRow): void {
    const client = this._client();
    if (!client || this.saving()) {
      return;
    }
    const op = row.isPrimary ? this.store.unassignPreparer(client.id) : this.store.revokeAccess(client.id, row.userId);
    this.run(op, client.id);
  }

  private run(op: ReturnType<ClientsStore['grantAccess']>, clientId: string): void {
    this.saving.set(true);
    op.subscribe({
      next: () => {
        this.changed = true;
        this.loadAssignees(clientId);
        this.saving.set(false);
      },
      error: err => {
        this.saving.set(false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  // ---------- bulk ----------

  selectTarget(member: StaffMember): void {
    this.bulkTarget.set(member);
    this.query.set('');
    this.pickerOpen.set(false);
  }

  clearTarget(): void {
    this.bulkTarget.set(null);
    this.bulkResult.set(null);
  }

  confirmBulk(): void {
    const target = this.bulkTarget();
    if (!target || this.customerIds.length === 0 || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.store.bulkAssign(target.userId, this.customerIds).subscribe({
      next: result => {
        this.saving.set(false);
        this.changed = true;
        this.bulkResult.set(result);
        this.toast.success(
          `${result.assigned} ${result.assigned === 1 ? 'client' : 'clients'} assigned to ${target.name}`,
        );
      },
      error: err => {
        this.saving.set(false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  // ---------- shared ----------

  onQueryFocus(): void {
    this.pickerOpen.set(true);
  }

  close(): void {
    const changed = this.changed;
    this.changed = false;
    this.query.set('');
    this.pickerOpen.set(false);
    this.bulkTarget.set(null);
    this.bulkResult.set(null);
    this.closed.emit(changed);
  }
}
