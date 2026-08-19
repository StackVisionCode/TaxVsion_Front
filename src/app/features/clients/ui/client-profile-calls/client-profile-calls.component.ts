import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';

type CallKind = 'audio' | 'video';
type CallDirection = 'inbound' | 'outbound';
type CallStatus = 'completed' | 'missed' | 'rejected' | 'noAnswer';
type KindFilter = 'all' | CallKind;
type StatusFilter = 'all' | CallStatus;
type DateRangeFilter = '7' | '30' | '90' | 'all';

interface CallEntry {
  id: string;
  kind: CallKind;
  direction: CallDirection;
  participantName: string;
  /** ISO datetime string (YYYY-MM-DDTHH:mm). */
  timestamp: string;
  durationSeconds: number;
  status: CallStatus;
}

const PAGE_SIZE = 8;

/** Builds an ISO datetime string relative to today so the mock call log always looks alive. */
function timestampDaysAgo(daysAgo: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

const MOCK_CALLS: CallEntry[] = [
  { id: 'call-1', kind: 'audio', direction: 'outbound', participantName: 'Maria Chen', timestamp: timestampDaysAgo(0, 10), durationSeconds: 254, status: 'completed' },
  { id: 'call-2', kind: 'video', direction: 'inbound', participantName: 'David Ruiz', timestamp: timestampDaysAgo(1, 14), durationSeconds: 612, status: 'completed' },
  { id: 'call-3', kind: 'audio', direction: 'outbound', participantName: 'Maria Chen', timestamp: timestampDaysAgo(2, 9), durationSeconds: 0, status: 'missed' },
  { id: 'call-4', kind: 'audio', direction: 'inbound', participantName: 'Client', timestamp: timestampDaysAgo(4, 16), durationSeconds: 98, status: 'completed' },
  { id: 'call-5', kind: 'video', direction: 'outbound', participantName: 'David Ruiz', timestamp: timestampDaysAgo(6, 11), durationSeconds: 0, status: 'noAnswer' },
  { id: 'call-6', kind: 'audio', direction: 'outbound', participantName: 'Maria Chen', timestamp: timestampDaysAgo(9, 10), durationSeconds: 445, status: 'completed' },
  { id: 'call-7', kind: 'audio', direction: 'inbound', participantName: 'Client', timestamp: timestampDaysAgo(12, 15), durationSeconds: 0, status: 'rejected' },
  { id: 'call-8', kind: 'video', direction: 'outbound', participantName: 'David Ruiz', timestamp: timestampDaysAgo(18, 13), durationSeconds: 780, status: 'completed' },
  { id: 'call-9', kind: 'audio', direction: 'outbound', participantName: 'Maria Chen', timestamp: timestampDaysAgo(25, 9), durationSeconds: 132, status: 'completed' },
  { id: 'call-10', kind: 'audio', direction: 'inbound', participantName: 'Client', timestamp: timestampDaysAgo(40, 10), durationSeconds: 0, status: 'missed' },
  { id: 'call-11', kind: 'video', direction: 'outbound', participantName: 'David Ruiz', timestamp: timestampDaysAgo(55, 14), durationSeconds: 900, status: 'completed' },
  { id: 'call-12', kind: 'audio', direction: 'outbound', participantName: 'Maria Chen', timestamp: timestampDaysAgo(70, 9), durationSeconds: 210, status: 'completed' },
];

/**
 * Pestaña "Calls" del perfil de cliente (puerto visual/estructural de
 * `cuenta-llamadas`): stat cards + card de filtros/tabla, solo lectura.
 * Se descarta la capa en tiempo real del legacy (estado "online", inicio
 * real de llamada, reproducción de grabación, export CSV) al no existir
 * sockets/WebRTC en este proyecto — queda como un historial con stats.
 */
@Component({
  selector: 'app-client-profile-calls',
  imports: [CommonModule, FormsModule, PaginationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-calls.component.html',
})
export class ClientProfileCallsComponent {
  @Input() clientId = '';

  readonly pageSize = PAGE_SIZE;
  readonly kindFilters: { value: KindFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'audio', label: 'Audio' },
    { value: 'video', label: 'Video' },
  ];
  readonly statusFilters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'completed', label: 'Completed' },
    { value: 'missed', label: 'Missed' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'noAnswer', label: 'No answer' },
  ];
  readonly dateRangeFilters: { value: DateRangeFilter; label: string }[] = [
    { value: '7', label: 'Last 7 days' },
    { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' },
    { value: 'all', label: 'All time' },
  ];

  readonly calls = signal<CallEntry[]>([...MOCK_CALLS]);
  readonly search = signal('');
  readonly kindFilter = signal<KindFilter>('all');
  readonly statusFilter = signal<StatusFilter>('all');
  readonly dateRange = signal<DateRangeFilter>('all');
  readonly currentPage = signal(1);

  readonly visibleCalls = computed<CallEntry[]>(() => {
    const query = this.search().trim().toLowerCase();
    const kind = this.kindFilter();
    const status = this.statusFilter();
    const range = this.dateRange();
    const cutoff = range === 'all' ? null : Date.now() - Number(range) * 24 * 60 * 60 * 1000;
    return this.calls()
      .filter(call => kind === 'all' || call.kind === kind)
      .filter(call => status === 'all' || call.status === status)
      .filter(call => cutoff === null || new Date(call.timestamp).getTime() >= cutoff)
      .filter(call => !query || call.participantName.toLowerCase().includes(query))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  });

  readonly pagedCalls = computed<CallEntry[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleCalls().slice(start, start + PAGE_SIZE);
  });

  readonly totalCalls = computed(() => this.calls().length);
  readonly completedCalls = computed(() => this.calls().filter(call => call.status === 'completed').length);
  readonly missedCalls = computed(() => this.calls().filter(call => call.status === 'missed' || call.status === 'noAnswer').length);
  readonly avgDurationSeconds = computed(() => {
    const completed = this.calls().filter(call => call.status === 'completed');
    if (completed.length === 0) {
      return 0;
    }
    return Math.round(completed.reduce((sum, call) => sum + call.durationSeconds, 0) / completed.length);
  });

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

  setDateRange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.currentPage.set(1);
  }

  formatDuration(seconds: number): string {
    if (seconds === 0) {
      return '—';
    }
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}:${remaining.toString().padStart(2, '0')}`;
  }

  formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  kindIcon(kind: CallKind): string {
    return kind === 'video' ? 'videocam-outline' : 'call-outline';
  }

  directionIcon(direction: CallDirection): string {
    return direction === 'inbound' ? 'arrow-down-outline' : 'arrow-up-outline';
  }

  statusLabel(status: CallStatus): string {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'missed':
        return 'Missed';
      case 'rejected':
        return 'Rejected';
      case 'noAnswer':
        return 'No answer';
    }
  }

  statusChip(status: CallStatus): string {
    return status === 'completed' ? 'border-emerald-200 text-emerald-600' : 'border-red-200 text-red-500';
  }

  statusDot(status: CallStatus): string {
    return status === 'completed' ? 'bg-emerald-500' : 'bg-red-500';
  }

  initials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  }
}
