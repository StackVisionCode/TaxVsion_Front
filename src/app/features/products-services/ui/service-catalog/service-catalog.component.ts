import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';

export type ServiceCategory = 'Tax Prep' | 'Bookkeeping' | 'Payroll' | 'Advisory';
export type ServiceStatus = 'active' | 'draft';

export interface CatalogService {
  id: string;
  name: string;
  code: string;
  category: ServiceCategory;
  price: number;
  status: ServiceStatus;
}

export const SERVICE_CATEGORIES: ServiceCategory[] = ['Tax Prep', 'Bookkeeping', 'Payroll', 'Advisory'];

export const SEED_SERVICES: CatalogService[] = [
  { id: 's1', name: 'Individual Tax Return (1040)', code: 'TAX-1040', category: 'Tax Prep', price: 350, status: 'active' },
  { id: 's2', name: 'Business Tax Return (1120)', code: 'TAX-1120', category: 'Tax Prep', price: 850, status: 'active' },
  { id: 's3', name: 'Partnership Return (1065)', code: 'TAX-1065', category: 'Tax Prep', price: 750, status: 'active' },
  { id: 's4', name: 'Amended Return (1040-X)', code: 'TAX-1040X', category: 'Tax Prep', price: 225, status: 'draft' },
  { id: 's5', name: 'Monthly Bookkeeping', code: 'BKP-MTH', category: 'Bookkeeping', price: 400, status: 'active' },
  { id: 's6', name: 'QuickBooks Cleanup', code: 'BKP-QBC', category: 'Bookkeeping', price: 600, status: 'active' },
  { id: 's7', name: 'Sales Tax Filing', code: 'BKP-STX', category: 'Bookkeeping', price: 120, status: 'active' },
  { id: 's8', name: 'Payroll Processing (per run)', code: 'PAY-RUN', category: 'Payroll', price: 95, status: 'active' },
  { id: 's9', name: 'Quarterly Payroll Filings (941)', code: 'PAY-941', category: 'Payroll', price: 150, status: 'active' },
  { id: 's10', name: 'Tax Planning Session', code: 'ADV-PLAN', category: 'Advisory', price: 250, status: 'active' },
  { id: 's11', name: 'IRS Audit Support', code: 'ADV-AUDIT', category: 'Advisory', price: 1200, status: 'draft' },
];

type CategoryFilter = 'All' | ServiceCategory;
const PAGE_SIZE = 8;

/**
 * Catálogo de servicios del módulo Products & Services (estilo "Aether"):
 * búsqueda píldora, filtros de categoría píldora (activa en negro), toggle
 * tabla/grid y tabla con header píldora. Filtrado 100% local vía computed;
 * la lista llega por @Input desde la página contenedora.
 */
@Component({
  selector: 'app-service-catalog',
  imports: [CommonModule, FormsModule, PaginationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './service-catalog.component.html',
})
export class ServiceCatalogComponent {
  private readonly servicesSig = signal<CatalogService[]>([]);

  @Input() set services(value: CatalogService[]) {
    this.servicesSig.set(value ?? []);
  }

  @Output() addService = new EventEmitter<void>();

  readonly categories = SERVICE_CATEGORIES;
  readonly filters: CategoryFilter[] = ['All', ...SERVICE_CATEGORIES];

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

  categoryIcon(category: ServiceCategory): string {
    switch (category) {
      case 'Tax Prep':
        return 'document-text-outline';
      case 'Bookkeeping':
        return 'book-outline';
      case 'Payroll':
        return 'cash-outline';
      case 'Advisory':
        return 'bulb-outline';
    }
  }

  categoryCircle(category: ServiceCategory): string {
    switch (category) {
      case 'Tax Prep':
        return 'bg-[#F2E3C9]';
      case 'Bookkeeping':
        return 'bg-[#CBD9F2]';
      case 'Payroll':
        return 'bg-[#EEEBFA]';
      case 'Advisory':
        return 'bg-[#DCDCDC]';
    }
  }

  categoryChip(category: ServiceCategory): string {
    switch (category) {
      case 'Tax Prep':
        return 'border-orange-200 text-orange-500';
      case 'Bookkeeping':
        return 'border-indigo-200 text-indigo-600';
      case 'Payroll':
        return 'border-[#D6CEF4] text-[#7C6AE0]';
      case 'Advisory':
        return 'border-emerald-200 text-emerald-600';
    }
  }

  statusChip(status: ServiceStatus): string {
    return status === 'active'
      ? 'border-emerald-200 text-emerald-600'
      : 'border-gray-300 text-gray-500';
  }

  statusLabel(status: ServiceStatus): string {
    return status === 'active' ? 'Active' : 'Draft';
  }
}
