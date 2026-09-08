import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { ClientRequestsService } from './client-requests.service';
import {
  ClientRequestItem,
  ClientRequestResolution,
  ClientRequestResponse,
  toClientRequestItem,
} from './client-requests.model';

/**
 * Store de la sección "Requests from client" del perfil (Tasks.Api vía
 * `/tasks/client-requests?customerId=`). `providedIn: 'root'` con estado por cliente: `load(id)`
 * limpia el estado si el cliente cambió y pide datos frescos. Mismo reparto de errores que Work/Notes.
 */
@Injectable({ providedIn: 'root' })
export class ClientRequestsStore {
  private readonly service = inject(ClientRequestsService);

  private customerId = '';

  private readonly _raw = signal<ClientRequestResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _actionError = signal<string | null>(null);
  private readonly _busyIds = signal<ReadonlySet<string>>(new Set());

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly actionError = this._actionError.asReadonly();

  readonly requests = computed<ClientRequestItem[]>(() => this._raw().map(toClientRequestItem));
  readonly total = computed(() => this._raw().length);
  readonly openCount = computed(
    () => this._raw().filter(r => r.status === 'Pending' || r.status === 'Submitted').length,
  );
  /** Cuántas esperan revisión del preparador (el cliente ya envió). */
  readonly needsReviewCount = computed(() => this._raw().filter(r => r.status === 'Submitted').length);

  isBusy(id: string): boolean {
    return this._busyIds().has(id);
  }

  clearActionError(): void {
    this._actionError.set(null);
  }

  load(customerId: string): void {
    if (customerId !== this.customerId) {
      this.customerId = customerId;
      this._raw.set([]);
      this._actionError.set(null);
    }
    this.refresh();
  }

  refresh(): void {
    if (!this.customerId) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this.service.byCustomer(this.customerId).subscribe({
      next: items => {
        this._raw.set(items);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  /** POST /tasks/client-requests — el componente muestra el error junto al editor. */
  create(title: string, details: string, dueDate: string, taskId: string | null): Observable<void> {
    return this.service
      .create({
        customerId: this.customerId,
        taskId,
        title: title.trim(),
        details: details.trim() || null,
        dueAtUtc: dueDate ? `${dueDate}T00:00:00Z` : null,
      })
      .pipe(
        tap(created => this._raw.update(list => [created, ...list])),
        map(() => undefined),
      );
  }

  /** POST /tasks/client-requests/{id}/resolve (Accept/Reject/Cancel). Reject exige note. */
  resolve(id: string, resolution: ClientRequestResolution, note: string | null): void {
    this.markBusy(id, true);
    this.service.resolve(id, { resolution, note: note?.trim() || null }).subscribe({
      next: updated => {
        this.replace(updated);
        this.markBusy(id, false);
      },
      error: err => {
        this._actionError.set(toApiError(err).message);
        this.markBusy(id, false);
      },
    });
  }

  private replace(updated: ClientRequestResponse): void {
    this._raw.update(list => list.map(r => (r.id === updated.id ? updated : r)));
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
