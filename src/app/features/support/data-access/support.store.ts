import { Injectable, computed, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { SupportService } from './support.service';
import {
  SupportInboxFilter,
  SupportTicket,
  SupportTicketFormValue,
  isTicketFinished,
  ticketActivityAt,
} from './support.model';

/** Tickets por página de la bandeja (el backend acepta 1..100). */
const PAGE_SIZE = 50;

/** Lo que la bandeja necesita de un mensaje nuevo de un ticket (lo da el ChatStore). */
export interface SupportTicketActivity {
  conversationId: string;
  fromMe: boolean;
  kind: string;
  body: string | null;
  createdAtUtc: string;
  viewing: boolean;
}

/**
 * Store de la bandeja de Support: tickets del usuario con sus no leídos, filtro Active/Closed, búsqueda local,
 * ticket elegido (su chat se ve al lado), alta de tickets en diálogo y reopen.
 */
@Injectable({ providedIn: 'root' })
export class SupportStore {
  private readonly service = inject(SupportService);

  private readonly _tickets = signal<SupportTicket[]>([]);
  private readonly _loading = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _page = signal(1);
  private readonly _totalCount = signal(0);
  private readonly _filter = signal<SupportInboxFilter>('active');
  private readonly _search = signal('');
  private readonly _selected = signal<SupportTicket | null>(null);

  private readonly _formOpen = signal(false);
  private readonly _submitting = signal(false);
  private readonly _submitError = signal<string | null>(null);

  private readonly _reopeningId = signal<string | null>(null);
  private readonly _reopenError = signal<string | null>(null);

  readonly tickets = this._tickets.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly error = this._error.asReadonly();
  readonly totalCount = this._totalCount.asReadonly();
  readonly filter = this._filter.asReadonly();
  readonly search = this._search.asReadonly();
  readonly hasMore = computed(() => this._tickets().length < this._totalCount());
  readonly formOpen = this._formOpen.asReadonly();
  readonly submitting = this._submitting.asReadonly();
  readonly submitError = this._submitError.asReadonly();
  readonly reopeningId = this._reopeningId.asReadonly();
  readonly reopenError = this._reopenError.asReadonly();

  /** El ticket elegido, siempre leído de la lista viva (estado y no leídos al día). */
  readonly selectedTicket = computed(() => {
    const selected = this._selected();
    if (!selected) return null;
    return this._tickets().find(t => t.id === selected.id) ?? selected;
  });

  readonly activeCount = computed(() => this._tickets().filter(t => !isTicketFinished(t)).length);
  readonly closedCount = computed(() => this._tickets().filter(t => isTicketFinished(t)).length);
  /** No leídos por pestaña: así se ve en cuál está el mensaje aunque se esté mirando la otra. */
  readonly activeUnread = computed(() => this.unreadOf(this._tickets().filter(t => !isTicketFinished(t))));
  readonly closedUnread = computed(() => this.unreadOf(this._tickets().filter(t => isTicketFinished(t))));

  /** Filas de la pestaña: primero los que traen mensajes nuevos, luego por última actividad. */
  readonly visibleTickets = computed(() => {
    const term = this._search().trim().toLowerCase();
    const wantFinished = this._filter() === 'closed';
    return this._tickets()
      .filter(t => isTicketFinished(t) === wantFinished)
      .filter(t => !term || t.subject.toLowerCase().includes(term) || t.id.startsWith(term))
      .sort((a, b) => {
        const unread = Number((b.unreadCount ?? 0) > 0) - Number((a.unreadCount ?? 0) > 0);
        return unread !== 0 ? unread : ticketActivityAt(b).localeCompare(ticketActivityAt(a));
      });
  });

  /** Emite al crear un ticket: la página lo abre al lado. */
  readonly ticketCreated$ = new Subject<{ ticketId: string; conversationId: string }>();

  loadTickets(): void {
    this._loading.set(true);
    this._error.set(null);
    this.service.listMyTickets({ page: 1, size: PAGE_SIZE, includeClosed: true }).subscribe({
      next: result => {
        this._tickets.set([...result.items]);
        this._page.set(result.page);
        this._totalCount.set(result.totalCount);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  loadMore(): void {
    if (this._loadingMore() || !this.hasMore()) return;
    this._loadingMore.set(true);
    this.service.listMyTickets({ page: this._page() + 1, size: PAGE_SIZE, includeClosed: true }).subscribe({
      next: result => {
        const known = new Set(this._tickets().map(t => t.id));
        this._tickets.update(list => [...list, ...result.items.filter(t => !known.has(t.id))]);
        this._page.set(result.page);
        this._totalCount.set(result.totalCount);
        this._loadingMore.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loadingMore.set(false);
      },
    });
  }

  setFilter(filter: SupportInboxFilter): void {
    this._filter.set(filter);
  }

  setSearch(term: string): void {
    this._search.set(term);
  }

  /**
   * Abre el chat del ticket al lado y lo da por leído. Devuelve cuántos no leídos tenía, para que la burbuja del
   * menú baje lo mismo.
   */
  selectTicket(ticket: SupportTicket | null): number {
    this._selected.set(ticket);
    if (!ticket) return 0;
    this._filter.set(isTicketFinished(ticket) ? 'closed' : 'active');
    return this.markRead(ticket.id);
  }

  /** Deep link `?ticket=`: lo toma de la lista o lo pide al backend. */
  selectTicketById(ticketId: string, onRead?: (unread: number) => void): void {
    const loaded = this._tickets().find(t => t.id === ticketId);
    if (loaded) {
      onRead?.(this.selectTicket(loaded));
      return;
    }
    this.service.getTicket(ticketId).subscribe({
      next: ticket => onRead?.(this.selectTicket(ticket)),
      error: err => this._error.set(toApiError(err).message),
    });
  }

  /** Un mensaje nuevo de un ticket: actualiza su vista previa y, si no se está mirando, sus no leídos. */
  applyActivity(activity: SupportTicketActivity): void {
    const ticket = this._tickets().find(t => t.conversationId === activity.conversationId);
    if (!ticket) {
      // Ticket que esta pestaña aún no conoce (abierto desde otro lado): se recarga la lista.
      this.loadTickets();
      return;
    }
    const counts = !activity.fromMe && !activity.viewing && this._selected()?.id !== ticket.id;
    this._tickets.update(list =>
      list.map(t =>
        t.id !== ticket.id
          ? t
          : {
              ...t,
              unreadCount: (t.unreadCount ?? 0) + (counts ? 1 : 0),
              lastMessage: {
                fromMe: activity.fromMe,
                kind: activity.kind,
                preview: activity.body,
                isDeleted: activity.body === null && activity.kind === 'Text',
                createdAtUtc: activity.createdAtUtc,
              },
            },
      ),
    );
  }

  openForm(): void {
    this._submitError.set(null);
    this._formOpen.set(true);
  }

  closeForm(): void {
    if (!this._submitting()) this._formOpen.set(false);
  }

  /** La descripción viaja como primer mensaje del ticket. Al crear, se cierra el diálogo y se abre el ticket. */
  submitTicket(form: SupportTicketFormValue): void {
    if (this._submitting()) return;
    this._submitting.set(true);
    this._submitError.set(null);
    const description = form.description.trim();
    this.service
      .openTicket({
        subject: form.subject.trim(),
        category: form.category,
        ...(description ? { initialMessage: description } : {}),
      })
      .subscribe({
        next: result => {
          this._submitting.set(false);
          this._formOpen.set(false);
          this._filter.set('active');
          this.loadTickets();
          this.ticketCreated$.next({ ticketId: result.ticketId, conversationId: result.conversationId });
        },
        error: err => {
          this._submitError.set(toApiError(err).message);
          this._submitting.set(false);
        },
      });
  }

  /** Reabre un ticket Resolved/Closed; al terminar recarga la lista y lo deja en Active. */
  reopenTicket(ticketId: string): void {
    if (this._reopeningId()) return;
    this._reopeningId.set(ticketId);
    this._reopenError.set(null);
    this.service.reopenTicket(ticketId).subscribe({
      next: () => {
        this._reopeningId.set(null);
        this._filter.set('active');
        this.loadTickets();
      },
      error: err => {
        this._reopenError.set(toApiError(err).message);
        this._reopeningId.set(null);
      },
    });
  }

  private markRead(ticketId: string): number {
    const ticket = this._tickets().find(t => t.id === ticketId);
    const unread = ticket?.unreadCount ?? 0;
    if (unread > 0) this._tickets.update(list => list.map(t => (t.id === ticketId ? { ...t, unreadCount: 0 } : t)));
    return unread;
  }

  private unreadOf(tickets: SupportTicket[]): number {
    return tickets.reduce((sum, t) => sum + (t.unreadCount ?? 0), 0);
  }
}
