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
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BusinessStructure,
  ClientItem,
  ClientType,
  MaritalStatus,
  Occupation,
} from '../client-table/client-table.component';

const OCCUPATIONS: Occupation[] = [
  'Accountant',
  'Engineer',
  'Teacher',
  'Nurse',
  'Sales Representative',
  'Software Developer',
  'Business Owner',
  'Retired',
];

const MARITAL_STATUSES: MaritalStatus[] = ['Single', 'Married', 'Divorced', 'Widowed'];

const BUSINESS_STRUCTURES: BusinessStructure[] = ['LLC', 'S-Corp', 'C-Corp', 'Partnership', 'Sole Proprietorship'];

let clientSeq = 0;
/** Genera un id local único para un nuevo cliente (sin backend). */
function nextClientId(): string {
  clientSeq += 1;
  return `client-${Date.now()}-${clientSeq}`;
}

/**
 * Overlay de creación/edición del directorio de clientes (mismo patrón que
 * task-create-panel/invoice-form-panel): tarjeta centrada `rounded-[28px]`
 * sobre backdrop con stopPropagation, ampliada a `max-w-2xl` y con scroll
 * interno. Un único componente cubre ambos modos: si `client` llega con
 * datos precarga el formulario y actúa como edición ("Edit Client" / "Save
 * changes"); si es null arranca vacío ("New Client" / "Create client").
 * `isEditMode` es una signal propia actualizada en ngOnChanges, no un
 * computed() sobre el @Input (que no reaccionaría a sus cambios). Un toggle
 * de píldoras Individual/Company arriba del formulario condiciona qué
 * campos se muestran debajo, sin ser un wizard por pasos. Los selectores de
 * ocupación/estado civil/estructura de negocio son dropdowns propios
 * (patrón task-create-panel) que se cierran al hacer click fuera.
 */
