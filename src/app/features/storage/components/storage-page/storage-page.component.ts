import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { UsedStorageCardComponent } from '../../../../shared/ui/used-storage-card/used-storage-card.component';
import { StorageStore } from '../../data-access/storage.store';
import {
  CATEGORY_META,
  SharePermission,
  SharedWithMeItem,
  categoryFromFileName,
  formatShareDate,
} from '../../data-access/storage.model';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const PAGE_SIZE = 8;

/** Fila de "mis archivos" cuando hay una categoría seleccionada. */
export interface CategoryFileRow {
  id: string;
  name: string;
  category: string;
  sizeBytes: number;
  /** Fecha de alta, o de borrado para las entradas de la papelera. */
  dateIso: string;
}

/**
 * Página del feature Storage, ahora contra el backend real (CloudStorage.Api
 * vía `/storage`): tarjeta "Used Storage" con la cuota de GET /storage/usage y
 * el donut segmentado por categoría (computada client-side por extensión desde
 * GET /storage/files + papelera), fila de tarjetas de categorías clickeables
 * para filtrar, y la tabla "Shared with me" de GET /storage/shares/shared-with-me
 * enriquecida con metadata de archivo y nombre de quien compartió. El estado
 * vive en StorageStore; acá solo queda estado de UI (filtro, página, expandido).
 */
@Component({
  selector: 'app-storage-page',
  imports: [CommonModule, RouterLink, PaginationComponent, UsedStorageCardComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './storage-page.component.html',
  styleUrl: './storage-page.component.css',
})
export class StoragePageComponent implements OnInit {
  readonly store = inject(StorageStore);

  readonly showAllCategories = signal(false);
  /** Categoría activa para filtrar la tabla; null = todas. */
  readonly selectedCategory = signal<string | null>(null);
  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  /** Placeholder mientras cargan las tarjetas de categorías. */
  readonly skeletonCards = [0, 1, 2];
  /** Placeholder mientras carga la tabla de shares. */
  readonly skeletonRows = [0, 1, 2, 3, 4];

  ngOnInit(): void {
    this.store.loadAll();
  }

  /** Tarjetas visibles: las 3 primeras, o todas al tocar "View All". */
  readonly visibleGroups = computed(() =>
    this.showAllCategories() ? this.store.groups() : this.store.groups().slice(0, 3),
  );

  /** true = la tabla lista MIS archivos de una categoría, no lo compartido conmigo. */
  readonly isCategoryView = computed(() => this.selectedCategory() !== null);

  /**
   * Mis archivos de la categoría activa.
   *
   * Las tarjetas de categoría cuentan los archivos propios (GET /storage/files
   * clasificados por extensión), así que al pulsar una hay que mostrar ESOS y
   * no los "shared with me": filtrar los compartidos por categoría daba
   * "0 file(s) in Images" justo debajo de una tarjeta que decía "1 files".
   */
  readonly categoryFiles = computed<CategoryFileRow[]>(() => {
    const category = this.selectedCategory();
    if (!category) {
      return [];
    }
    if (category === 'Trash') {
      return (this.store.trash() ?? []).map(entry => ({
        id: entry.id,
        name: entry.originalName,
        category: 'Trash',
        sizeBytes: entry.sizeBytes,
        dateIso: entry.softDeletedAtUtc,
      }));
    }
    return this.store
      .files()
      .filter(file => categoryFromFileName(file.originalName) === category)
      .map(file => ({
        id: file.id,
        name: file.originalName,
        category,
        sizeBytes: file.sizeBytes,
        dateIso: file.createdAtUtc,
      }));
  });

  /** Shares filtrados por la categoría seleccionada (todas si no hay ninguna activa). */
  readonly filteredShares = computed<SharedWithMeItem[]>(() => {
    const category = this.selectedCategory();
    return category ? this.store.shares().filter(item => item.category === category) : this.store.shares();
  });

  /** Cuántas filas tiene la tabla en el modo actual (para la paginación y el subtítulo). */
  readonly rowCount = computed(() =>
    this.isCategoryView() ? this.categoryFiles().length : this.filteredShares().length,
  );

  /** Página actual del filtrado, para la tabla. */
  readonly pagedShares = computed<SharedWithMeItem[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.filteredShares().slice(start, start + PAGE_SIZE);
  });

  readonly pagedCategoryFiles = computed<CategoryFileRow[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.categoryFiles().slice(start, start + PAGE_SIZE);
  });

  /** Cuántos de los archivos de la categoría están además compartidos contigo. */
  readonly sharedInCategoryCount = computed(() => (this.isCategoryView() ? this.filteredShares().length : 0));

  /**
   * Carga/error de la tabla según el modo: en vista de categoría dependen del
   * listado de archivos (`groups*`), no del de shares, así que reutilizar el de
   * shares mostraría un error que no corresponde a lo que se está listando.
   */
  readonly tableLoading = computed(() =>
    this.isCategoryView() ? this.store.groupsLoading() : this.store.sharesLoading(),
  );
  readonly tableError = computed(() =>
    this.isCategoryView() ? this.store.groupsError() : this.store.sharesError(),
  );

  retryTable(): void {
    if (this.isCategoryView()) {
      this.store.loadAll();
      return;
    }
    this.store.loadShares();
  }

  toggleCategories(): void {
    this.showAllCategories.update(value => !value);
  }

  /** Al hacer click en una tarjeta de categoría, filtra la tabla; un segundo click sobre la misma la limpia. */
  selectCategory(name: string): void {
    this.selectedCategory.update(current => (current === name ? null : name));
    this.currentPage.set(1);
  }

  clearCategoryFilter(): void {
    this.selectedCategory.set(null);
    this.currentPage.set(1);
  }

  download(item: SharedWithMeItem): void {
    this.store.downloadShared(item);
  }

  /** Color hex de la categoría (mismo que su tarjeta/donut), usado para el chip de la tabla. */
  categoryColor(categoryName: string): string {
    return CATEGORY_META[categoryName]?.color ?? '#9CA3AF';
  }

  /** Ícono de la categoría, para la fila de "mis archivos". */
  categoryIcon(categoryName: string): string {
    return CATEGORY_META[categoryName]?.icon ?? 'document-outline';
  }

  permissionLabel(permission: SharePermission): string {
    return permission === 'EditMetadata' ? 'Edit metadata' : permission;
  }

  formatDate(iso: string): string {
    return formatShareDate(iso);
  }

  formatBytes(bytes: number): string {
    if (bytes <= 0) {
      return '0 KB';
    }
    if (bytes >= GB) {
      return `${(bytes / GB).toFixed(1)} GB`;
    }
    if (bytes >= MB) {
      return `${Math.round(bytes / MB)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
}
