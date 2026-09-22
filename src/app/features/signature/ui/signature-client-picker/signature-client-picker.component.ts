import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { WizardClient } from '../signature-request-panel/signature-wizard.model';
import { avatarColor, clientTypeBadge, initialsOf } from '../signature-request-panel/signature-wizard.presenter';
import { SignatureStore } from '../../data-access/signature.store';

type TypeFilter = 'all' | 'individual' | 'company';

/**
 * Modal de búsqueda/selección de cliente para el wizard de firma. Se monta en la
 * RAÍZ del panel (no dentro de la tarjeta animada del wizard): su overlay
 * `position: fixed` se rompe si un ancestro tiene `transform`, y las animaciones
 * de entrada del wizard crean ese ancestro. Typeahead server-side vía
 * SignatureStore → directorio compartido; el filtro por tipo afina en cliente.
 */
@Component({
  selector: 'app-signature-client-picker',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-client-picker.component.html',
  styleUrl: './signature-client-picker.component.css',
})
export class SignatureClientPickerComponent {
  @Input() set isOpen(value: boolean) {
    this.open.set(value);
    if (value) {
      this.typeFilter.set('all');
      this.search.set('');
      this.store.queryCustomers(''); // refresca el lote de browse al abrir
    }
  }
  @Input() selectedId: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() picked = new EventEmitter<WizardClient>();

  readonly store = inject(SignatureStore);

  readonly open = signal(false);
  readonly typeFilters: TypeFilter[] = ['all', 'individual', 'company'];
  readonly typeFilter = signal<TypeFilter>('all');
  readonly search = signal('');

  constructor() {
    // Typeahead server-side: cada término (debounced) consulta el backend, que busca
    // sobre TODO el tenant. Sólo mientras el modal está abierto, para no traer en vano.
    toObservable(this.search)
      .pipe(
        map(term => term.trim()),
        debounceTime(250),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe(term => {
        if (this.open()) {
          this.store.queryCustomers(term);
        }
      });
  }

  // El texto lo resuelve el backend; aquí sólo afinamos por tipo sobre las coincidencias
  // devueltas, para no ocultar un match del servidor (p. ej. razón social).
  readonly filtered = computed<WizardClient[]>(() => {
    const filter = this.typeFilter();
    return this.store.customers().filter(client => filter === 'all' || client.type === filter);
  });

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

  /** Color de avatar estable por id (no depende del orden ni del filtro). */
  avatarFor(client: WizardClient): string {
    let hash = 0;
    for (const ch of client.id) {
      hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    }
    return avatarColor(Math.abs(hash));
  }

  typeBadge(client: WizardClient): string {
    return clientTypeBadge(client.type);
  }

  trackClient(_index: number, client: WizardClient): string {
    return client.id;
  }

  retryLoad(): void {
    this.store.loadCustomers(true);
  }

  select(client: WizardClient): void {
    this.picked.emit(client);
  }

  close(): void {
    this.closed.emit();
  }
}
