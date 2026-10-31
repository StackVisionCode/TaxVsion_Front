import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupportInboxFilter, SupportTicket, ticketActivityAt, ticketPreview } from '../../data-access/support.model';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { LoadMoreComponent } from '@shared/ui/load-more/load-more.component';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import { SUPPORT_STATUS_META } from '../support-status';

/**
 * Columna de la bandeja de Support: búsqueda, pestañas Active/Closed con contador y no leídos, y una fila por
 * ticket con su último mensaje. La fila con mensajes nuevos va en negrita y con su contador. Componente dumb.
 */
@Component({
  selector: 'app-support-ticket-list',
  imports: [CommonModule, SearchInputComponent, LoadMoreComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './support-ticket-list.component.html',
})
export class SupportTicketListComponent {
  @Input() tickets: SupportTicket[] = [];
  @Input() selectedId: string | null = null;
  @Input() filter: SupportInboxFilter = 'active';
  @Input() activeCount = 0;
  @Input() closedCount = 0;
  @Input() activeUnread = 0;
  @Input() closedUnread = 0;
  @Input() search = '';
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input() hasMore = false;
  @Input() loadingMore = false;

  @Output() selectTicket = new EventEmitter<SupportTicket>();
  @Output() filterChange = new EventEmitter<SupportInboxFilter>();
  @Output() searchChange = new EventEmitter<string>();
  @Output() loadMore = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();

  readonly skeletonRows = [0, 1, 2, 3];

  statusLabel(ticket: SupportTicket): string {
    return SUPPORT_STATUS_META[ticket.status].label;
  }

  statusClass(ticket: SupportTicket): string {
    return SUPPORT_STATUS_META[ticket.status].textClass;
  }

  preview(ticket: SupportTicket): string {
    return ticketPreview(ticket);
  }

  unread(ticket: SupportTicket): number {
    return ticket.unreadCount ?? 0;
  }

  /** Hoy: la hora; antes: el día. */
  when(ticket: SupportTicket): string {
    const at = parseUtcDate(ticketActivityAt(ticket));
    if (Number.isNaN(at.getTime())) return '';
    return at.toDateString() === new Date().toDateString()
      ? at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  trackTicket(_: number, ticket: SupportTicket): string {
    return ticket.id;
  }
}
