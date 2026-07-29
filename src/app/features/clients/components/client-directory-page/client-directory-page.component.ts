import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClientItem, ClientTableComponent, ClientType } from '../../ui/client-table/client-table.component';
import { ClientFormPanelComponent } from '../../ui/client-form-panel/client-form-panel.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { ClientsStore } from '../../data-access/clients.store';

type TypeFilter = 'all' | ClientType;
type StatusFilter = 'all' | 'active' | 'inactive';
const PAGE_SIZE = 8;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Página del directorio de clientes (estilo "Aether", mismo patrón que
 * invoices-page): stats pastel + filtros de tipo/estado + búsqueda + tabla
 * de clientes + panel de creación/edición. La lista viene de ClientsStore
 * (GET /customers, Customer.Api vía Gateway) — el backend no filtra por tipo
 * ni trae address/ssn/ein en el listado, así que type/status/paginación
 * siguen resolviéndose acá sobre el lote ya cargado (ver ClientsStore).
 */
@Component({
  selector: 'app-client-directory-page',
  imports: [
    CommonModule,
    FormsModule,
    ClientTableComponent,
    ClientFormPanelComponent,
    PaginationComponent,
    ConfirmDialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-directory-page.component.html',
})
export class ClientDirectoryPageComponent {
  private readonly store = inject(ClientsStore);

  readonly clients = this.store.clients;
  readonly loading = this.store.loading;
  readonly loadError = this.store.error;

  readonly typeFilter = signal<TypeFilter>('all');
  readonly statusFilter = signal<StatusFilter>('all');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingClient = signal<ClientItem | null>(null);
  readonly pendingDelete = signal<ClientItem | null>(null);

  private searchDebounce: ReturnType<typeof setTimeout> | undefined;

  readonly deleteMessage = computed(() => {
    const client = this.pendingDelete();
    return client ? `You're about to archive client ${client.displayName}. You can restore it later from the backend.` : '';
  });

  readonly totalClients = computed(() => this.clients().length);
  readonly activeClients = computed(() => this.clients().filter(client => client.isActive).length);
  readonly individualClients = computed(() => this.clients().filter(client => client.type === 'individual').length);
  readonly companyClients = computed(() => this.clients().filter(client => client.type === 'company').length);

  readonly visibleClients = computed<ClientItem[]>(() => {
    const query = this.search().trim().toLowerCase();
    const type = this.typeFilter();
    const status = this.statusFilter();
    return this.clients()
      .filter(client => type === 'all' || client.type === type)
      .filter(
        client => status === 'all' || (status === 'active' ? client.isActive : !client.isActive),
      )
      .filter(
        client =>
          !query ||
          client.displayName.toLowerCase().includes(query) ||
          client.email.toLowerCase().includes(query),
      );
  });

  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly pagedClients = computed<ClientItem[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleClients().slice(start, start + PAGE_SIZE);
  });

  constructor() {
    this.store.refresh();
  }

  setTypeFilter(filter: TypeFilter): void {
    this.typeFilter.set(filter);
    this.currentPage.set(1);
  }

  setStatusFilter(filter: StatusFilter): void {
    this.statusFilter.set(filter);
    this.currentPage.set(1);
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    this.currentPage.set(1);
    // Filtra de una sobre el lote ya cargado (arriba) y, con debounce, vuelve a pedirle
    // al backend por si hay coincidencias fuera de ese lote (ver FETCH_SIZE en el store).
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.store.setSearch(value), SEARCH_DEBOUNCE_MS);
  }

  openCreatePanel(): void {
    this.editingClient.set(null);
    this.isPanelOpen.set(true);
  }

  openEditPanel(client: ClientItem): void {
    this.editingClient.set(client);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
    this.editingClient.set(null);
  }

  /** El form panel ya hizo el POST/PATCH real y actualizó el store — acá solo cerramos. */
  handleSaved(): void {
    this.closePanel();
  }

  toggleActive(client: ClientItem): void {
    this.store.changeStatus(client.id, client.isActive ? 'deactivate' : 'activate').subscribe({
      error: err => console.warn('No se pudo cambiar el estado del cliente:', err),
    });
  }

  deleteClient(client: ClientItem): void {
    this.pendingDelete.set(client);
  }

  confirmDelete(): void {
    const client = this.pendingDelete();
    if (!client) {
      return;
    }
    this.store.changeStatus(client.id, 'archive').subscribe({
      error: err => console.warn('No se pudo archivar el cliente:', err),
    });
    this.pendingDelete.set(null);
  }
}
