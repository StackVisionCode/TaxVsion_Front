import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { CatalogOption, CatalogPickerComponent } from '../catalog-picker/catalog-picker.component';
import { ApiBusinessStructure, CustomerLanguage, PreferredChannel } from '../../data-access/clients.model';
import {
  ClientEditSection,
  ClientSectionDraft,
  SECTION_HEADINGS,
} from '../../data-access/client-section-edit.model';
import {
  formatPhoneForDisplay,
  isFutureDate,
  isValidEmail,
  isValidPhone,
  NAME_MAX_LENGTH,
  normalizeEmailToApi,
  toApiPhoneWithUsDefault,
} from '../../utils/customer-form-normalizers';

const LANGUAGES: { value: CustomerLanguage; label: string }[] = [
  { value: 'En', label: 'English' },
  { value: 'Es', label: 'Spanish' },
  { value: 'Pt', label: 'Portuguese' },
  { value: 'Fr', label: 'French' },
];

const CHANNELS: { value: PreferredChannel; label: string }[] = [
  { value: 'Email', label: 'Email' },
  { value: 'Sms', label: 'SMS' },
  { value: 'Call', label: 'Phone call' },
];

const STRUCTURES: { value: ApiBusinessStructure; label: string }[] = [
  { value: 'Llc', label: 'LLC' },
  { value: 'SCorp', label: 'S-Corp' },
  { value: 'CCorp', label: 'C-Corp' },
  { value: 'Partnership', label: 'Partnership' },
  { value: 'SoleProprietorship', label: 'Sole Proprietorship' },
  { value: 'NonProfit', label: 'Non-profit' },
  { value: 'Other', label: 'Other' },
];

/**
 * Modal de edición POR SECCIÓN de la pestaña Info (Contact / Personal / Business). Cada sección
 * muestra solo sus campos; el contenedor precarga el borrador desde el detalle real y, al guardar,
 * fusiona la sección con el detalle actual antes del PATCH (ver `client-section-edit.model.ts`).
 *
 * Presentacional puro: recibe el borrador inicial y los buscadores de catálogo, emite el borrador
 * validado. Nada de HTTP aquí.
 */
