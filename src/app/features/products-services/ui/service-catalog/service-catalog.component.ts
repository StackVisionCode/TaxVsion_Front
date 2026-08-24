import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
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
  imports: [CommonModule, FormsModule, PaginationComponent],
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

  readonly filters = computed<CategoryFilter[]>(() => ['All', ...this.categoriesSig()]);

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

  statusChip(status: CatalogEntryStatus): string {
    return status === 'active'
      ? 'border-emerald-200 text-emerald-600'
      : 'border-gray-300 text-gray-500';
  }

  statusLabel(status: CatalogEntryStatus): string {
    return status === 'active' ? 'Active' : 'Inactive';
  }
}
