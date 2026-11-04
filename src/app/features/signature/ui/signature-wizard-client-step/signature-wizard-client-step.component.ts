import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { AvatarUrlPipe } from '@core/profile-photo/avatar-url.pipe';
import { CustomerPickerComponent } from '@shared/ui/customer-picker/customer-picker.component';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import { WizardClient } from '../signature-request-panel/signature-wizard.model';
import { clientTypeBadge } from '../signature-request-panel/signature-wizard.presenter';

type TypeFilter = 'all' | 'individual' | 'company';

/**
 * Paso 1 del wizard: los clientes de la solicitud (tarjetas) y el buscador (`app-customer-picker`
 * compartido, typeahead server-side) con filtro por tipo y recientes. Cada cliente firma como
 * cliente en el editor. "Change" reemplaza ese cliente en su sitio; "Add another client" suma otro.
 * El cliente fijado por el perfil (`pinnedId`) no se cambia ni se quita.
 */
@Component({
  selector: 'app-signature-wizard-client-step',
  imports: [AvatarUrlPipe, CommonModule, AvatarComponent, CustomerPickerComponent, FilterChipsComponent, StatusPillComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-wizard-client-step.component.html',
  styleUrl: './signature-wizard-client-step.component.css',
})
export class SignatureWizardClientStepComponent implements OnChanges {
  @Input() selected: WizardClient[] = [];
  /** Recientes del directorio compartido (se filtran por tipo aquí). */
  @Input() recent: CustomerSummary[] = [];
  /** true = wizard embebido en el perfil del cliente: mientras llega ese cliente se muestra "Loading". */
  @Input() locked = false;
  /** Cliente fijado (perfil): sin "Change" ni "Remove". */
  @Input() pinnedId: string | null = null;
  /** Cliente nuevo para la solicitud (buscador o recientes). */
  @Output() picked = new EventEmitter<CustomerSummary>();
  /** "Change" de un cliente ya elegido. */
  @Output() replaced = new EventEmitter<{ previousId: string; customer: CustomerSummary }>();
  @Output() removed = new EventEmitter<string>();

  /** Buscador abierto: 'add' suma un cliente; un id reemplaza ese cliente; null = cerrado. */
  readonly searching = signal<'add' | string | null>(null);

  readonly typeFilters: FilterChipOption<TypeFilter>[] = [
    { id: 'all', label: 'All' },
    { id: 'individual', label: 'Individuals' },
    { id: 'company', label: 'Companies' },
  ];
  readonly typeFilter = signal<TypeFilter>('all');

  private readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  /** Filtro que el picker aplica a resultados y recientes: tipo elegido y sin repetir clientes. */
  readonly typeFilterFn = computed(() => {
    const filter = this.typeFilter();
    const taken = this.selectedIds();
    return (customer: CustomerSummary): boolean =>
      !taken.has(customer.id) && (filter === 'all' || (filter === 'company') === (customer.kind === 'Business'));
  });

  private readonly recentSig = signal<CustomerSummary[]>([]);
  readonly visibleRecent = computed(() => this.recentSig().filter(this.typeFilterFn()));

  private readonly lockedSig = signal(false);
  /** Sin clientes el buscador siempre está abierto (salvo embebido, que espera al suyo). */
  readonly showSearch = computed(
    () => this.searching() !== null || (this.selectedIds().size === 0 && !this.lockedSig()),
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['recent']) {
      this.recentSig.set(this.recent ?? []);
    }
    if (changes['locked']) {
      this.lockedSig.set(this.locked);
    }
    if (changes['selected']) {
      this.selectedIds.set(new Set((this.selected ?? []).map((client) => client.id)));
      this.searching.set(null);
    }
  }

  isPinned(client: WizardClient): boolean {
    return client.id === this.pinnedId;
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

  trackClient(_index: number, client: WizardClient): string {
    return client.id;
  }

  trackCustomer(_index: number, customer: CustomerSummary): string {
    return customer.id;
  }

  toggleSearch(target: 'add' | string): void {
    this.searching.update((current) => (current === target ? null : target));
  }

  onPicked(customer: CustomerSummary | null): void {
    if (!customer) {
      return;
    }
    const target = this.searching();
    if (target && target !== 'add') {
      this.replaced.emit({ previousId: target, customer });
    } else {
      this.picked.emit(customer);
    }
  }
}
