import { Injectable, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { EmailActivityDetail, EmailActivityFilter, EmailActivityItem } from '@core/postmaster/email-activity.model';
import { EmailActivityService } from '@core/postmaster/email-activity.service';

export const EMAIL_ACTIVITY_PAGE_SIZE = 25;

/**
 * Estado de "Email activity". Se provee en la ruta: vive mientras la pantalla está abierta.
 * Cada carga lleva un número de pedido; una respuesta vieja (el usuario cambió el filtro en el
 * medio) se descarta para no pisar la nueva.
 */
@Injectable()
export class EmailActivityStore {
  private readonly service = inject(EmailActivityService);

  private readonly _items = signal<EmailActivityItem[]>([]);
  private readonly _total = signal(0);
  private readonly _page = signal(1);
  private readonly _status = signal<EmailActivityFilter>('All');
  private readonly _recipient = signal('');
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  private readonly _detail = signal<EmailActivityDetail | null>(null);
  private readonly _detailOpen = signal(false);
  private readonly _detailLoading = signal(false);
  private readonly _detailError = signal<string | null>(null);

  private listRequest = 0;
  private detailRequest = 0;

  readonly items = this._items.asReadonly();
  readonly total = this._total.asReadonly();
  readonly page = this._page.asReadonly();
  readonly status = this._status.asReadonly();
  readonly recipient = this._recipient.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly detail = this._detail.asReadonly();
  readonly detailOpen = this._detailOpen.asReadonly();
  readonly detailLoading = this._detailLoading.asReadonly();
  readonly detailError = this._detailError.asReadonly();

  /** Entrada desde otra pantalla (ej. el perfil del cliente) ya filtrada por destinatario. */
  start(recipient: string | null): void {
    this._recipient.set(recipient?.trim() ?? '');
    this._page.set(1);
    this.load();
  }

  load(): void {
    const request = ++this.listRequest;
    this._loading.set(true);
    this._error.set(null);
    this.service
      .list({
        status: this._status(),
        recipient: this._recipient(),
        page: this._page(),
        size: EMAIL_ACTIVITY_PAGE_SIZE,
      })
      .subscribe({
        next: result => {
          if (request !== this.listRequest) {
            return;
          }
          this._items.set(result.items);
          this._total.set(result.totalCount);
          this._loading.set(false);
        },
        error: err => {
          if (request !== this.listRequest) {
            return;
          }
          this._error.set(toApiError(err).message);
          this._loading.set(false);
        },
      });
  }

  setStatus(status: EmailActivityFilter): void {
    if (status === this._status()) {
      return;
    }
    this._status.set(status);
    this._page.set(1);
    this.load();
  }

  setRecipient(recipient: string): void {
    if (recipient === this._recipient()) {
      return;
    }
    this._recipient.set(recipient);
    this._page.set(1);
    this.load();
  }

  setPage(page: number): void {
    this._page.set(page);
    this.load();
  }

  open(id: string): void {
    const request = ++this.detailRequest;
    this._detailOpen.set(true);
    this._detail.set(null);
    this._detailError.set(null);
    this._detailLoading.set(true);
    this.service.get(id).subscribe({
      next: detail => {
        if (request !== this.detailRequest) {
          return;
        }
        this._detail.set(detail);
        this._detailLoading.set(false);
      },
      error: err => {
        if (request !== this.detailRequest) {
          return;
        }
        this._detailError.set(toApiError(err).message);
        this._detailLoading.set(false);
      },
    });
  }

  close(): void {
    this.detailRequest++;
    this._detailOpen.set(false);
  }
}
