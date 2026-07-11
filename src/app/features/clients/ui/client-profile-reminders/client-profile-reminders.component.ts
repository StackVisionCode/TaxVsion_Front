import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';

type ReminderKind = 'call' | 'email' | 'sms' | 'meeting' | 'document';
type ReminderStatus = 'scheduled' | 'pending' | 'completed' | 'cancelled';
type KindFilter = 'all' | ReminderKind;
type StatusFilter = 'all' | ReminderStatus;

interface ReminderItem {
  id: string;
  kind: ReminderKind;
  title: string;
  description?: string;
  /** ISO datetime string (YYYY-MM-DDTHH:mm). */
  datetime: string;
  status: ReminderStatus;
}

const PAGE_SIZE = 6;

/** Builds an ISO datetime string relative to today so the mock reminders always look alive. */
function dateTimeInDays(days: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

const MOCK_REMINDERS: ReminderItem[] = [
  { id: 'rem-1', kind: 'call', title: 'Follow up on Q2 estimated payment', datetime: dateTimeInDays(2, 10), status: 'scheduled' },
  {
    id: 'rem-2',
    kind: 'document',
    title: 'Request corrected 1099-NEC',
    description: 'Waiting on contractor to reissue the form',
    datetime: dateTimeInDays(4, 9),
    status: 'scheduled',
  },
  { id: 'rem-3', kind: 'meeting', title: 'Quarterly review call', datetime: dateTimeInDays(7, 14), status: 'scheduled' },
  { id: 'rem-4', kind: 'email', title: 'Send engagement letter reminder', datetime: dateTimeInDays(-1, 9), status: 'pending' },
  { id: 'rem-5', kind: 'sms', title: 'Confirm document drop-off', datetime: dateTimeInDays(-3, 11), status: 'completed' },
  { id: 'rem-6', kind: 'call', title: 'Discuss switch to quarterly bookkeeping', datetime: dateTimeInDays(-10, 15), status: 'completed' },
  { id: 'rem-7', kind: 'document', title: 'Chase missing W-2 form', datetime: dateTimeInDays(-15, 9), status: 'cancelled' },
  { id: 'rem-8', kind: 'meeting', title: 'Annual filing kickoff', datetime: dateTimeInDays(14, 10), status: 'scheduled' },
  { id: 'rem-9', kind: 'email', title: 'Send welcome packet', datetime: dateTimeInDays(-30, 9), status: 'completed' },
  { id: 'rem-10', kind: 'call', title: 'Renewal check-in', datetime: dateTimeInDays(21, 13), status: 'scheduled' },
];

/**
 * Pestaña "Reminders" del perfil de cliente (puerto visual/estructural de
 * `cuenta-reminder`): header + filtros (búsqueda, tipo, estado, rango de
 * fecha) + tabla + alta/edición vía `app-modal` + "Cancel" vía
 * `app-confirm-dialog` (transiciona el status a 'cancelled', no borra la
 * fila, igual semántica que el legacy). Datos mock locales al componente.
 */
@Component({
  selector: 'app-client-profile-reminders',
  imports: [CommonModule, FormsModule, ModalComponent, ConfirmDialogComponent, PaginationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-reminders.component.html',
})
export class ClientProfileRemindersComponent {
  @Input() clientId = '';

  readonly pageSize = PAGE_SIZE;
  readonly kindFilters: { value: KindFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'call', label: 'Call' },
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
    { value: 'meeting', label: 'Meeting' },
    { value: 'document', label: 'Document' },
  ];
  readonly statusFilters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'pending', label: 'Pending' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];
  readonly kindOptions: { value: ReminderKind; label: string }[] = [
    { value: 'call', label: 'Call' },
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
    { value: 'meeting', label: 'Meeting' },
    { value: 'document', label: 'Document' },
  ];

  readonly reminders = signal<ReminderItem[]>([...MOCK_REMINDERS]);
  readonly search = signal('');
  readonly kindFilter = signal<KindFilter>('all');
  readonly statusFilter = signal<StatusFilter>('all');
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly currentPage = signal(1);

  readonly visibleReminders = computed<ReminderItem[]>(() => {
    const query = this.search().trim().toLowerCase();
    const kind = this.kindFilter();
    const status = this.statusFilter();
    const from = this.fromDate();
    const to = this.toDate();
    return this.reminders()
      .filter(item => kind === 'all' || item.kind === kind)
      .filter(item => status === 'all' || item.status === status)
      .filter(item => !from || item.datetime.slice(0, 10) >= from)
      .filter(item => !to || item.datetime.slice(0, 10) <= to)
      .filter(item => !query || item.title.toLowerCase().includes(query) || (item.description ?? '').toLowerCase().includes(query))
      .sort((a, b) => a.datetime.localeCompare(b.datetime));
  });

  readonly pagedReminders = computed<ReminderItem[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleReminders().slice(start, start + PAGE_SIZE);
  });

  // Form
  readonly isModalOpen = signal(false);
  readonly editingReminderId = signal<string | null>(null);
  readonly formKind = signal<ReminderKind>('call');
  readonly formTitle = signal('');
  readonly formDescription = signal('');
  readonly formDate = signal('');
  readonly formTime = signal('09:00');
  readonly isKindDropdownOpen = signal(false);

  readonly canSave = computed(() => this.formTitle().trim().length > 0 && this.formDate().trim().length > 0);

  readonly pendingCancel = signal<ReminderItem | null>(null);
  readonly pendingCancelMessage = computed(() => {
    const reminder = this.pendingCancel();
    return reminder ? `You're about to cancel "${reminder.title}". This can't be undone.` : '';
  });

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="reminder-kind"]')) {
      this.isKindDropdownOpen.set(false);
    }
  }

  setSearch(value: string): void {
    this.search.set(value);
    this.currentPage.set(1);
  }

  setKindFilter(kind: KindFilter): void {
    this.kindFilter.set(kind);
    this.currentPage.set(1);
  }

  setStatusFilter(status: StatusFilter): void {
    this.statusFilter.set(status);
    this.currentPage.set(1);
  }

  kindIcon(kind: ReminderKind): string {
    switch (kind) {
      case 'call':
        return 'call-outline';
      case 'email':
        return 'mail-outline';
      case 'sms':
        return 'chatbox-outline';
      case 'meeting':
        return 'people-outline';
      case 'document':
        return 'document-text-outline';
    }
  }

  kindLabel(kind: ReminderKind): string {
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  }

  statusLabel(status: ReminderStatus): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  statusChip(status: ReminderStatus): string {
    switch (status) {
      case 'scheduled':
        return 'border-indigo-200 text-indigo-600';
      case 'pending':
        return 'border-orange-200 text-orange-500';
      case 'completed':
        return 'border-emerald-200 text-emerald-600';
      case 'cancelled':
        return 'border-gray-300 text-gray-500';
    }
  }

  statusDot(status: ReminderStatus): string {
    switch (status) {
      case 'scheduled':
        return 'bg-indigo-500';
      case 'pending':
        return 'bg-orange-500';
      case 'completed':
        return 'bg-emerald-500';
      case 'cancelled':
        return 'bg-gray-400';
    }
  }

  formatDateTime(datetime: string): string {
    const date = new Date(datetime);
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  openCreate(): void {
    this.editingReminderId.set(null);
    this.formKind.set('call');
    this.formTitle.set('');
    this.formDescription.set('');
    this.formDate.set('');
    this.formTime.set('09:00');
    this.isModalOpen.set(true);
  }

  openEdit(reminder: ReminderItem): void {
    this.editingReminderId.set(reminder.id);
    this.formKind.set(reminder.kind);
    this.formTitle.set(reminder.title);
    this.formDescription.set(reminder.description ?? '');
    this.formDate.set(reminder.datetime.slice(0, 10));
    this.formTime.set(reminder.datetime.slice(11, 16));
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.editingReminderId.set(null);
  }

  toggleKindDropdown(): void {
    this.isKindDropdownOpen.update(open => !open);
  }

  selectKind(kind: ReminderKind): void {
    this.formKind.set(kind);
    this.isKindDropdownOpen.set(false);
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    const id = this.editingReminderId();
    const reminder: ReminderItem = {
      id: id ?? `rem-${Date.now()}`,
      kind: this.formKind(),
      title: this.formTitle().trim(),
      description: this.formDescription().trim() || undefined,
      datetime: `${this.formDate()}T${this.formTime() || '09:00'}`,
      status: id ? this.reminders().find(item => item.id === id)?.status ?? 'scheduled' : 'scheduled',
    };
    this.reminders.update(list => {
      const exists = list.some(item => item.id === reminder.id);
      return exists ? list.map(item => (item.id === reminder.id ? reminder : item)) : [...list, reminder];
    });
    this.closeModal();
  }

  requestCancel(reminder: ReminderItem): void {
    this.pendingCancel.set(reminder);
  }

  confirmCancel(): void {
    const reminder = this.pendingCancel();
    if (!reminder) {
      return;
    }
    this.reminders.update(list => list.map(item => (item.id === reminder.id ? { ...item, status: 'cancelled' as const } : item)));
    this.pendingCancel.set(null);
  }
}
