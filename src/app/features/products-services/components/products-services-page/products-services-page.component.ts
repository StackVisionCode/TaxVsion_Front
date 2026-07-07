import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CatalogService,
  SEED_SERVICES,
  ServiceCategory,
  ServiceCatalogComponent,
  SERVICE_CATEGORIES,
} from '../../ui/service-catalog/service-catalog.component';

/**
 * Página del módulo Products & Services (estilo "Aether"): stats pastel +
 * catálogo con búsqueda/filtros/toggle grid-tabla + panel local para agregar
 * un servicio nuevo. Todo visual, datos estáticos en signals.
 */
@Component({
  selector: 'app-products-services-page',
  imports: [CommonModule, FormsModule, ServiceCatalogComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './products-services-page.component.html',
})
export class ProductsServicesPageComponent {
  readonly services = signal<CatalogService[]>([...SEED_SERVICES]);
  readonly categories = SERVICE_CATEGORIES;

  readonly totalCount = computed(() => this.services().length);
  readonly activeCount = computed(() => this.services().filter(s => s.status === 'active').length);
  readonly avgPrice = computed(() => {
    const services = this.services();
    if (!services.length) return 0;
    return Math.round(services.reduce((sum, s) => sum + s.price, 0) / services.length);
  });

  readonly isAddOpen = signal(false);
  readonly newName = signal('');
  readonly newPrice = signal<number | null>(null);
  readonly newCategory = signal<ServiceCategory>('Tax Prep');

  readonly canAdd = computed(() => this.newName().trim().length > 0 && (this.newPrice() ?? 0) > 0);

  openAddPanel(): void {
    this.isAddOpen.set(true);
  }

  cancelAdd(): void {
    this.isAddOpen.set(false);
    this.newName.set('');
    this.newPrice.set(null);
    this.newCategory.set('Tax Prep');
  }

  confirmAdd(): void {
    if (!this.canAdd()) {
      return;
    }
    const code = `NEW-${Math.floor(100 + Math.random() * 900)}`;
    this.services.update(list => [
      ...list,
      {
        id: `s-new-${Date.now()}`,
        name: this.newName().trim(),
        code,
        category: this.newCategory(),
        price: this.newPrice()!,
        status: 'active',
      },
    ]);
    this.cancelAdd();
  }
}
