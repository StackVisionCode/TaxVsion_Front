import { Injectable, computed, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { ClientCommunicationService } from './client-communication.service';
import {
  ClientEmailThreadRow,
  ClientThreadSummary,
  toClientEmailThreadRow,
} from './client-communication.model';

/**
 * Store de la pestaña "Communication" del perfil de cliente (Correspondence.Api).
 *
 * `providedIn: 'root'` con estado por cliente, igual que `ClientNotesStore`: la pestaña
 * se destruye y se recrea al cambiar de tab (`*ngSwitchCase`), así que `load(clientId)`
 * limpia el estado cuando el cliente cambia y siempre pide datos frescos.
 *
 * Solo lectura: el backend expone `POST /correspondence/threads/{id}/archive` y todo el
 * flujo de drafts, pero eso ya vive en la feature Mail; acá la pestaña es un historial.
 */
@Injectable({ providedIn: 'root' })
export class ClientCommunicationStore {
  private readonly service = inject(ClientCommunicationService);

  private clientId = '';

  private readonly _raw = signal<ClientThreadSummary[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Más reciente primero: el backend no garantiza orden por `lastMessageAtUtc`. */
  readonly threads = computed<ClientEmailThreadRow[]>(() =>
    this._raw()
      .map(toClientEmailThreadRow)
      .sort((a, b) => b.lastMessageTime - a.lastMessageTime),
  );

  readonly total = computed(() => this._raw().length);

  load(clientId: string): void {
    if (clientId !== this.clientId) {
      this.clientId = clientId;
      this._raw.set([]);
    }
    this.refresh();
  }

  refresh(): void {
    if (!this.clientId) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this.service.listThreads(this.clientId).subscribe({
      next: result => {
        this._raw.set(result.items);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }
}
