import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { ClientRemindersStore } from '../../data-access/client-reminders.store';
import {
  ClientReminderRow,
  REMINDER_SNOOZE_OPTIONS,
  REMINDER_STATUS_FILTERS,
  ReminderCategory,
  ReminderStatusFilter,
  toLocalDateInput,
  toLocalTimeInput,
} from '../../data-access/client-reminders.model';

const PAGE_SIZE = 6;

/**
 * Pestaña "Reminders" del perfil de cliente, cableada contra Reminder.Api (`/reminders`).
 *
 * ⚠️ **La lista NO está filtrada por este cliente y el backend no permite filtrarla.**
 * `ReminderCategory` es `General | Calendar | Task | Note` — no existe `Customer` — y
 * `ReminderTarget` prohíbe mandar `targetId` con categoría `General` (y lo exige con las
 * otras tres), así que no hay forma legal de decir "recordatorio de este cliente". Encima
 * `GET /reminders/mine` y `/upcoming` filtran por el usuario del JWT y no aceptan ningún
 * parámetro de target. Se muestran los recordatorios del usuario logueado y la pestaña lo
 * declara en pantalla, en vez de fingir un filtro que no existe.
 *
 * Elementos del mock retirados por falta de respaldo:
 *  - Los tipos call/email/sms/meeting/document: no existen en el contrato. La columna
 *    "Type" ahora muestra la `category` real, y el alta siempre crea `General`.
 *  - El estado "pending"/"completed" del mock: los estados reales son Scheduled, Fired,
 *    Snoozed, Dismissed, Cancelled y Missed.
 */
