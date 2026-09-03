import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ClientItem, ClientTableComponent } from '../../ui/client-table/client-table.component';
import { ClientFormPanelComponent } from '../../ui/client-form-panel/client-form-panel.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { toApiError } from '@core/models/api-error.model';
import { ClientsStore, LIST_PAGE_SIZES } from '../../data-access/clients.store';
import { ClientPermissions } from '../../data-access/client-permissions';
import {
  BulkStatusFailure,
  CustomerStatusAction,
  CustomerStatusFilter,
  summaryToClientItem,
} from '../../data-access/clients.model';

interface StatusOption {
  value: CustomerStatusFilter;
  label: string;
}

const SEARCH_DEBOUNCE_MS = 300;
const VALID_STATUSES: CustomerStatusFilter[] = ['Active', 'Inactive', 'Archived', 'NotArchived', 'All'];

/**
 * Directorio de clientes con paginación server-side real (GET /customers?term&status&page&size).
 * El estado navegable (term/status/page/size) vive en los query params → refrescar o volver
 * atrás conserva la vista. Selección múltiple + acciones de estado masivas con fallos parciales.
 */
@Component({
  selector: 'app-client-directory-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ClientTableComponent,
    ClientFormPanelComponent,
    PaginationComponent,
    ConfirmDialogComponent,
    ModalComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-directory-page.component.html',
  styleUrl: './client-directory-page.component.css',
})
export class ClientDirectoryPageComponent {
  private readonly store = inject(ClientsStore);
  private readonly caps = inject(ClientPermissions);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // Estado del listado (server-side).
  readonly rows = computed<ClientItem[]>(() => this.store.items().map(summaryToClientItem));
  readonly loading = this.store.listLoading;
  readonly loadError = this.store.listError;
  readonly loadErrorKind = this.store.listErrorKind;
  readonly page = this.store.page;
  readonly size = this.store.size;
  readonly totalCount = this.store.totalCount;
  readonly status = this.store.status;
  readonly counts = this.store.counts;

  readonly pageSizes = LIST_PAGE_SIZES;
  readonly statusOptions: StatusOption[] = [
    { value: 'Active', label: 'Active' },
    { value: 'NotArchived', label: 'Active + Inactive' },
    { value: 'Inactive', label: 'Inactive' },
    { value: 'Archived', label: 'Archived' },
    { value: 'All', label: 'All statuses' },
  ];

  // Permisos.
  readonly canManage = this.caps.canManage;
  readonly canChangeStatus = this.caps.canChangeStatus;
  readonly canImport = this.caps.canImport;

  // Búsqueda (input local + debounce hacia el server).
  readonly searchInput = signal('');
  private searchDebounce: ReturnType<typeof setTimeout> | undefined;

  // Selección.
  readonly selected = signal<ReadonlySet<string>>(new Set<string>());
  readonly selectedCount = computed(() => this.selected().size);

  // Overlays.
  readonly isPanelOpen = signal(false);
  readonly editingClient = signal<ClientItem | null>(null);
  readonly pendingDelete = signal<ClientItem | null>(null);
  readonly bulkFailures = signal<BulkStatusFailure[] | null>(null);
  private bulkSucceeded = 0;

  readonly showingLabel = computed(() => {
    const total = this.totalCount();
    if (total === 0) return '0 clients';
    const from = (this.page() - 1) * this.size() + 1;
    const to = Math.min(this.page() * this.size(), total);
    return `${total.toLocaleString()} ${total === 1 ? 'client' : 'clients'} · showing ${from}–${to}`;
  });

  readonly deleteMessage = computed(() => {
    const client = this.pendingDelete();
    return client
      ? `Archived clients stay in the system but are removed from your active client views. You can reactivate ${client.displayName} later.`
      : '';
  });

  readonly bulkResultMessage = computed(() => {
    const failures = this.bulkFailures();
    if (!failures) return '';
    return `${this.bulkSucceeded} updated · ${failures.length} couldn’t be updated`;
  });

  /** Nombre legible para un fallo de bulk (el backend solo devuelve el id); cae al id corto si no está en la página. */
  failureName(customerId: string): string {
    const row = this.rows().find(r => r.id === customerId);
    return row ? row.displayName : `Client ${customerId.slice(0, 8)}`;
  }

