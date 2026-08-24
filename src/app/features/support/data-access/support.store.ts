import { Injectable, computed, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { SupportService } from './support.service';
import { SupportTicket, SupportTicketFormValue } from './support.model';

/** Tamaño de página de "My tickets" (el backend acepta 1..100). */
const PAGE_SIZE = 5;

/**
 * Store del módulo Support: lista paginada de tickets del usuario actual +
 * estado del formulario de apertura + reopen. Reemplaza al ticket falso de
 * `Math.random()`: el chip de confirmación muestra el `ticketId` real que
 * devuelve POST /communication/support.
 */
@Injectable({ providedIn: 'root' })
export class SupportStore {
  private readonly service = inject(SupportService);

  // --- Lista "My tickets" ---
  private readonly _tickets = signal<SupportTicket[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _page = signal(1);
  private readonly _totalCount = signal(0);

  // --- Envío del formulario ---
  private readonly _submitting = signal(false);
  private readonly _submitError = signal<string | null>(null);
  private readonly _lastTicketId = signal<string | null>(null);

  // --- Reopen ---
  private readonly _reopeningId = signal<string | null>(null);
  private readonly _reopenError = signal<string | null>(null);

  readonly tickets = this._tickets.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly page = this._page.asReadonly();
  readonly totalCount = this._totalCount.asReadonly();
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this._totalCount() / PAGE_SIZE)));

  readonly submitting = this._submitting.asReadonly();
  readonly submitError = this._submitError.asReadonly();
  /** Id real del último ticket creado (para el chip "Ticket #... created"). */
  readonly lastTicketId = this._lastTicketId.asReadonly();

  readonly reopeningId = this._reopeningId.asReadonly();
  readonly reopenError = this._reopenError.asReadonly();

  /** Carga (o recarga) una página de la lista. Sin argumento: la página actual. */
  loadTickets(page: number = this._page()): void {
    const target = Math.max(1, page);
    this._loading.set(true);
    this._error.set(null);
    this.service.listMyTickets({ page: target, size: PAGE_SIZE, includeClosed: true }).subscribe({
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

  /**
   * Abre un ticket con lo que emite el formulario. La descripción viaja como
   * `initialMessage` (primer mensaje de la conversación del ticket). Al crear,
   * recarga la página 1 para que el ticket nuevo aparezca arriba.
   */
  submitTicket(form: SupportTicketFormValue): void {
    if (this._submitting()) {
      return;
    }
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
          this._lastTicketId.set(result.ticketId);
          this._submitting.set(false);
          this.loadTickets(1);
        },
        error: err => {
          this._submitError.set(toApiError(err).message);
          this._submitting.set(false);
        },
      });
  }

  /** Oculta el chip de confirmación del formulario. */
  dismissConfirmation(): void {
    this._lastTicketId.set(null);
  }

  /**
   * Reabre un ticket Resolved/Closed (el backend autoriza al opener, y esta
   * lista solo trae tickets abiertos por el usuario actual). Al terminar
   * recarga la página actual para reflejar el estado nuevo (Open/Claimed).
   */
  reopenTicket(ticketId: string): void {
    if (this._reopeningId()) {
      return;
    }
    this._reopeningId.set(ticketId);
    this._reopenError.set(null);
    this.service.reopenTicket(ticketId).subscribe({
      next: () => {
        this._reopeningId.set(null);
        this.loadTickets();
      },
      error: err => {
        this._reopenError.set(toApiError(err).message);
        this._reopeningId.set(null);
      },
    });
  }
}
