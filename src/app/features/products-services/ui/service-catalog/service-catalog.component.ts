import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { StatusPillComponent, StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { MoneyPipe } from '@shared/pipes/money.pipe';
import {
  CatalogEntry,
  CatalogEntryStatus,
  CatalogItemKind,
  categoryChipClass,
  categoryCircleClass,
  kindIcon,
} from '../../data-access/catalog.model';

type CategoryFilter = 'All' | string;
const PAGE_SIZE = 8;

/**
 * Catálogo de servicios del módulo Products & Services (estilo "Aether"):
 * búsqueda píldora, filtros de categoría píldora (activa en negro), toggle
 * tabla/grid y tabla con header píldora. Filtrado 100% local vía computed;
 * la lista y las categorías (dinámicas, por tenant) llegan por @Input desde
 * la página contenedora, que las trae del backend real (/catalog).
 */
@Component({
  selector: 'app-service-catalog',
  imports: [
    CommonModule,
    PaginationComponent,
    SearchInputComponent,
    FilterChipsComponent,
    StatusPillComponent,
    StateBlockComponent,
    MoneyPipe,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './service-catalog.component.html',
})
export class ServiceCatalogComponent {
  private readonly servicesSig = signal<CatalogEntry[]>([]);
  private readonly categoriesSig = signal<string[]>([]);

  @Input() set services(value: CatalogEntry[]) {
    this.servicesSig.set(value ?? []);
  }

  /** Nombres de categorías del tenant (GET /catalog/categories) para las píldoras de filtro. */
  @Input() set categories(value: string[]) {
    this.categoriesSig.set(value ?? []);
  }

  @Output() addService = new EventEmitter<void>();
  @Output() editService = new EventEmitter<CatalogEntry>();
  @Output() deleteService = new EventEmitter<CatalogEntry>();

  readonly filters = computed<FilterChipOption<CategoryFilter>[]>(() =>
    ['All', ...this.categoriesSig()].map(name => ({ id: name, label: name })),
  );

  readonly searchTerm = signal('');
  readonly activeFilter = signal<CategoryFilter>('All');
  readonly viewMode = signal<'table' | 'grid'>('table');

  readonly filteredServices = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const filter = this.activeFilter();
    return this.servicesSig().filter(s => {
      const matchesFilter = filter === 'All' || s.category === filter;
      const matchesTerm =
        !term || s.name.toLowerCase().includes(term) || s.code.toLowerCase().includes(term);
      return matchesFilter && matchesTerm;
    });
  });

  /** true cuando el tenant no tiene ítems aún (empty state distinto al de "sin resultados"). */
  readonly isCatalogEmpty = computed(() => this.servicesSig().length === 0);

  readonly emptyTitle = computed(() =>
    this.isCatalogEmpty() ? 'No services yet — add your first one to get started' : 'No services match your search',
  );

  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly pagedServices = computed(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.filteredServices().slice(start, start + PAGE_SIZE);
  });

  setFilter(filter: CategoryFilter): void {
    this.activeFilter.set(filter);
    this.currentPage.set(1);
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
    this.currentPage.set(1);
  }

  // Colores/íconos: las categorías son dinámicas, así que se derivan por hash estable
  // (helpers del data-access) en lugar del viejo switch sobre 4 nombres fijos.

  categoryIcon(kind: CatalogItemKind): string {
    return kindIcon(kind);
  }

  categoryCircle(category: string): string {
    return categoryCircleClass(category);
  }

  categoryChip(category: string): string {
    return categoryChipClass(category);
  }

  statusTone(status: CatalogEntryStatus): StatusTone {
    return status === 'active' ? 'success' : 'neutral';
  }

  statusLabel(status: CatalogEntryStatus): string {
    return status === 'active' ? 'Active' : 'Inactive';
  }
}
