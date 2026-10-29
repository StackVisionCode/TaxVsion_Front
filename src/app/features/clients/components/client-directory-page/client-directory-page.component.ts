import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ClientItem, ClientTableComponent } from '../../ui/client-table/client-table.component';
import { ClientFormPanelComponent } from '../../ui/client-form-panel/client-form-panel.component';
import { AssignDialogClient, ClientAssignDialogComponent } from '../../ui/client-assign-dialog/client-assign-dialog.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { toApiError } from '@core/models/api-error.model';
import { consumeQueryFlag } from '@shared/utils/query-flag.util';
import { ClientsStore, DEFAULT_CLIENT_SORT, LIST_PAGE_SIZES } from '../../data-access/clients.store';
import { ClientPermissions } from '../../data-access/client-permissions';
import {
  BulkStatusFailure,
  CustomerKindFilter,
  CustomerListSort,
  CustomerSortField,
  CustomerStatusAction,
  CustomerStatusFilter,
  summaryToClientItem,
} from '../../data-access/clients.model';

const SEARCH_DEBOUNCE_MS = 300;
const VALID_STATUSES: CustomerStatusFilter[] = ['Active', 'Inactive', 'Archived', 'NotArchived', 'All'];

/** Valor de `?kind=` en la URL ↔ filtro de tipo. Sin parámetro = todos. */
const KIND_PARAMS: Record<string, CustomerKindFilter> = { individual: 'Individual', business: 'Business' };

interface SortOption extends CustomerListSort {
  /** Valor de `?sort=` en la URL (el orden por defecto no se escribe). */
  param: string;
  label: string;
}

/** Los cuatro órdenes que ofrece el menú "Sort"; el primero es el de siempre. */
const SORT_OPTIONS: readonly SortOption[] = [
  { field: 'Name', dir: 'Asc', param: 'name', label: 'Name A–Z' },
  { field: 'Name', dir: 'Desc', param: 'name-desc', label: 'Name Z–A' },
  { field: 'Created', dir: 'Desc', param: 'newest', label: 'Newest first' },
  { field: 'Created', dir: 'Asc', param: 'oldest', label: 'Oldest first' },
];

const TERM_STATE_KEY = 'clientsTerm';

