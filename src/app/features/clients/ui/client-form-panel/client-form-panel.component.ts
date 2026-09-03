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
import { Router } from '@angular/router';
import { Observable, map } from 'rxjs';
import { BusinessStructure, ClientItem, ClientType } from '../client-table/client-table.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { toApiError } from '@core/models/api-error.model';
import { ClientSaveOptions, ClientsStore } from '../../data-access/clients.store';
import { ClientsService } from '../../data-access/clients.service';
import { CatalogOption, CatalogPickerComponent } from '../catalog-picker/catalog-picker.component';
import {
  ApiBusinessStructure,
  CreateCustomerRequest,
  CustomerLanguage,
  PreferredChannel,
  UpdateCustomerRequest,
} from '../../data-access/clients.model';
import {
  formatEinForDisplay,
  formatPhoneForDisplay,
  formatSsnForDisplay,
  isFutureDate,
  isValidEmail,
  isValidPhone,
  isValidTaxIdentifier,
  NAME_MAX_LENGTH,
  normalizeEmailToApi,
  normalizePhoneToApi,
  serializeDateOnly,
  taxIdentifierDigits,
} from '../../utils/customer-form-normalizers';

const BUSINESS_STRUCTURES: BusinessStructure[] = ['LLC', 'S-Corp', 'C-Corp', 'Partnership', 'Sole Proprietorship'];

const BUSINESS_STRUCTURE_TO_API: Record<BusinessStructure, ApiBusinessStructure> = {
  LLC: 'Llc',
  'S-Corp': 'SCorp',
  'C-Corp': 'CCorp',
  Partnership: 'Partnership',
  'Sole Proprietorship': 'SoleProprietorship',
};

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

interface DuplicateMatch {
  existingId: string | null;
  existingName: string;
  matchedBy: string;
}

/**
 * Overlay de creación/edición. Mantiene el look pill del original y suma el pipeline de
 * Value Objects real (phone E.164, email, tax id 9 dígitos, DateOnly) con validación
 * inline accesible, selección de idioma/canal, y el flujo de duplicados del backend
 * (check-exists preflight → 409 Customer.DuplicateFound → abrir existente / sobrescribir).
 * Tras crear, navega al Client 360 sin recargar.
 */
