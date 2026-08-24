import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupportStatus, SupportTicket, canReopenTicket } from '../../data-access/support.model';

interface StatusMeta {
  label: string;
  chipClass: string;
}

/** Chip outline por estado, mismo lenguaje visual que los chips de la página. */
const STATUS_META: Record<SupportStatus, StatusMeta> = {
  Open: { label: 'Open', chipClass: 'border-blue-200 text-blue-600' },
  Claimed: { label: 'In progress', chipClass: 'border-indigo-200 text-indigo-600' },
  WaitingCustomer: { label: 'Waiting on you', chipClass: 'border-amber-200 text-amber-600' },
  WaitingAgent: { label: 'Waiting on support', chipClass: 'border-purple-200 text-purple-600' },
  Resolved: { label: 'Resolved', chipClass: 'border-emerald-200 text-emerald-600' },
  Closed: { label: 'Closed', chipClass: 'border-gray-200 text-gray-500' },
};

/**
 * Lista "My tickets" del módulo Support (estilo "Aether"): filas en tarjetas
 * `rounded-2xl` con chip de estado, asunto y fecha de apertura. Componente
 * dumb — datos y paginación llegan por inputs desde support-page; el botón
 * Reopen (solo Resolved/Closed, el opener está autorizado) emite el id.
 */
@Component({
  selector: 'app-support-ticket-list',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './support-ticket-list.component.html',
})
export class SupportTicketListComponent {
  @Input() tickets: SupportTicket[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input() page = 1;
  @Input() totalPages = 1;
  @Input() totalCount = 0;
  /** Id del ticket cuyo reopen está en vuelo (deshabilita su botón). */
  @Input() reopeningId: string | null = null;
  @Input() reopenError: string | null = null;

  @Output() reopenTicket = new EventEmitter<string>();
  @Output() pageChange = new EventEmitter<number>();
  @Output() retry = new EventEmitter<void>();

  /** Placeholders del skeleton mientras carga. */
  readonly skeletonRows = [0, 1, 2];

  canReopen(ticket: SupportTicket): boolean {
    return canReopenTicket(ticket);
  }

  statusLabel(status: SupportStatus): string {
    return STATUS_META[status].label;
  }

  statusChipClass(status: SupportStatus): string {
    return STATUS_META[status].chipClass;
  }

  /** Id corto para mostrar (el id completo va en el tooltip). */
  shortId(ticket: SupportTicket): string {
    return ticket.id.slice(0, 8);
  }

  previousPage(): void {
    if (this.page > 1 && !this.loading) {
      this.pageChange.emit(this.page - 1);
    }
  }

  nextPage(): void {
    if (this.page < this.totalPages && !this.loading) {
      this.pageChange.emit(this.page + 1);
    }
  }
}
