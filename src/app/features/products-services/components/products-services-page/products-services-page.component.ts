import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { ServiceCatalogComponent } from '../../ui/service-catalog/service-catalog.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { CatalogStore } from '../../data-access/catalog.store';
import { CatalogEntry, CatalogFormValue, CatalogItemKind } from '../../data-access/catalog.model';

/**
 * Página del módulo Products & Services (estilo "Aether"): stats pastel +
 * catálogo con búsqueda/filtros/toggle grid-tabla + modal de crear/editar.
 * Los datos vienen del servicio Catalog (/catalog vía Gateway) a través del
 * CatalogStore; las categorías son POR TENANT y el modal permite crearlas al
 * vuelo porque el backend exige un CategoryId válido para todo ítem.
 */
@Component({
  selector: 'app-products-services-page',
  imports: [CommonModule, FormsModule, ServiceCatalogComponent, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './products-services-page.component.html',
})
export class ProductsServicesPageComponent implements OnInit {
  readonly store = inject(CatalogStore);

  // ---------- Stats (sobre el lote cargado; el total viene del servidor) ----------

  readonly activeCount = computed(() => this.store.entries().filter(s => s.status === 'active').length);
  readonly avgPrice = computed(() => {
    const services = this.store.entries();
    if (!services.length) return 0;
    return Math.round(services.reduce((sum, s) => sum + s.price, 0) / services.length);
  });

  // ---------- Modal de crear/editar ----------

  readonly isAddOpen = signal(false);
  readonly editingService = signal<CatalogEntry | null>(null);
  readonly newName = signal('');
  readonly newPrice = signal<number | null>(null);
  readonly newCategoryId = signal('');
  /** Kind solo editable al crear: el backend no permite cambiar el tipo de un ítem. */
  readonly newKind = signal<CatalogItemKind>('Service');
  readonly newActive = signal(true);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  // Alta inline de categoría (sin ella un tenant nuevo no podría crear su primer ítem).
  readonly newCategoryName = signal('');
  readonly creatingCategory = signal(false);

  readonly canAdd = computed(
    () =>
      this.newName().trim().length > 0 &&
      (this.newPrice() ?? 0) > 0 &&
      this.newCategoryId().length > 0 &&
      !this.saving(),
  );

  ngOnInit(): void {
    this.store.init();
  }

  openAddPanel(): void {
    this.editingService.set(null);
    this.newKind.set('Service');
    this.newActive.set(true);
    // Preselecciona la primera categoría para no obligar un click extra.
    this.newCategoryId.set(this.store.categories()[0]?.id ?? '');
    this.isAddOpen.set(true);
  }

  openEditPanel(service: CatalogEntry): void {
    this.editingService.set(service);
    this.newName.set(service.name);
    this.newPrice.set(service.price);
    this.newCategoryId.set(service.categoryId);
    this.newKind.set(service.kind);
    this.newActive.set(service.status === 'active');
    this.isAddOpen.set(true);
  }

  cancelAdd(): void {
    this.isAddOpen.set(false);
    this.editingService.set(null);
    this.newName.set('');
    this.newPrice.set(null);
    this.newCategoryId.set('');
    this.newKind.set('Service');
    this.newActive.set(true);
    this.newCategoryName.set('');
    this.saveError.set(null);
    this.saving.set(false);
  }

  /** POST /catalog/categories al vuelo y deja la nueva categoría seleccionada. */
  addCategory(): void {
    const name = this.newCategoryName().trim();
    if (!name || this.creatingCategory()) {
      return;
    }
    this.creatingCategory.set(true);
    this.store.createCategory(name).subscribe({
      next: created => {
        this.newCategoryId.set(created.id);
        this.newCategoryName.set('');
        this.creatingCategory.set(false);
      },
      error: err => {
        this.saveError.set(toApiError(err).message);
        this.creatingCategory.set(false);
      },
    });
  }

  confirmAdd(): void {
    if (!this.canAdd()) {
      return;
    }
    const form: CatalogFormValue = {
      name: this.newName().trim(),
      price: this.newPrice()!,
      categoryId: this.newCategoryId(),
      kind: this.newKind(),
      isActive: this.newActive(),
    };
    const editing = this.editingService();
    const request$ = editing ? this.store.updateEntry(editing.id, form) : this.store.createEntry(form);

    this.saving.set(true);
    this.saveError.set(null);
    request$.subscribe({
      next: () => this.cancelAdd(),
      error: err => {
        // El modal queda abierto con el error del backend (p.ej. catalog.categoryNotFound).
        this.saveError.set(toApiError(err).message);
        this.saving.set(false);
      },
    });
  }
}