/**
 * Directorio de clientes con paginación server-side real (GET /customers, o POST /customers/search con término).
 * El estado navegable (status/kind/sort/page/size) vive en los query params y el término en
 * `history.state` (puede ser un email: no debe quedar en la URL ni en logs) → refrescar o volver
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
    ClientAssignDialogComponent,
    SearchInputComponent,
    FilterChipsComponent,
    DropdownMenuComponent,
    MenuItemDirective,
    StateBlockComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-directory-page.component.html',
  // El host llena el alto del shell para que la tarjeta quede alineada con el sidebar (como Documents).
  host: { class: 'flex flex-1 flex-col' },
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
  readonly kind = this.store.kind;
  readonly sort = this.store.sort;

  readonly pageSizes = LIST_PAGE_SIZES;
  readonly statusOptions: FilterChipOption<CustomerStatusFilter>[] = [
    { id: 'Active', label: 'Active' },
    { id: 'NotArchived', label: 'Active + Inactive' },
    { id: 'Inactive', label: 'Inactive' },
    { id: 'Archived', label: 'Archived' },
    { id: 'All', label: 'All statuses' },
  ];

  // Tipo: una píldora con menú (como el resto de filtros que no caben en chips).
  readonly kindOptions: FilterChipOption<CustomerKindFilter>[] = [
    { id: 'All', label: 'All types' },
    { id: 'Individual', label: 'Individuals' },
    { id: 'Business', label: 'Businesses' },
  ];

  readonly sortOptions = SORT_OPTIONS;
  readonly sortLabel = computed(() => this.sortOptionFor(this.sort())?.label ?? SORT_OPTIONS[0].label);
  /** Orden distinto del de siempre: la píldora se pinta activa, igual que un filtro aplicado. */
  readonly isCustomSort = computed(
    () => this.sort().field !== DEFAULT_CLIENT_SORT.field || this.sort().dir !== DEFAULT_CLIENT_SORT.dir,
  );
  /** Hay algo que limpiar además del buscador (para ofrecer "Clear filters" en el vacío). */
  readonly hasFilters = computed(
    () => this.kind() !== 'All' || this.status() !== 'NotArchived' || this.store.term().trim() !== '',
  );

  // Permisos.
  readonly canManage = this.caps.canManage;
  readonly canChangeStatus = this.caps.canChangeStatus;
  readonly canImport = this.caps.canImport;
  readonly canAssignPreparer = this.caps.canAssignPreparer;
  readonly canViewAssignees = this.caps.canViewAssignees;

  // Búsqueda (el debounce hacia el server lo hace `app-search-input`).
  readonly searchInput = signal('');
  readonly searchDebounceMs = SEARCH_DEBOUNCE_MS;

  // Selección.
  readonly selected = signal<ReadonlySet<string>>(new Set<string>());
  readonly selectedCount = computed(() => this.selected().size);

  // Overlays.
  readonly isPanelOpen = signal(false);
  readonly editingClient = signal<ClientItem | null>(null);
  readonly pendingDelete = signal<ClientItem | null>(null);
  readonly bulkFailures = signal<BulkStatusFailure[] | null>(null);
  private bulkSucceeded = 0;

  // Diálogo de asignación (single = un cliente; bulk = varios seleccionados).
  readonly assignOpen = signal(false);
  readonly assignMode = signal<'single' | 'bulk'>('single');
  readonly assignClient = signal<AssignDialogClient | null>(null);
  readonly assignCustomerIds = signal<string[]>([]);

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
    // `?term=` solo llega de enlaces viejos; syncUrl lo quita de la barra.
    const term = this.termFromHistory() ?? map.get('term') ?? '';
    const statusParam = map.get('status');
    const status = statusParam && VALID_STATUSES.includes(statusParam as CustomerStatusFilter)
      ? (statusParam as CustomerStatusFilter)
      : undefined;
    const kind = KIND_PARAMS[map.get('kind') ?? ''];
    const sort = SORT_OPTIONS.find(o => o.param === map.get('sort'));
    const page = this.parsePositiveInt(map.get('page'));
    const sizeParam = this.parsePositiveInt(map.get('size'));
    const size = sizeParam && (LIST_PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : undefined;

    this.searchInput.set(term);
    this.store.initList({ term, status, kind, sort: sort && { field: sort.field, dir: sort.dir }, page, size });

    // `?new=1` (acceso rápido del dashboard): abre el alta directamente.
    if (consumeQueryFlag(this.route, this.router, 'new') && this.canManage()) {
      this.openCreatePanel();
    }
  }

  private parsePositiveInt(raw: string | null): number | undefined {
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }

  private termFromHistory(): string | null {
    const value = (globalThis.history?.state as Record<string, unknown> | null)?.[TERM_STATE_KEY];
    return typeof value === 'string' ? value : null;
  }

  /** Escribe el estado del listado en la URL (reemplazando, sin apilar historial); el término va en el state. */
  private syncUrl(): void {
    const term = this.store.term().trim();
    // Con la misma URL el router ignora la navegación (y su `state`): se escribe en la entrada actual.
    const keepTerm = () =>
      globalThis.history?.replaceState({ ...(globalThis.history.state ?? {}), [TERM_STATE_KEY]: term }, '');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        term: null,
        status: this.store.status() === 'NotArchived' ? null : this.store.status(),
        kind: this.store.kind() === 'All' ? null : this.store.kind().toLowerCase(),
        sort: this.isCustomSort() ? (this.sortOptionFor(this.store.sort())?.param ?? null) : null,
        page: this.store.page() > 1 ? this.store.page() : null,
        size: this.store.size() !== 25 ? this.store.size() : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    }).then(keepTerm, keepTerm);
  }

  /** Llega ya con debounce (`SEARCH_DEBOUNCE_MS`) desde `app-search-input`. */
  onSearchChange(value: string): void {
    this.searchInput.set(value);
    this.clearSelection();
    this.store.setTerm(value);
    this.syncUrl();
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

  setKind(kind: CustomerKindFilter): void {
    this.clearSelection();
    this.store.setKind(kind);
    this.syncUrl();
  }

  setSort(sort: CustomerListSort): void {
    if (sort.field === this.sort().field && sort.dir === this.sort().dir) return;
    this.clearSelection();
    this.store.setSort({ field: sort.field, dir: sort.dir });
    this.syncUrl();
  }

  /** Clic en el encabezado: la misma columna invierte; otra arranca en su orden natural (A–Z, lo más nuevo). */
  toggleSort(field: CustomerSortField): void {
    const current = this.sort();
    if (current.field === field) {
      this.setSort({ field, dir: current.dir === 'Asc' ? 'Desc' : 'Asc' });
    } else {
      this.setSort({ field, dir: field === 'Created' ? 'Desc' : 'Asc' });
    }
  }

  isSortSelected(option: CustomerListSort): boolean {
    return option.field === this.sort().field && option.dir === this.sort().dir;
  }

  /** Vuelve al listado de siempre (estado, tipo y búsqueda); el orden se respeta. */
  clearFilters(): void {
    this.searchInput.set('');
    this.clearSelection();
    this.store.resetFilters();
    this.syncUrl();
  }

  private sortOptionFor(sort: CustomerListSort): SortOption | undefined {
    return SORT_OPTIONS.find(o => o.field === sort.field && o.dir === sort.dir);
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

  /** Kebab de fila → gestionar los asignados de UN cliente. */
  openAssign(client: ClientItem): void {
    this.assignMode.set('single');
    this.assignClient.set({ id: client.id, displayName: client.displayName });
    this.assignOpen.set(true);
  }

  /** Barra bulk → repartir los seleccionados a un miembro del staff. */
  openBulkAssign(): void {
    if (this.selected().size === 0) {
      return;
    }
    this.assignMode.set('bulk');
    this.assignCustomerIds.set([...this.selected()]);
    this.assignOpen.set(true);
  }

  /** Al cerrar el diálogo: si hubo cambios, refresca el listado (y limpia la selección en bulk). */
  onAssignClosed(changed: boolean): void {
    this.assignOpen.set(false);
    if (!changed) {
      return;
    }
    if (this.assignMode() === 'bulk') {
      this.clearSelection();
    }
    this.store.reloadList();
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