@Component({
  selector: 'app-client-form-panel',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-form-panel.component.html',
})
export class ClientFormPanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() client: ClientItem | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<ClientItem>();

  readonly occupations = OCCUPATIONS;
  readonly maritalStatuses = MARITAL_STATUSES;
  readonly businessStructures = BUSINESS_STRUCTURES;

  /** Signal propia porque `client` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isEditMode = signal(false);

  readonly clientType = signal<ClientType>('individual');

  // Shared fields
  readonly email = signal('');
  readonly phone = signal('');
  readonly address = signal('');
  readonly isActive = signal(true);

  // Individual fields
  readonly firstName = signal('');
  readonly lastName = signal('');
  readonly ssnOrItin = signal('');
  readonly dateOfBirth = signal('');
  readonly occupation = signal<Occupation>('Accountant');
  readonly maritalStatus = signal<MaritalStatus>('Single');

  // Company fields
  readonly businessName = signal('');
  readonly ein = signal('');
  readonly formationDate = signal('');
  readonly businessStructure = signal<BusinessStructure>('LLC');
  readonly principalBusinessActivity = signal('');

  readonly isOccupationOpen = signal(false);
  readonly isMaritalOpen = signal(false);
  readonly isStructureOpen = signal(false);

  readonly canSave = computed(() => {
    if (!this.email().trim()) {
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
    if (!target.closest('[data-dropdown="client-occupation"]')) {
      this.isOccupationOpen.set(false);
    }
    if (!target.closest('[data-dropdown="client-marital"]')) {
      this.isMaritalOpen.set(false);
    }
    if (!target.closest('[data-dropdown="client-structure"]')) {
      this.isStructureOpen.set(false);
    }
  }

  setClientType(type: ClientType): void {
    this.clientType.set(type);
  }

  toggleOccupationDropdown(): void {
    const next = !this.isOccupationOpen();
    this.closeAllDropdowns();
    this.isOccupationOpen.set(next);
  }

  toggleMaritalDropdown(): void {
    const next = !this.isMaritalOpen();
    this.closeAllDropdowns();
    this.isMaritalOpen.set(next);
  }

  toggleStructureDropdown(): void {
    const next = !this.isStructureOpen();
    this.closeAllDropdowns();
    this.isStructureOpen.set(next);
  }

  selectOccupation(occupation: Occupation): void {
    this.occupation.set(occupation);
    this.isOccupationOpen.set(false);
  }

  selectMaritalStatus(status: MaritalStatus): void {
    this.maritalStatus.set(status);
    this.isMaritalOpen.set(false);
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
    const type = this.clientType();
    const result: ClientItem =
      type === 'individual'
        ? {
            id: this.client?.id ?? nextClientId(),
            type: 'individual',
            displayName: `${this.firstName().trim()} ${this.lastName().trim()}`.trim(),
            email: this.email().trim(),
            phone: this.phone().trim(),
            address: this.address().trim(),
            isActive: this.isActive(),
            createdAt: this.client?.createdAt ?? new Date().toISOString().slice(0, 10),
            individual: {
              ssnOrItin: this.ssnOrItin().trim(),
              dateOfBirth: this.dateOfBirth(),
              occupation: this.occupation(),
              maritalStatus: this.maritalStatus(),
            },
          }
        : {
            id: this.client?.id ?? nextClientId(),
            type: 'company',
            displayName: this.businessName().trim(),
            email: this.email().trim(),
            phone: this.phone().trim(),
            address: this.address().trim(),
            isActive: this.isActive(),
            createdAt: this.client?.createdAt ?? new Date().toISOString().slice(0, 10),
            company: {
              ein: this.ein().trim(),
              formationDate: this.formationDate(),
              businessStructure: this.businessStructure(),
              principalBusinessActivity: this.principalBusinessActivity().trim(),
            },
          };
    this.saved.emit(result);
  }

  private closeAllDropdowns(): void {
    this.isOccupationOpen.set(false);
    this.isMaritalOpen.set(false);
    this.isStructureOpen.set(false);
  }

  private resetForm(): void {
    const client = this.client;
    if (client) {
      this.clientType.set(client.type);
      this.email.set(client.email);
      this.phone.set(client.phone);
      this.address.set(client.address);
      this.isActive.set(client.isActive);

      if (client.type === 'individual' && client.individual) {
        const [first, ...rest] = client.displayName.split(' ');
        this.firstName.set(first ?? '');
        this.lastName.set(rest.join(' '));
        this.ssnOrItin.set(client.individual.ssnOrItin);
        this.dateOfBirth.set(client.individual.dateOfBirth.slice(0, 10));
        this.occupation.set(client.individual.occupation);
        this.maritalStatus.set(client.individual.maritalStatus);
      } else {
        this.firstName.set('');
        this.lastName.set('');
        this.ssnOrItin.set('');
        this.dateOfBirth.set('');
        this.occupation.set('Accountant');
        this.maritalStatus.set('Single');
      }

      if (client.type === 'company' && client.company) {
        this.businessName.set(client.displayName);
        this.ein.set(client.company.ein);
        this.formationDate.set(client.company.formationDate.slice(0, 10));
        this.businessStructure.set(client.company.businessStructure);
        this.principalBusinessActivity.set(client.company.principalBusinessActivity);
      } else {
        this.businessName.set('');
        this.ein.set('');
        this.formationDate.set('');
        this.businessStructure.set('LLC');
        this.principalBusinessActivity.set('');
      }
    } else {
      this.clientType.set('individual');
      this.email.set('');
      this.phone.set('');
      this.address.set('');
      this.isActive.set(true);
      this.firstName.set('');
      this.lastName.set('');
      this.ssnOrItin.set('');
      this.dateOfBirth.set('');
      this.occupation.set('Accountant');
      this.maritalStatus.set('Single');
      this.businessName.set('');
      this.ein.set('');
      this.formationDate.set('');
      this.businessStructure.set('LLC');
      this.principalBusinessActivity.set('');
    }
    this.closeAllDropdowns();
  }
}