  constructor() {
    // Estado inicial desde la URL (refresh / volver atrás lo conserva).
    const map = this.route.snapshot.queryParamMap;
    const term = map.get('term') ?? '';
    const statusParam = map.get('status');
    const status = statusParam && VALID_STATUSES.includes(statusParam as CustomerStatusFilter)
      ? (statusParam as CustomerStatusFilter)
      : undefined;
    const page = this.parsePositiveInt(map.get('page'));
    const sizeParam = this.parsePositiveInt(map.get('size'));
    const size = sizeParam && (LIST_PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : undefined;

    this.searchInput.set(term);
    this.store.initList({ term, status, page, size });
  }

  private parsePositiveInt(raw: string | null): number | undefined {
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }

  /** Escribe el estado del listado en la URL (reemplazando, sin apilar historial). */
  private syncUrl(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        term: this.store.term().trim() || null,
        status: this.store.status() === 'NotArchived' ? null : this.store.status(),
        page: this.store.page() > 1 ? this.store.page() : null,
        size: this.store.size() !== 25 ? this.store.size() : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  onSearchChange(value: string): void {
    this.searchInput.set(value);
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.clearSelection();
      this.store.setTerm(value);
      this.syncUrl();
    }, SEARCH_DEBOUNCE_MS);
  }

  /** Reintenta la carga del listado (botón del estado de error). */
  retryLoad(): void {
    this.store.reloadList();
  }

  setStatus(status: CustomerStatusFilter): void {
    this.clearSelection();
    this.store.setStatus(status);
    this.syncUrl();
  }

  setSize(size: number): void {
    this.store.setSize(size);
    this.syncUrl();
  }

  goToPage(page: number): void {
    this.store.goToPage(page);
    this.syncUrl();
  }

  // ---------- Selección ----------

  toggleSelect(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selected.set(next);
  }

  toggleSelectAll(): void {
    const rows = this.rows();
    const allSelected = rows.length > 0 && rows.every(r => this.selected().has(r.id));
    const next = new Set(this.selected());
    if (allSelected) {
      rows.forEach(r => next.delete(r.id));
    } else {
      rows.forEach(r => next.add(r.id));
    }
    this.selected.set(next);
  }

  clearSelection(): void {
    if (this.selected().size > 0) {
      this.selected.set(new Set<string>());
    }
  }

  // ---------- Acciones masivas ----------

  bulkAction(action: CustomerStatusAction): void {
    const ids = [...this.selected()];
    if (ids.length === 0) return;
    this.store.bulkStatus(action, ids).subscribe({
      next: result => {
        this.clearSelection();
        if (result.failed > 0) {
          this.bulkSucceeded = result.succeeded;
          this.bulkFailures.set(result.failures);
          this.toast.info(`${result.succeeded} updated, ${result.failed} couldn’t be updated`);
        } else {
          this.toast.success(`${result.succeeded} ${result.succeeded === 1 ? 'client' : 'clients'} updated`);
        }
      },
      error: err => this.toast.error(toApiError(err).message),
    });
  }

  // ---------- Panel crear/editar ----------

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

  handleSaved(): void {
    const wasEditing = this.editingClient() !== null;
    this.closePanel();
    this.toast.success(wasEditing ? 'Client updated' : 'Client created');
  }

  // ---------- Acciones de fila ----------

  toggleActive(client: ClientItem): void {
    this.store.changeStatus(client.id, client.isActive ? 'deactivate' : 'activate').subscribe({
      next: () => this.toast.success(client.isActive ? 'Client deactivated' : 'Client activated'),
      error: err => this.toast.error(toApiError(err).message),
    });
  }

  deleteClient(client: ClientItem): void {
    this.pendingDelete.set(client);
  }

  confirmDelete(): void {
    const client = this.pendingDelete();
    this.pendingDelete.set(null);
    if (!client) return;
    this.store.changeStatus(client.id, 'archive').subscribe({
      next: () => this.toast.success(`${client.displayName} archived`),
      error: err => this.toast.error(toApiError(err).message),
    });
  }
}