@Component({
  selector: 'app-client-form-panel',
  imports: [CommonModule, FormsModule, ModalComponent, CatalogPickerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-form-panel.component.html',
  styleUrl: './client-form-panel.component.css',
})
export class ClientFormPanelComponent implements OnChanges {
  private readonly store = inject(ClientsStore);
  private readonly clientsService = inject(ClientsService);
  private readonly router = inject(Router);

  @Input() isOpen = false;
  @Input() client: ClientItem | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<ClientItem>();

  readonly businessStructures = BUSINESS_STRUCTURES;
  readonly languages = LANGUAGES;
  readonly channels = CHANNELS;
  readonly nameMax = NAME_MAX_LENGTH;

  readonly isEditMode = signal(false);
  readonly clientType = signal<ClientType>('individual');

  // Shared
  readonly email = signal('');
  readonly phone = signal('');
  readonly language = signal<CustomerLanguage>('En');
  readonly preferredChannel = signal<PreferredChannel>('Email');
  readonly isActive = signal(true);

  // Individual
  readonly firstName = signal('');
  readonly middleName = signal('');
  readonly lastName = signal('');
  readonly ssnOrItin = signal('');
  readonly dateOfBirth = signal('');
  readonly occupationId = signal<string | null>(null);
  readonly occupationName = signal<string | null>(null);

  // Company
  readonly businessName = signal('');
  readonly ein = signal('');
  readonly formationDate = signal('');
  readonly businessStructure = signal<BusinessStructure>('LLC');
  readonly businessActivityId = signal<string | null>(null);
  readonly businessActivityName = signal<string | null>(null);

  /** Búsqueda del catálogo de ocupaciones para el picker (arrow property = `this` estable). */
  readonly searchOccupations = (q: string): Observable<CatalogOption[]> =>
    this.clientsService.listOccupations(q).pipe(map(list => list.map(o => ({ id: o.id, label: o.name }))));

  /** Búsqueda del catálogo NAICS para el picker (label = descripción, hint = código). */
  readonly searchBusinessActivities = (q: string): Observable<CatalogOption[]> =>
    this.clientsService
      .listBusinessActivities(q)
      .pipe(map(list => list.map(a => ({ id: a.id, label: a.description, hint: a.naicsCode }))));

  readonly isStructureOpen = signal(false);
  readonly isSaving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly attempted = signal(false);

  // Errores de campo (se muestran tras intentar guardar o al salir del campo).
  readonly emailErr = signal<string | null>(null);
  readonly phoneErr = signal<string | null>(null);
  readonly firstErr = signal<string | null>(null);
  readonly lastErr = signal<string | null>(null);
  readonly bizErr = signal<string | null>(null);
  readonly taxErr = signal<string | null>(null);
  readonly formationErr = signal<string | null>(null);

  // Flujo de duplicados.
  readonly duplicate = signal<DuplicateMatch | null>(null);
  readonly confirmingOverwrite = signal(false);

  readonly canSave = computed(() => {
    if (!this.email().trim() || this.isSaving()) {
      return false;
    }
    return this.clientType() === 'individual'
      ? this.firstName().trim().length > 0 && this.lastName().trim().length > 0
      : this.businessName().trim().length > 0;
  });

  readonly heading = computed(() => {
    if (this.confirmingOverwrite()) return 'Update existing client?';
    if (this.duplicate()) return 'Possible duplicate found';
    return this.isEditMode() ? 'Edit Client' : 'New Client';
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['client'] || changes['isOpen']) {
      this.isEditMode.set(this.client !== null);
      this.resetForm();
      if (this.isOpen && this.client) {
        this.prefillFromDetail(this.client.id);
      }
    }
  }

  /**
   * En edición, precarga desde GET /customers/{id} los escalares que el listado NO trae
   * (idioma y canal preferido) para no resetearlos a En/Email al guardar. El detalle no
   * devuelve name-parts/DOB/estructura, así que esos siguen viniendo del displayName /
   * quedan en blanco (que en PATCH = "no tocar" para DOB).
   */
  private prefillFromDetail(id: string): void {
    this.store.getById(id).subscribe({
      next: detail => {
        this.language.set(detail.language);
        this.preferredChannel.set(detail.preferredChannel);
        if (detail.dateOfBirth) {
          this.dateOfBirth.set(detail.dateOfBirth);
        }
        // Partes del nombre reales del detalle: sobrescriben el split lossy de resetForm, para que
        // guardar no corrompa el nombre (el middle se preservaba y el last se duplicaba).
        if (detail.kind === 'Individual') {
          this.firstName.set(detail.firstName ?? '');
          this.middleName.set(detail.middleName ?? '');
          this.lastName.set(detail.lastName ?? '');
        } else if (detail.legalName) {
          this.businessName.set(detail.legalName);
        }
        this.occupationId.set(detail.occupationId);
        this.occupationName.set(detail.occupationName);
        this.businessActivityId.set(detail.principalBusinessActivityId);
        this.businessActivityName.set(detail.principalBusinessActivityName);
      },
      error: () => undefined,
    });
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

  onOccupationPicked(option: CatalogOption | null): void {
    this.occupationId.set(option?.id ?? null);
    this.occupationName.set(option?.label ?? null);
  }

  onBusinessActivityPicked(option: CatalogOption | null): void {
    this.businessActivityId.set(option?.id ?? null);
    this.businessActivityName.set(option?.label ?? null);
  }

  // ---------- Formateo mientras se escribe / al salir ----------

  onSsnInput(value: string): void {
    this.ssnOrItin.set(formatSsnForDisplay(value));
    this.taxErr.set(null);
  }

  onEinInput(value: string): void {
    this.ein.set(formatEinForDisplay(value));
    this.taxErr.set(null);
  }

  onPhoneBlur(): void {
    const raw = this.phone().trim();
    if (raw) {
      const api = this.toApiPhone(raw);
      if (isValidPhone(api)) {
        this.phone.set(formatPhoneForDisplay(api));
      }
    }
    this.validatePhone();
  }

  /**
   * Normaliza a E.164 con la MISMA conveniencia US del worker de import
   * (IdentifierNormalizer): 10 dígitos → +1XXXXXXXXXX, 11 con prefijo 1 → +.
   * Con país explícito respeta el VO estricto; sin país queda tal cual y la
   * validación lo marca (el VO de create no auto-agrega país).
   */
  private toApiPhone(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('+')) return normalizePhoneToApi(trimmed);
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return normalizePhoneToApi(trimmed);
  }

  // ---------- Validación por campo ----------

  validateEmail(): void {
    const v = this.email().trim();
    this.emailErr.set(v && !isValidEmail(v) ? 'Enter a valid email (max 254 characters).' : null);
  }

  validatePhone(): void {
    const v = this.phone().trim();
    this.phoneErr.set(v && !isValidPhone(this.toApiPhone(v)) ? 'Enter a valid phone number including country code.' : null);
  }

  private validateForm(): boolean {
    const type = this.clientType();
    this.firstErr.set(null);
    this.lastErr.set(null);
    this.bizErr.set(null);
    this.formationErr.set(null);
    this.taxErr.set(null);

    let ok = true;
    if (type === 'individual') {
      if (!this.firstName().trim()) {
        this.firstErr.set('First name is required.');
        ok = false;
      }
      if (!this.lastName().trim()) {
        this.lastErr.set('Last name is required.');
        ok = false;
      }
    } else if (!this.businessName().trim()) {
      this.bizErr.set('Legal name is required.');
      ok = false;
    }

    const emailVal = this.email().trim();
    if (!isValidEmail(emailVal)) {
      this.emailErr.set('Enter a valid email (max 254 characters).');
      ok = false;
    } else {
      this.emailErr.set(null);
    }

    if (this.phone().trim() && !isValidPhone(this.toApiPhone(this.phone()))) {
      this.phoneErr.set('Enter a valid phone number including country code.');
      ok = false;
    } else {
      this.phoneErr.set(null);
    }

    const taxRaw = type === 'individual' ? this.ssnOrItin() : this.ein();
    if (taxRaw.trim()) {
      const subjectKind = type === 'individual' ? 'Individual' : 'Business';
      if (!isValidTaxIdentifier(taxRaw, subjectKind)) {
        this.taxErr.set(
          subjectKind === 'Individual'
            ? 'Enter a valid 9-digit SSN/ITIN (can’t start with 000 or 666).'
            : 'Enter a valid 9-digit EIN.',
        );
        ok = false;
      }
    }

    if (type === 'company' && this.formationDate() && isFutureDate(this.formationDate())) {
      this.formationErr.set('Formation date can’t be in the future.');
      ok = false;
    }

    return ok;
  }

  close(): void {
    this.closed.emit();
  }

  // ---------- Guardado ----------

  save(): void {
    if (this.isSaving()) return;
    this.attempted.set(true);
    this.saveError.set(null);
    if (!this.validateForm()) return;

    if (this.isEditMode() && this.client) {
      this.runSave(this.store.updateClient(this.client.id, this.buildUpdateRequest(), this.buildOptions()), false);
      return;
    }

    // Crear: preflight check-exists (email siempre presente; tax id solo si son 9 dígitos).
    this.isSaving.set(true);
    const email = normalizeEmailToApi(this.email());
    const taxDigits = taxIdentifierDigits(this.clientType() === 'individual' ? this.ssnOrItin() : this.ein());
    const taxId = taxDigits.length === 9 ? taxDigits : undefined;
    this.store.checkExists(email, taxId).subscribe({
      next: res => {
        if (res.existingCustomerId) {
          this.isSaving.set(false);
          this.duplicate.set({
            existingId: res.existingCustomerId,
            existingName: '',
            matchedBy: res.emailExists ? 'email' : 'tax identifier',
          });
        } else {
          this.doCreate(false);
        }
      },
      error: () => this.doCreate(false), // preflight best-effort; el POST es la autoridad
    });
  }

  private doCreate(overwrite: boolean): void {
    this.runSave(this.store.createClient(this.buildCreateRequest(overwrite), this.buildOptions()), true);
  }

  private runSave(request$: ReturnType<ClientsStore['createClient']>, isCreate: boolean): void {
    this.isSaving.set(true);
    this.saveError.set(null);
    request$.subscribe({
      next: item => {
        this.isSaving.set(false);
        this.saved.emit(item);
        if (isCreate) {
          this.router.navigate(['/clients', item.id]);
        }
      },
      error: err => {
        this.isSaving.set(false);
        const e = toApiError(err);
        if (e.code === 'Customer.DuplicateFound') {
          this.duplicate.set(this.parseDuplicate(e.message));
        } else if (e.code === 'Customer.EmailAlreadyInUse') {
          this.emailErr.set('This email already belongs to another client.');
        } else {
          this.saveError.set(this.humanize(e.code, e.message));
        }
      },
    });
  }

  // ---------- Duplicados ----------

  private parseDuplicate(message: string): DuplicateMatch {
    const idMatch = message.match(/\(([0-9a-fA-F-]{36})\)/);
    const nameMatch = message.match(/:\s*(.+?)\s*\([0-9a-fA-F-]{36}\)/);
    const byMatch = message.match(/matching by (.+?) already/i);
    return {
      existingId: idMatch ? idMatch[1] : null,
      existingName: nameMatch ? nameMatch[1] : '',
      matchedBy: byMatch ? byMatch[1] : 'the details you entered',
    };
  }

  openExisting(): void {
    const id = this.duplicate()?.existingId;
    if (id) {
      this.router.navigate(['/clients', id]);
    }
  }

  startOverwrite(): void {
    this.confirmingOverwrite.set(true);
  }

  confirmOverwrite(): void {
    this.confirmingOverwrite.set(false);
    this.duplicate.set(null);
    this.doCreate(true);
  }

  cancelDuplicate(): void {
    this.duplicate.set(null);
    this.confirmingOverwrite.set(false);
  }

  // ---------- Mappers ----------

  private buildOptions(): ClientSaveOptions {
    const type = this.clientType();
    return {
      taxIdentifier: taxIdentifierDigits(type === 'individual' ? this.ssnOrItin() : this.ein()),
      subjectKind: type === 'individual' ? 'Individual' : 'Business',
      isActive: this.isActive(),
    };
  }

  private buildCreateRequest(overwrite: boolean): CreateCustomerRequest {
    const shared = {
      primaryEmail: normalizeEmailToApi(this.email()),
      primaryPhone: this.phone().trim() ? this.toApiPhone(this.phone()) : null,
      language: this.language(),
      preferredChannel: this.preferredChannel(),
      overwrite,
    };
    if (this.clientType() === 'individual') {
      return {
        ...shared,
        kind: 'Individual',
        firstName: this.firstName().trim(),
        middleName: this.middleName().trim() || null,
        lastName: this.lastName().trim(),
        dateOfBirth: serializeDateOnly(this.dateOfBirth()),
        occupationId: this.occupationId(),
      };
    }
    return {
      ...shared,
      kind: 'Business',
      legalName: this.businessName().trim(),
      businessStructure: BUSINESS_STRUCTURE_TO_API[this.businessStructure()],
      formationDate: serializeDateOnly(this.formationDate()),
      principalBusinessActivityId: this.businessActivityId(),
    };
  }

  private buildUpdateRequest(): UpdateCustomerRequest {
    const shared: UpdateCustomerRequest = {
      language: this.language(),
      preferredChannel: this.preferredChannel(),
      primaryEmail: normalizeEmailToApi(this.email()),
      primaryPhone: this.phone().trim() ? this.toApiPhone(this.phone()) : null,
    };
    if (this.clientType() === 'individual') {
      return {
        ...shared,
        firstName: this.firstName().trim(),
        middleName: this.middleName().trim() || null,
        lastName: this.lastName().trim(),
        dateOfBirth: serializeDateOnly(this.dateOfBirth()),
        occupationId: this.occupationId(),
      };
    }
    return {
      ...shared,
      legalName: this.businessName().trim(),
      businessStructure: BUSINESS_STRUCTURE_TO_API[this.businessStructure()],
      formationDate: serializeDateOnly(this.formationDate()),
      principalBusinessActivityId: this.businessActivityId(),
    };
  }

  private humanize(code: string, backendMessage: string): string {
    switch (code) {
      case 'Customer.PersonalName':
        return 'Check the client’s first and last name.';
      case 'Customer.BusinessStructure':
        return 'Pick a business structure.';
      case 'FiscalProfile.TaxId':
        return 'The tax identifier isn’t valid.';
      case 'Network.Unreachable':
        return 'We couldn’t reach the server. Please try again.';
      default:
        // El backend ya manda texto en inglés y sin datos sensibles para estos casos.
        return backendMessage;
    }
  }

  private resetForm(): void {
    const client = this.client;
    this.saveError.set(null);
    this.isStructureOpen.set(false);
    this.attempted.set(false);
    this.duplicate.set(null);
    this.confirmingOverwrite.set(false);
    this.emailErr.set(null);
    this.phoneErr.set(null);
    this.firstErr.set(null);
    this.lastErr.set(null);
    this.bizErr.set(null);
    this.taxErr.set(null);
    this.formationErr.set(null);
    this.language.set('En');
    this.preferredChannel.set('Email');
    this.middleName.set('');
    this.occupationId.set(null);
    this.occupationName.set(null);
    this.businessActivityId.set(null);
    this.businessActivityName.set(null);

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
    }
  }
}
