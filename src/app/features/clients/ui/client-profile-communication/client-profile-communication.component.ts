import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClientCommunicationStore } from '../../data-access/client-communication.store';
import {
  CLIENT_THREAD_STATUS_FILTERS,
  ClientEmailThreadRow,
  ClientThreadStatusFilter,
} from '../../data-access/client-communication.model';

/**
 * Pestaña "Communication" del perfil de cliente, cableada contra Correspondence.Api
 * (`GET /correspondence/customers/{customerId}/threads`).
 *
 * El vínculo con el cliente es REAL: el inbox de Correspondence es customer-céntrico,
 * los hilos cuelgan del `customerId` de la ruta. No hay ninguna simulación de filtro.
 *
 * Diferencias con el mock que reemplaza, todas por límites del contrato:
 *  - El mock mezclaba EMAIL + LLAMADAS + SMS en un timeline único. Solo el email tiene
 *    backend: no hay servicio de telefonía/CDR, y Notification.Api envía SMS pero no
 *    guarda historial por customer. Las píldoras de canal (All/Calls/SMS/Emails) se
 *    reemplazan por el filtro de estado REAL del hilo (Active/Archived) y la pantalla
 *    declara el alcance.
 *  - El backend devuelve HILOS, no eventos sueltos: cada fila es una conversación con
 *    su asunto, su nº de mensajes y sus instantes de primer/último mensaje. Abrir el
 *    hilo y leer los mensajes vive en la feature Mail, no acá.
 */
@Component({
  selector: 'app-client-profile-communication',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-communication.component.html',
})
export class ClientProfileCommunicationComponent implements OnChanges {
  @Input() clientId = '';

  readonly store = inject(ClientCommunicationStore);

  readonly statusFilters = CLIENT_THREAD_STATUS_FILTERS;
  readonly statusFilter = signal<ClientThreadStatusFilter>('all');

  /** Filtro en memoria: el endpoint solo acepta `page`/`size`, no filtra por estado. */
  readonly visibleThreads = computed<ClientEmailThreadRow[]>(() => {
    const status = this.statusFilter();
    return this.store.threads().filter(thread => status === 'all' || thread.status === status);
  });

  ngOnChanges(): void {
    if (this.clientId) {
      this.store.load(this.clientId);
    }
  }

  setStatusFilter(status: ClientThreadStatusFilter): void {
    this.statusFilter.set(status);
  }

  retry(): void {
    this.store.refresh();
  }
}
