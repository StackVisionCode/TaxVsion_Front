import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { TypeaheadComponent } from '@shared/ui/typeahead/typeahead.component';
import { formatPhoneForDisplay, isValidPhone } from '@shared/utils/phone.util';
import {
  ApiBusinessStructure,
  CustomerDetailResponse,
  CustomerLanguage,
  PreferredChannel,
} from '../../data-access/clients.model';
import {
  isFutureDate,
  isValidEmail,
  NAME_MAX_LENGTH,
  normalizeEmailToApi,
  serializeDateOnly,
  toApiPhoneUsDefault,
} from '../../utils/customer-form-normalizers';
import { ClientSectionId, ClientSectionPatch } from '../../utils/client-section-update';

/** Opción de catálogo (ocupación / actividad NAICS) para el typeahead. */
export interface SectionCatalogOption {
  id: string;
  label: string;
  hint?: string | null;
}

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

const HEADINGS: Record<ClientSectionId, { heading: string; subheading: string }> = {
  contact: { heading: 'Edit contact information', subheading: 'Email, phone and how this client prefers to be reached' },
  personal: { heading: 'Edit personal details', subheading: 'Name, date of birth and occupation' },
  business: { heading: 'Edit business details', subheading: 'Legal name, structure, formation date and activity' },
};

/**
 * Modal de edición POR SECCIÓN de la pestaña Info (Contact / Personal / Business): cada tarjeta
 * abre solo sus campos en vez del formulario completo.
 *
 * Presentacional: recibe el detalle recién leído (`detail`, null mientras carga) y emite
 * `save` con el patch de la sección; el contenedor (`client-profile-page`) re-lee el cliente y
 * fusiona el patch sobre él (`buildSectionUpdateRequest`) para que el PATCH no borre nada.
 *
 * Uso:
 * ```html
 * <app-client-section-edit-dialog [isOpen]="!!section()" [section]="section()" [detail]="detail()"
 *   [saving]="saving()" [error]="error()" [searchOccupations]="fn" [searchBusinessActivities]="fn"
 *   (save)="onSave($event)" (closed)="close()" />
 * ```
 */
