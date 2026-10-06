import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { CustomerStatusFilter, CustomerSummary } from '@core/customers/customer-summary.model';
import { TypeaheadComponent } from '../typeahead/typeahead.component';
import { AvatarComponent } from '../avatar/avatar.component';

export type CustomerPickerVariant = 'field' | 'inline';

/**
 * Selector de cliente sobre el directorio compartido (`CustomerDirectoryStore`, búsqueda server-side
 * cacheada + recientes). Componente "smart" de shared: inyecta un store de CORE (nunca de features),
 * por eso vive en shared/ui.
 *
 * Uso:
 * ```html
 * <app-customer-picker [selectedId]="form.customerId" (selectedChange)="onCustomer($event)" />
 * <app-customer-picker variant="inline" placeholder="Add a recipient…" (selectedChange)="add($event!)" />
 * ```
 *
 * Inputs:
 * - `selected` (CustomerSummary | null): selección controlada por el padre.
 * - `selectedId` (string | null): alternativa cuando el padre solo tiene el id; se resuelve con
 *   `store.byId` (cache). `selected` gana si ambos vienen.
 * - `status` (default 'NotArchived'): filtro `status` de GET /customers; también filtra los recientes
 *   (con 'NotArchived' se ocultan archivados; con 'Active' solo activos).
 * - `filter` ((c) => boolean): filtro adicional en cliente (resultados y recientes).
 * - `variant`: 'field' (default) → con selección muestra un chip (avatar + nombre + email + botón
 *   "Change client" que limpia); sin selección, el typeahead. 'inline' → siempre el typeahead; al elegir
 *   emite y se limpia (para añadir destinatarios, como en sms).
 * - `placeholder` ('Search a client…'), `disabled`, `pageSize` (20), `debounceMs` (250).
 *
 * Output: `(selectedChange)` CustomerSummary al elegir, `null` al limpiar (variant field). Se llama
 * `selectedChange` (no `selected`) para no chocar con el input y permitir `[(selected)]`.
 *
 * Cada elección se sube a los recientes del store (`addRecent`), así el siguiente picker de cualquier
 * módulo los ofrece sin teclear. El store no se modificó.
 *
 * Normalizado: mail usaba avatar h-8 con `font-semibold`; invoice-form un icono de persona en el
 * chip; task-create un `<select>` falso con "No client". Aquí: filas con avatar sm + nombre + email
 * (mail) y chip con avatar h-9 (invoice-form).
 */
@Component({
  selector: 'app-customer-picker',
  imports: [TypeaheadComponent, AvatarComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'block' },
  template: `
    @if (variant === 'field' && current(); as picked) {
      <div class="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
        <app-avatar [name]="picked.displayName" [seed]="picked.id" sizeClass="h-9 w-9 text-xs" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-gray-900">{{ picked.displayName }}</span>
          <span class="block truncate text-xs text-gray-400">{{ picked.primaryEmail || 'No email on file' }}</span>
        </span>
        <button type="button" (click)="clear()" [disabled]="disabled"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 transition-colors"
          aria-label="Change client">
          <ion-icon name="close-outline" class="text-base"></ion-icon>
        </button>
      </div>
    } @else {
      <app-typeahead [search]="searchFn" [placeholder]="placeholder" [debounceMs]="debounceMs" [recent]="recentItems()"
        [displayWith]="nameOf" [trackBy]="idOf" [disabled]="disabled" emptyText="No clients match your search"
        ariaLabel="Search a client" (picked)="pick($event)">
        <ng-template #option let-customer>
          <app-avatar [name]="customer.displayName" [seed]="customer.id" size="sm" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm"
              [class]="customer.id === current()?.id ? 'font-semibold text-brand-bold' : 'text-gray-800'">
              {{ customer.displayName }}
            </span>
            @if (customer.primaryEmail) {
              <span class="block truncate text-[11px] text-gray-400">{{ customer.primaryEmail }}</span>
            }
          </span>
          @if (customer.id === current()?.id) {
            <ion-icon name="checkmark-outline" class="shrink-0 text-base text-brand-bold"></ion-icon>
          }
        </ng-template>
      </app-typeahead>
    }
  `,
})
export class CustomerPickerComponent implements OnChanges {
  private readonly store = inject(CustomerDirectoryStore);
  private readonly destroyRef = inject(DestroyRef);

  @Input() selected: CustomerSummary | null = null;
  @Input() selectedId: string | null = null;
  @Input() set status(value: CustomerStatusFilter) {
    this.statusSig.set(value || 'NotArchived');
  }
  get status(): CustomerStatusFilter {
    return this.statusSig();
  }
  @Input() set filter(value: ((customer: CustomerSummary) => boolean) | null | undefined) {
    this.filterSig.set(value ?? null);
  }
  @Input() variant: CustomerPickerVariant = 'field';
  @Input() placeholder = 'Search a client…';
  @Input() disabled = false;
  @Input() pageSize = 20;
  @Input() debounceMs = 250;

  @Output() readonly selectedChange = new EventEmitter<CustomerSummary | null>();

  /** Cliente mostrado en el chip (del input `selected` o resuelto desde `selectedId`). */
  readonly current = signal<CustomerSummary | null>(null);

  private readonly statusSig = signal<CustomerStatusFilter>('NotArchived');
  private readonly filterSig = signal<((customer: CustomerSummary) => boolean) | null>(null);

  readonly recentItems = computed(() => this.store.recent().filter(c => this.accepts(c)));

  readonly nameOf = (customer: CustomerSummary): string => customer.displayName;
  readonly idOf = (customer: CustomerSummary): string => customer.id;

  readonly searchFn = (term: string): Observable<CustomerSummary[]> =>
    this.store
      .search({ term, status: this.statusSig(), page: 1, size: this.pageSize })
      .pipe(map(page => (page.items ?? []).filter(c => this.accepts(c))));

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selected'] || changes['selectedId']) {
      this.syncCurrent();
    }
  }

  pick(customer: CustomerSummary): void {
    this.store.addRecent(customer);
    if (this.variant === 'field') {
      this.current.set(customer);
    }
    this.selectedChange.emit(customer);
  }

  clear(): void {
    this.current.set(null);
    this.selectedChange.emit(null);
  }

  private syncCurrent(): void {
    if (this.selected) {
      this.current.set(this.selected);
      return;
    }
    const id = this.selectedId;
    if (!id) {
      this.current.set(null);
      return;
    }
    if (this.current()?.id === id) {
      return;
    }
    this.store
      .byId([id])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(found => {
        // Solo si el padre no cambió de id mientras tanto.
        if (this.selectedId === id && !this.selected) {
          this.current.set(found.get(id) ?? null);
        }
      });
  }

  private accepts(customer: CustomerSummary): boolean {
    const status = this.statusSig();
    if (status === 'NotArchived' && customer.status === 'Archived') {
      return false;
    }
    if ((status === 'Active' || status === 'Inactive' || status === 'Archived') && customer.status !== status) {
      return false;
    }
    const filter = this.filterSig();
    return filter ? filter(customer) : true;
  }
}
