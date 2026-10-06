import { Injectable, computed, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { FetchGate } from '@core/data/fetch-gate';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ClientSignaturesService } from './client-signatures.service';
import { ClientSignatureItem, SignatureRequestSummaryResponse, toClientSignatureItem } from './client-signatures.model';

/** El backend acota `size` a 100; es el tope de un cliente en esta vista plana. */
const FETCH_SIZE = 100;

/**
 * Store de la pestaña "Signatures" del perfil (`GET /signature/requests?customerId=`).
 *
 * Mismo patrón que los demás stores del perfil: `providedIn: 'root'` con estado por cliente
 * (`load(id)` limpia si cambió el cliente), `FetchGate` para no repetir el listado en cada
 * ida y vuelta de tab, y `refresh()` como camino forzado tras cancelar.
 */
@Injectable({ providedIn: 'root' })
export class ClientSignaturesStore {
  private readonly service = inject(ClientSignaturesService);
  private readonly toast = inject(ToastService);

  private customerId = '';

  private readonly _raw = signal<SignatureRequestSummaryResponse[]>([]);
  private readonly _totalCount = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _busyIds = signal<ReadonlySet<string>>(new Set());

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly items = computed<ClientSignatureItem[]>(() => this._raw().map(toClientSignatureItem));
  readonly total = computed(() => this._raw().length);
  /** Total real del backend; si supera lo cargado, la vista lo declara. */
  readonly totalCount = this._totalCount.asReadonly();
  readonly maybeTruncated = computed(() => this._totalCount() > this._raw().length);
  readonly openCount = computed(() => this.items().filter(i => i.isCancelable).length);
  readonly completedCount = computed(() => this.items().filter(i => i.status === 'Completed').length);

  private readonly gate = new FetchGate();

  isBusy(id: string): boolean {
    return this._busyIds().has(id);
  }

  load(customerId: string): void {
    if (customerId !== this.customerId) {
      this.customerId = customerId;
      this._raw.set([]);
      this._totalCount.set(0);
    }
    if (this.gate.shouldFetch(customerId)) {
      this.doRefresh();
    }
  }

  /** Recarga forzada: botón de la vista y tras cancelar. Siempre va al backend. */
  refresh(): void {
    if (this.gate.shouldFetch(this.customerId, true)) {
      this.doRefresh();
    }
  }

  private doRefresh(): void {
    if (!this.customerId) {
      this.gate.settle(false);
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this.service.byCustomer(this.customerId, 1, FETCH_SIZE).subscribe({
      next: res => {
        this._raw.set(res.items);
        this._totalCount.set(res.totalCount);
        this._loading.set(false);
        this.gate.settle(true);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
        this.gate.settle(false);
      },
    });
  }

  // ---------- Cancelar ----------

  cancel(item: ClientSignatureItem): void {
    if (!item.isCancelable) {
      return;
    }
    this.markBusy(item.id, true);
    this.service.cancel(item.id).subscribe({
      next: () => {
        this._raw.update(list => list.map(r => (r.id === item.id ? { ...r, status: 'Canceled' as const } : r)));
        this.markBusy(item.id, false);
        this.toast.success(`"${item.title}" was canceled`);
        this.refresh();
      },
      error: err => {
        this.markBusy(item.id, false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  private markBusy(id: string, busy: boolean): void {
    this._busyIds.update(current => {
      const next = new Set(current);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }
}