@Component({
  selector: 'app-client-section-edit-dialog',
  imports: [CommonModule, FormsModule, ModalComponent, TypeaheadComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-section-edit-dialog.component.html',
})
export class ClientSectionEditDialogComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() section: ClientSectionId | null = null;
  /** Detalle fresco del cliente para precargar; null = cargando. */
  @Input() detail: CustomerDetailResponse | null = null;
  @Input() saving = false;
  @Input() error: string | null = null;
  @Input() searchOccupations: (q: string) => Observable<SectionCatalogOption[]> = () => new Observable();
  @Input() searchBusinessActivities: (q: string) => Observable<SectionCatalogOption[]> = () => new Observable();

  @Output() closed = new EventEmitter<void>();
  @Output() save = new EventEmitter<ClientSectionPatch>();

  readonly languages = LANGUAGES;
  readonly channels = CHANNELS;
  readonly structures = STRUCTURES;
  readonly nameMax = NAME_MAX_LENGTH;

  // Contacto
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
  // Negocio
  readonly legalName = signal('');
  /** '' = conservar la estructura actual (el detalle no la devuelve). */
  readonly structure = signal<ApiBusinessStructure | ''>('');
  readonly formationDate = signal('');
  readonly activityId = signal<string | null>(null);
  readonly activityName = signal<string | null>(null);

  readonly emailErr = signal<string | null>(null);
  readonly phoneErr = signal<string | null>(null);
  readonly nameErr = signal<string | null>(null);
  readonly dateErr = signal<string | null>(null);

  readonly catalogLabel = (option: SectionCatalogOption): string => option.label;
  readonly catalogId = (option: SectionCatalogOption): string => option.id;

  /** Sección vigente como signal (el @Input es plano). */
  private readonly sectionSig = signal<ClientSectionId | null>(null);
  readonly headings = computed(() => {
    const id = this.sectionSig();
    return id ? HEADINGS[id] : { heading: '', subheading: '' };
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['section']) {
      this.sectionSig.set(this.section);
    }
    if (changes['detail'] || changes['section'] || changes['isOpen']) {
      if (this.isOpen) {
        this.prefill();
      }
    }
  }

  private prefill(): void {
    const d = this.detail;
    this.emailErr.set(null);
    this.phoneErr.set(null);
    this.nameErr.set(null);
    this.dateErr.set(null);
    this.email.set(d?.primaryEmail ?? '');
    this.phone.set(d?.primaryPhone ? formatPhoneForDisplay(d.primaryPhone) : '');
    this.language.set(d?.language ?? 'En');
    this.preferredChannel.set(d?.preferredChannel ?? 'Email');
    this.firstName.set(d?.firstName ?? '');
    this.middleName.set(d?.middleName ?? '');
    this.lastName.set(d?.lastName ?? '');
    this.dateOfBirth.set(d?.dateOfBirth ?? '');
    this.occupationId.set(d?.occupationId ?? null);
    this.occupationName.set(d?.occupationName ?? null);
    this.legalName.set(d?.legalName ?? d?.displayName ?? '');
    this.structure.set('');
    this.formationDate.set('');
    this.activityId.set(d?.principalBusinessActivityId ?? null);
    this.activityName.set(d?.principalBusinessActivityName ?? null);
  }

  onOccupationPicked(option: SectionCatalogOption | null): void {
    this.occupationId.set(option?.id ?? null);
    this.occupationName.set(option?.label ?? null);
  }

  onActivityPicked(option: SectionCatalogOption | null): void {
    this.activityId.set(option?.id ?? null);
    this.activityName.set(option?.label ?? null);
  }

  onPhoneBlur(): void {
    const api = toApiPhoneUsDefault(this.phone());
    if (api && isValidPhone(api)) {
      this.phone.set(formatPhoneForDisplay(api));
      this.phoneErr.set(null);
    }
  }

  close(): void {
    this.closed.emit();
  }

  submit(): void {
    if (this.saving || !this.detail) {
      return;
    }
    const patch = this.buildPatch();
    if (patch) {
      this.save.emit(patch);
    }
  }

  /** Valida y arma el patch de la sección; null si hay errores (quedan pintados en el form). */
  buildPatch(): ClientSectionPatch | null {
    switch (this.section) {
      case 'contact': {
        const email = normalizeEmailToApi(this.email());
        const phone = toApiPhoneUsDefault(this.phone());
        this.emailErr.set(isValidEmail(email) ? null : 'Enter a valid email (max 254 characters).');
        this.phoneErr.set(
          phone && !isValidPhone(phone) ? 'Enter a valid phone number including country code.' : null,
        );
        if (this.emailErr() || this.phoneErr()) {
          return null;
        }
        return {
          section: 'contact',
          primaryEmail: email,
          primaryPhone: phone || null,
          language: this.language(),
          preferredChannel: this.preferredChannel(),
        };
      }
      case 'personal': {
        const first = this.firstName().trim();
        const last = this.lastName().trim();
        this.nameErr.set(first && last ? null : 'First and last name are required.');
        if (this.nameErr()) {
          return null;
        }
        return {
          section: 'personal',
          firstName: first,
          middleName: this.middleName().trim() || null,
          lastName: last,
          dateOfBirth: serializeDateOnly(this.dateOfBirth()),
          occupationId: this.occupationId(),
        };
      }
      case 'business': {
        const legal = this.legalName().trim();
        this.nameErr.set(legal ? null : 'Legal name is required.');
        this.dateErr.set(isFutureDate(this.formationDate()) ? 'Formation date can’t be in the future.' : null);
        if (this.nameErr() || this.dateErr()) {
          return null;
        }
        return {
          section: 'business',
          legalName: legal,
          businessStructure: this.structure() || null,
          formationDate: serializeDateOnly(this.formationDate()),
          principalBusinessActivityId: this.activityId(),
        };
      }
      default:
        return null;
    }
  }
}