@Component({
  selector: 'app-client-section-edit-dialog',
  imports: [CommonModule, FormsModule, ModalComponent, CatalogPickerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-section-edit-dialog.component.html',
})
export class ClientSectionEditDialogComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() section: ClientEditSection = 'contact';
  /** Borrador precargado desde el detalle; null mientras se lee. */
  @Input() initial: ClientSectionDraft | null = null;
  @Input() loading = false;
  @Input() saving = false;
  @Input() error: string | null = null;
  @Input() searchOccupations: ((q: string) => Observable<CatalogOption[]>) | null = null;
  @Input() searchBusinessActivities: ((q: string) => Observable<CatalogOption[]>) | null = null;

  @Output() save = new EventEmitter<ClientSectionDraft>();
  @Output() closed = new EventEmitter<void>();

  readonly languages = LANGUAGES;
  readonly channels = CHANNELS;
  readonly structures = STRUCTURES;
  readonly nameMax = NAME_MAX_LENGTH;

  // Contact
  readonly email = signal('');
  readonly phone = signal('');
  readonly language = signal<CustomerLanguage>('En');
  readonly preferredChannel = signal<PreferredChannel>('Email');
  // Personal
  readonly firstName = signal('');
  readonly middleName = signal('');
  readonly lastName = signal('');
  readonly dateOfBirth = signal('');
  readonly occupationId = signal<string | null>(null);
  readonly occupationName = signal<string | null>(null);
  // Business
  readonly legalName = signal('');
  readonly businessStructure = signal<ApiBusinessStructure | ''>('');
  readonly formationDate = signal('');
  readonly activityId = signal<string | null>(null);
  readonly activityName = signal<string | null>(null);

  readonly errors = signal<Record<string, string>>({});

  get heading(): string {
    return SECTION_HEADINGS[this.section].heading;
  }

  get subheading(): string {
    return SECTION_HEADINGS[this.section].subheading;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initial'] || changes['isOpen']) {
      this.errors.set({});
      this.prefill(this.initial);
    }
  }

  private prefill(draft: ClientSectionDraft | null): void {
    if (!draft) {
      return;
    }
    switch (draft.section) {
      case 'contact':
        this.email.set(draft.email);
        this.phone.set(draft.phone ? formatPhoneForDisplay(draft.phone) : '');
        this.language.set(draft.language);
        this.preferredChannel.set(draft.preferredChannel);
        break;
      case 'personal':
        this.firstName.set(draft.firstName);
        this.middleName.set(draft.middleName);
        this.lastName.set(draft.lastName);
        this.dateOfBirth.set(draft.dateOfBirth);
        this.occupationId.set(draft.occupationId);
        this.occupationName.set(draft.occupationName);
        break;
      case 'business':
        this.legalName.set(draft.legalName);
        this.businessStructure.set(draft.businessStructure ?? '');
        this.formationDate.set(draft.formationDate);
        this.activityId.set(draft.principalBusinessActivityId);
        this.activityName.set(draft.principalBusinessActivityName);
        break;
    }
  }

  err(field: string): string | null {
    return this.errors()[field] ?? null;
  }

  clearErr(field: string): void {
    if (this.errors()[field]) {
      const next = { ...this.errors() };
      delete next[field];
      this.errors.set(next);
    }
  }

  onOccupationPicked(option: CatalogOption | null): void {
    this.occupationId.set(option?.id ?? null);
    this.occupationName.set(option?.label ?? null);
  }

  onActivityPicked(option: CatalogOption | null): void {
    this.activityId.set(option?.id ?? null);
    this.activityName.set(option?.label ?? null);
  }

  submit(): void {
    if (this.saving || this.loading || !this.initial) {
      return;
    }
    const draft = this.buildDraft();
    if (draft) {
      this.save.emit(draft);
    }
  }

  /** Valida y arma el borrador; null si hay errores (quedan en `errors`). */
  private buildDraft(): ClientSectionDraft | null {
    const errors: Record<string, string> = {};
    let draft: ClientSectionDraft;
    switch (this.section) {
      case 'contact': {
        const email = normalizeEmailToApi(this.email());
        const phone = toApiPhoneWithUsDefault(this.phone());
        if (!isValidEmail(email)) {
          errors['email'] = 'Enter a valid email (max 254 characters).';
        }
        if (phone && !isValidPhone(phone)) {
          errors['phone'] = 'Enter a valid phone number including country code.';
        }
        draft = {
          section: 'contact',
          email,
          phone,
          language: this.language(),
          preferredChannel: this.preferredChannel(),
        };
        break;
      }
      case 'personal': {
        if (!this.firstName().trim()) {
          errors['firstName'] = 'First name is required.';
        }
        if (!this.lastName().trim()) {
          errors['lastName'] = 'Last name is required.';
        }
        if (this.dateOfBirth() && isFutureDate(this.dateOfBirth())) {
          errors['dateOfBirth'] = 'Date of birth can’t be in the future.';
        }
        draft = {
          section: 'personal',
          firstName: this.firstName(),
          middleName: this.middleName(),
          lastName: this.lastName(),
          dateOfBirth: this.dateOfBirth(),
          occupationId: this.occupationId(),
          occupationName: this.occupationName(),
        };
        break;
      }
      case 'business': {
        if (!this.legalName().trim()) {
          errors['legalName'] = 'Legal name is required.';
        }
        if (this.formationDate() && isFutureDate(this.formationDate())) {
          errors['formationDate'] = 'Formation date can’t be in the future.';
        }
        draft = {
          section: 'business',
          legalName: this.legalName(),
          businessStructure: this.businessStructure() || null,
          formationDate: this.formationDate(),
          principalBusinessActivityId: this.activityId(),
          principalBusinessActivityName: this.activityName(),
        };
        break;
      }
    }
    this.errors.set(errors);
    return Object.keys(errors).length === 0 ? draft : null;
  }

  close(): void {
    this.closed.emit();
  }
}
