import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WizardClient } from '../signature-request-panel/signature-wizard.model';
import { avatarColor, clientTypeBadge, initialsOf } from '../signature-request-panel/signature-wizard.presenter';
import { SignatureStore } from '../../data-access/signature.store';

type TypeFilter = 'all' | 'individual' | 'company';

/**
 * Paso 1 del wizard: buscar, filtrar por tipo y elegir el cliente. Dos columnas
 * en lg: lista de tarjetas a la izquierda, panel sticky con el detalle del
 * seleccionado a la derecha (patrón preview de la feature documents).
 * Los clientes vienen de Customer.Api (GET /customers vía SignatureStore, lote
 * NotArchived); búsqueda y filtro de tipo son client-side sobre ese lote.
 */
@Component({
  selector: 'app-signature-wizard-client-step',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-wizard-client-step.component.html',
  styleUrl: './signature-wizard-client-step.component.css',
})
export class SignatureWizardClientStepComponent {
  @Input() selectedId: string | null = null;
  @Output() clientSelected = new EventEmitter<WizardClient>();

  readonly store = inject(SignatureStore);

  readonly typeFilters: TypeFilter[] = ['all', 'individual', 'company'];
  readonly typeFilter = signal<TypeFilter>('all');
  readonly search = signal('');

  constructor() {
    this.store.loadCustomers();

    // Typeahead server-side: cada término (debounced) consulta el backend, que busca
    // sobre TODO el tenant — así se encuentran clientes fuera del lote inicial precargado.
    // El filtro `filtered` de abajo sigue afinando en cliente para respuesta instantánea.
    toObservable(this.search)
      .pipe(
        map(term => term.trim()),
        debounceTime(250),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe(term => this.store.queryCustomers(term));
  }

  // El texto lo resuelve el backend (typeahead server-side); aquí sólo afinamos por tipo
  // sobre las coincidencias devueltas, para no ocultar un match del servidor (p. ej. razón
  // social de una empresa) que el filtro local no comprobaría.
  readonly filtered = computed<WizardClient[]>(() => {
    const filter = this.typeFilter();
    return this.store.customers().filter(client => filter === 'all' || client.type === filter);
  });

  retryLoad(): void {
    this.store.loadCustomers(true);
  }

  /** Detalle del cliente actualmente seleccionado (para el panel derecho). */
  selectedClient(): WizardClient | null {
    return this.store.customers().find(client => client.id === this.selectedId) ?? null;
  }

  /** Lista 0-o-1 para *ngFor+trackBy: al cambiar el id se recrea el nodo y re-anima el panel. */
  selectedAsList(): WizardClient[] {
    const client = this.selectedClient();
    return client ? [client] : [];
  }

  trackClient(_index: number, client: WizardClient): string {
    return client.id;
  }

  setTypeFilter(filter: TypeFilter): void {
    this.typeFilter.set(filter);
  }

  filterLabel(filter: TypeFilter): string {
    switch (filter) {
      case 'all':
        return 'All';
      case 'individual':
        return 'Individuals';
      case 'company':
        return 'Companies';
    }
  }

  initials(name: string): string {
    return initialsOf(name);
  }

  avatar(index: number): string {
    return avatarColor(index);
  }

  typeBadge(client: WizardClient): string {
    return clientTypeBadge(client.type);
  }

  /** Índice del cliente en el lote cargado (color de avatar estable, no depende del filtro). */
  seedIndex(client: WizardClient): number {
    return this.store.customers().indexOf(client);
  }

  clientSince(client: WizardClient): string {
    return new Date(`${client.createdAt}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    });
  }

  select(client: WizardClient): void {
    this.clientSelected.emit(client);
  }
}
