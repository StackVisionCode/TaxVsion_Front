import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { CustomerPickerComponent } from '@shared/ui/customer-picker/customer-picker.component';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import { WizardClient } from '../signature-request-panel/signature-wizard.model';
import { clientTypeBadge } from '../signature-request-panel/signature-wizard.presenter';

type TypeFilter = 'all' | 'individual' | 'company';

/**
 * Paso 1 del wizard: muestra el cliente elegido (tarjeta de resumen) o el buscador
 * (`app-customer-picker` compartido, typeahead server-side sobre el directorio) con filtro
 * por tipo y acceso rápido a los recientes del directorio. "Change" reabre el buscador
 * sin perder la selección actual hasta que se elige otro cliente.
 */
@Component({
  selector: 'app-signature-wizard-client-step',
  imports: [CommonModule, AvatarComponent, CustomerPickerComponent, FilterChipsComponent, StatusPillComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-wizard-client-step.component.html',
  styleUrl: './signature-wizard-client-step.component.css',
})
export class SignatureWizardClientStepComponent implements OnChanges {
  @Input() selected: WizardClient | null = null;
  /** Recientes del directorio compartido (se filtran por tipo aquí). */
  @Input() recent: CustomerSummary[] = [];
  /** Cliente elegido en el buscador o en los recientes. */
  @Output() picked = new EventEmitter<CustomerSummary>();

  /** Con cliente elegido, "Change" muestra el buscador bajo la tarjeta. */
  readonly changing = signal(false);

  readonly typeFilters: FilterChipOption<TypeFilter>[] = [
    { id: 'all', label: 'All' },
    { id: 'individual', label: 'Individuals' },
    { id: 'company', label: 'Companies' },
  ];
  readonly typeFilter = signal<TypeFilter>('all');

  /** Filtro por tipo que el picker aplica a resultados y recientes. */
  readonly typeFilterFn = computed(() => {
    const filter = this.typeFilter();
    return (customer: CustomerSummary): boolean =>
      filter === 'all' || (filter === 'company') === (customer.kind === 'Business');
  });

  private readonly recentSig = signal<CustomerSummary[]>([]);
  readonly visibleRecent = computed(() => this.recentSig().filter(this.typeFilterFn()));

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['recent']) {
      this.recentSig.set(this.recent ?? []);
    }
    if (changes['selected']) {
      this.changing.set(false);
    }
  }

  typeBadge(client: WizardClient): string {
    return clientTypeBadge(client.type);
  }

  clientSince(client: WizardClient): string {
    return new Date(`${client.createdAt}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    });
  }

  trackCustomer(_index: number, customer: CustomerSummary): string {
    return customer.id;
  }

  onPicked(customer: CustomerSummary | null): void {
    if (customer) {
      this.picked.emit(customer);
    }
  }
}
