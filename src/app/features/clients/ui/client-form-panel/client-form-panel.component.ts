import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BusinessStructure, ClientItem, ClientType } from '../client-table/client-table.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { toApiError } from '@core/models/api-error.model';
import { ClientSaveOptions, ClientsStore } from '../../data-access/clients.store';
import { ApiBusinessStructure, CreateCustomerRequest, UpdateCustomerRequest } from '../../data-access/clients.model';

const BUSINESS_STRUCTURES: BusinessStructure[] = ['LLC', 'S-Corp', 'C-Corp', 'Partnership', 'Sole Proprietorship'];

/** UI (dropdown, legible) -> TaxVision.Customer.Domain.Customers.BusinessStructure (backend). */
const BUSINESS_STRUCTURE_TO_API: Record<BusinessStructure, ApiBusinessStructure> = {
  LLC: 'Llc',
  'S-Corp': 'SCorp',
  'C-Corp': 'CCorp',
  Partnership: 'Partnership',
  'Sole Proprietorship': 'SoleProprietorship',
};

/**
 * Overlay de creación/edición del directorio de clientes (mismo patrón que
 * task-create-panel/invoice-form-panel): tarjeta centrada `rounded-[28px]`
 * sobre backdrop con stopPropagation, ampliada a `max-w-2xl` y con scroll
 * interno. Un único componente cubre ambos modos: si `client` llega con
 * datos precarga el formulario y actúa como edición ("Edit Client" / "Save
 * changes"); si es null arranca vacío ("New Client" / "Create client").
 * `isEditMode` es una signal propia actualizada en ngOnChanges, no un
 * computed() sobre el @Input (que no reaccionaría a sus cambios).
 *
 * `save()` llama a ClientsStore (POST/PATCH /customers real, más PUT
 * fiscal-profile si hay SSN/ITIN/EIN y activate/deactivate si cambia el
 * toggle "Active client"). No hay campos de Occupation/Marital status ni
 * Address: el backend no los expone vía GET (occupation necesita un
 * OccupationId de un catálogo que hoy no existe; marital status no existe en
 * el dominio; address requiere el sub-recurso de direcciones, que tampoco
 * tiene un GET para releerlo) — mostrarlos sería una promesa de guardado que
 * el backend no puede cumplir.
 */
@Component({
  selector: 'app-client-form-panel',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-form-panel.component.html',
})
export class ClientFormPanelComponent implements OnChanges {
  private readonly store = inject(ClientsStore);

  @Input() isOpen = false;
  @Input() client: ClientItem | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<ClientItem>();

  readonly businessStructures = BUSINESS_STRUCTURES;

  /** Signal propia porque `client` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isEditMode = signal(false);

  readonly clientType = signal<ClientType>('individual');

  // Shared fields
  readonly email = signal('');
  readonly phone = signal('');
  readonly isActive = signal(true);

  // Individual fields
  readonly firstName = signal('');
  readonly lastName = signal('');
  readonly ssnOrItin = signal('');
  readonly dateOfBirth = signal('');

  // Company fields
  readonly businessName = signal('');
  readonly ein = signal('');
  readonly formationDate = signal('');
  readonly businessStructure = signal<BusinessStructure>('LLC');
  readonly principalBusinessActivity = signal('');

  readonly isStructureOpen = signal(false);

  readonly isSaving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly canSave = computed(() => {
    if (!this.email().trim() || this.isSaving()) {
      return false;
    }
    return this.clientType() === 'individual'
      ? this.firstName().trim().length > 0 && this.lastName().trim().length > 0
      : this.businessName().trim().length > 0;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['client'] || changes['isOpen']) {
      this.isEditMode.set(this.client !== null);
      this.resetForm();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="client-structure"]')) {
      this.isStructureOpen.set(false);
    }
  }

  setClientType(type: ClientType): void {
    this.clientType.set(type);
  }

  toggleStructureDropdown(): void {
    this.isStructureOpen.update(open => !open);
  }

  selectBusinessStructure(structure: BusinessStructure): void {
    this.businessStructure.set(structure);
    this.isStructureOpen.set(false);
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    this.saveError.set(null);
    this.isSaving.set(true);

    const type = this.clientType();
    const options: ClientSaveOptions = {
      taxIdentifier: (type === 'individual' ? this.ssnOrItin() : this.ein()).trim(),
      subjectKind: type === 'individual' ? 'Individual' : 'Business',
      isActive: this.isActive(),
    };

    const request$ =
      this.isEditMode() && this.client
        ? this.store.updateClient(this.client.id, this.buildUpdateRequest(), options)
        : this.store.createClient(this.buildCreateRequest(), options);

    request$.subscribe({
      next: item => {
        this.isSaving.set(false);
        this.saved.emit(item);
      },
      error: err => {
        this.isSaving.set(false);
        this.saveError.set(toApiError(err).message);
      },
    });
  }

  private buildCreateRequest(): CreateCustomerRequest {
    const shared = {
      primaryEmail: this.email().trim(),
      primaryPhone: this.phone().trim() || null,
      language: 'En' as const,
      preferredChannel: 'Email' as const,
    };
    if (this.clientType() === 'individual') {
      return {
        ...shared,
        kind: 'Individual',
        firstName: this.firstName().trim(),
        lastName: this.lastName().trim(),
        dateOfBirth: this.dateOfBirth() || null,
      };
    }
    return {
      ...shared,
      kind: 'Business',
      legalName: this.businessName().trim(),
      businessStructure: BUSINESS_STRUCTURE_TO_API[this.businessStructure()],
      formationDate: this.formationDate() || null,
    };
  }

  private buildUpdateRequest(): UpdateCustomerRequest {
    const shared: UpdateCustomerRequest = {
      language: 'En',
      preferredChannel: 'Email',
      primaryEmail: this.email().trim(),
      primaryPhone: this.phone().trim() || null,
    };
    if (this.clientType() === 'individual') {
      return {
        ...shared,
        firstName: this.firstName().trim(),
        lastName: this.lastName().trim(),
        dateOfBirth: this.dateOfBirth() || null,
      };
    }
    return {
      ...shared,
      legalName: this.businessName().trim(),
      businessStructure: BUSINESS_STRUCTURE_TO_API[this.businessStructure()],
      formationDate: this.formationDate() || null,
    };
  }

  private resetForm(): void {
    const client = this.client;
    this.saveError.set(null);
    this.isStructureOpen.set(false);

    if (client) {
      this.clientType.set(client.type);
      this.email.set(client.email);
      this.phone.set(client.phone);
      this.isActive.set(client.isActive);

      const [first, ...rest] = client.displayName.split(' ');
      this.firstName.set(client.type === 'individual' ? (first ?? '') : '');
      this.lastName.set(client.type === 'individual' ? rest.join(' ') : '');
      this.ssnOrItin.set('');
      this.dateOfBirth.set('');

      this.businessName.set(client.type === 'company' ? client.displayName : '');
      this.ein.set('');
      this.formationDate.set('');
      this.businessStructure.set('LLC');
      this.principalBusinessActivity.set(client.company?.principalBusinessActivity ?? '');
    } else {
      this.clientType.set('individual');
      this.email.set('');
      this.phone.set('');
      this.isActive.set(true);
      this.firstName.set('');
      this.lastName.set('');
      this.ssnOrItin.set('');
      this.dateOfBirth.set('');
      this.businessName.set('');
      this.ein.set('');
      this.formationDate.set('');
      this.businessStructure.set('LLC');
      this.principalBusinessActivity.set('');
    }
  }
}
