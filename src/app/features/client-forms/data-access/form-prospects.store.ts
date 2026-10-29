import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { firstValueFrom, type Observable } from 'rxjs';
import type { FormProspect, FormProspectFilters, FormProspectStatus } from './client-forms.model';
import { FormProspectsService } from './form-prospects.service';
import { FormRequestsService } from './form-requests.service';

export const PROSPECTS_PAGE_SIZE = 25;

// Códigos conocidos traducidos a copy; lo demás usa el mensaje del backend.
const PROSPECT_ERROR_MESSAGES: Record<string, string> = {
  'FormParticipant.AlreadyConverted': 'This prospect is already a client. The list was refreshed.',
};

function prospectErrorMessage(error: unknown): string {
  const apiError = toApiError(error);
  return PROSPECT_ERROR_MESSAGES[apiError.code] ?? apiError.message;
}

/** Lista paginada de prospects y sus acciones de fila (lost/reopen/crear cliente). */
@Injectable()
export class FormProspectsStore {
  private readonly service = inject(FormProspectsService);
  private readonly requests = inject(FormRequestsService);
  // Descarta respuestas de cargas anteriores (búsqueda mientras se escribe).
  private loadSeq = 0;

  private readonly _items = signal<FormProspect[]>([]);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _filters = signal<FormProspectFilters>({
    status: null,
    search: null,
    page: 1,
    size: PROSPECTS_PAGE_SIZE,
  });
  private readonly _busyId = signal<string | null>(null);
  private readonly _actionError = signal<string | null>(null);

  readonly items = this._items.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** Ya hubo una respuesta: las recargas atenúan la tabla en vez de mostrar el skeleton. */
  readonly loaded = this._loaded.asReadonly();
  readonly error = this._error.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly busyId = this._busyId.asReadonly();
  readonly actionError = this._actionError.asReadonly();

  async load(patch: Partial<FormProspectFilters> = {}): Promise<void> {
    const next = { ...this._filters(), ...patch };
    this._filters.set(next);
    const seq = ++this.loadSeq;
    this._loading.set(true);
    this._error.set(null);
    try {
      const page = await firstValueFrom(this.service.list(next));
      if (seq !== this.loadSeq) return;
      this._items.set(page.items ?? []);
      this._total.set(page.totalCount ?? 0);
      this._loaded.set(true);
    } catch (error) {
      if (seq !== this.loadSeq) return;
      this._error.set(toApiError(error).message);
    } finally {
      if (seq === this.loadSeq) this._loading.set(false);
    }
  }

  setStatus(status: FormProspectStatus | null): Promise<void> {
    return this.load({ status, page: 1 });
  }

  setSearch(search: string): Promise<void> {
    return this.load({ search: search.trim() || null, page: 1 });
  }

  goToPage(page: number): Promise<void> {
    return this.load({ page });
  }

  markLost(participantId: string, reason: string | null): Promise<boolean> {
    const trimmed = reason?.trim() || null;
    return this.mutate(participantId, () => this.service.markLost(participantId, trimmed));
  }

  reopen(participantId: string): Promise<boolean> {
    return this.mutate(participantId, () => this.service.reopen(participantId));
  }

  /** Arranque manual del alta sobre la request que indica el servidor (mismo endpoint que el drawer). */
  async createClient(prospect: FormProspect): Promise<boolean> {
    const requestId = prospect.createClientRequestId;
    if (!requestId || this._busyId()) return false;
    this._busyId.set(prospect.participantId);
    this._actionError.set(null);
    try {
      await firstValueFrom(this.requests.startCustomerCreation(requestId));
      void this.load();
      return true;
    } catch (error) {
      this._actionError.set(prospectErrorMessage(error));
      return false;
    } finally {
      this._busyId.set(null);
    }
  }

  dismissActionError(): void {
    this._actionError.set(null);
  }

  private async mutate(
    participantId: string,
    request: () => Observable<FormProspect>,
  ): Promise<boolean> {
    if (this._busyId()) return false;
    this._busyId.set(participantId);
    this._actionError.set(null);
    try {
      const updated = await firstValueFrom(request());
      const status = this._filters().status;
      // Con un filtro de estado que ya no casa, la fila sale de la página: se recarga.
      if (status && updated.status !== status) await this.load();
      else
        this._items.update((items) =>
          items.map((item) => (item.participantId === participantId ? updated : item)),
        );
      return true;
    } catch (error) {
      this._actionError.set(prospectErrorMessage(error));
      if (error instanceof HttpErrorResponse && error.status === 409) await this.load();
      return false;
    } finally {
      this._busyId.set(null);
    }
  }
}