@Component({
  selector: 'app-client-profile-reminders',
  imports: [CommonModule, FormsModule, ModalComponent, ConfirmDialogComponent, PaginationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-reminders.component.html',
})
export class ClientProfileRemindersComponent implements OnInit {
  /**
   * Lo recibe del perfil pero NO se usa: Reminder no tiene vínculo con Customer (ver el
   * comentario de la clase). Se conserva para no romper el binding del padre y para el día
   * en que el backend agregue la categoría `Customer`.
   */
  @Input() clientId = '';

  readonly store = inject(ClientRemindersStore);

  readonly pageSize = PAGE_SIZE;
  readonly statusFilters = REMINDER_STATUS_FILTERS;
  readonly snoozeOptions = REMINDER_SNOOZE_OPTIONS;

  readonly search = signal('');
  readonly statusFilter = signal<ReminderStatusFilter>('all');
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly currentPage = signal(1);

  /** Filtros en memoria: /reminders/mine solo filtra por `status` y no busca texto ni rangos. */
  readonly visibleReminders = computed<ClientReminderRow[]>(() => {
    const query = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    const from = this.fromDate();
    const to = this.toDate();
    return this.store
      .reminders()
      .filter(item => status === 'all' || item.status === status)
      .filter(item => !from || item.fireAtLocalDate >= from)
      .filter(item => !to || item.fireAtLocalDate <= to)
      .filter(
        item =>
          !query ||
          item.title.toLowerCase().includes(query) ||
          (item.body ?? '').toLowerCase().includes(query),
      );
  });

  readonly pagedReminders = computed<ClientReminderRow[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleReminders().slice(start, start + PAGE_SIZE);
  });

  // ---------- Formulario (alta / edición) ----------
  readonly isModalOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly formTitle = signal('');
  readonly formBody = signal('');
  readonly formDate = signal('');
  readonly formTime = signal('09:00');
  readonly modalError = signal<string | null>(null);
  readonly modalSaving = signal(false);

  /** Fila en edición: dice si el schedule todavía se puede mover (solo Scheduled/Snoozed). */
  readonly editingRow = computed<ClientReminderRow | null>(() => {
    const id = this.editingId();
    return id ? this.store.reminders().find(item => item.id === id) ?? null : null;
  });

  readonly canEditSchedule = computed(() => {
    const row = this.editingRow();
    return row === null || row.canReschedule;
  });

  readonly canSave = computed(() => {
    if (!this.formTitle().trim() || this.modalSaving()) {
      return false;
    }
    // Al crear, la fecha es obligatoria (el schedule absoluto la exige y debe ser futura).
    return this.editingId() !== null || this.formDate().trim().length > 0;
  });

  /** Menú de snooze abierto (uno por fila). */
  readonly openSnoozeId = signal<string | null>(null);

  readonly pendingCancel = signal<ClientReminderRow | null>(null);
  readonly pendingCancelMessage = computed(() => {
    const reminder = this.pendingCancel();
    return reminder
      ? `"${reminder.title}" will move to Cancelled. The reminder stays in the history but never fires.`
      : '';
  });

  ngOnInit(): void {
    this.store.load();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="reminder-snooze"]')) {
      this.openSnoozeId.set(null);
    }
  }

  retry(): void {
    this.store.load();
  }

  dismissActionError(): void {
    this.store.clearActionError();
  }

  setSearch(value: string): void {
    this.search.set(value);
    this.currentPage.set(1);
  }

  setStatusFilter(status: ReminderStatusFilter): void {
    this.statusFilter.set(status);
    this.currentPage.set(1);
  }

  setFromDate(value: string): void {
    this.fromDate.set(value);
    this.currentPage.set(1);
  }

  setToDate(value: string): void {
    this.toDate.set(value);
    this.currentPage.set(1);
  }

  /** Icono de la categoría REAL del recordatorio (la que devuelve el backend). */
  categoryIcon(category: ReminderCategory): string {
    switch (category) {
      case 'Calendar':
        return 'calendar-outline';
      case 'Task':
        return 'checkbox-outline';
      case 'Note':
        return 'document-text-outline';
      case 'General':
      default:
        return 'alarm-outline';
    }
  }

  // ---------- Alta / edición ----------

  openCreate(): void {
    this.editingId.set(null);
    this.formTitle.set('');
    this.formBody.set('');
    this.formDate.set('');
    this.formTime.set('09:00');
    this.modalError.set(null);
    this.isModalOpen.set(true);
  }

  openEdit(reminder: ClientReminderRow): void {
    this.editingId.set(reminder.id);
    this.formTitle.set(reminder.title);
    this.formBody.set(reminder.body ?? '');
    this.formDate.set(toLocalDateInput(reminder.fireAtUtc));
    this.formTime.set(toLocalTimeInput(reminder.fireAtUtc));
    this.modalError.set(null);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.editingId.set(null);
    this.modalError.set(null);
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    const form = {
      title: this.formTitle(),
      body: this.formBody(),
      date: this.formDate(),
      time: this.formTime() || '09:00',
    };
    const row = this.editingRow();

    this.modalSaving.set(true);
    this.modalError.set(null);
    const request = row ? this.store.update(row, form) : this.store.create(form);
    request.subscribe({
      next: () => {
        this.modalSaving.set(false);
        this.closeModal();
      },
      error: err => {
        this.modalError.set(toApiError(err).message);
        this.modalSaving.set(false);
      },
    });
  }

  // ---------- Acciones de fila ----------

  toggleSnoozeMenu(reminder: ClientReminderRow): void {
    this.openSnoozeId.update(current => (current === reminder.id ? null : reminder.id));
  }

  snooze(reminder: ClientReminderRow, minutes: number): void {
    this.openSnoozeId.set(null);
    this.store.snooze(reminder.id, minutes);
  }

  dismiss(reminder: ClientReminderRow): void {
    this.store.dismiss(reminder.id);
  }

  requestCancel(reminder: ClientReminderRow): void {
    this.pendingCancel.set(reminder);
  }

  confirmCancel(): void {
    const reminder = this.pendingCancel();
    if (reminder) {
      this.store.cancel(reminder.id);
    }
    this.pendingCancel.set(null);
  }
}
