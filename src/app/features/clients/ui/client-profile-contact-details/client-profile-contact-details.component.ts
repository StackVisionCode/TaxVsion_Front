import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import {
  AddAddressRequest,
  AddContactPointRequest,
  AddressKind,
  AddressResponse,
  ContactPointResponse,
  ContactPointType,
} from '../../data-access/clients.model';
import {
  COUNTRY_CODE_LENGTH,
  formatPhoneForDisplay,
  isValidEmail,
  isValidPhone,
  normalizeEmailToApi,
  normalizePhoneToApi,
} from '../../utils/customer-form-normalizers';

export interface SaveAddressPayload {
  id: string | null;
  req: AddAddressRequest;
}
export interface SaveContactPayload {
  id: string | null;
  req: AddContactPointRequest;
}

/** value = enum exacto del backend (incluye el typo real `HomeOoffice`); label = humano. */
const ADDRESS_KINDS: { value: AddressKind; label: string }[] = [
  { value: 'Home', label: 'Home' },
  { value: 'Mailing', label: 'Mailing' },
  { value: 'Business', label: 'Business' },
  { value: 'Billing', label: 'Billing' },
  { value: 'Shipping', label: 'Shipping' },
  { value: 'Seasonal', label: 'Seasonal' },
  { value: 'Previous', label: 'Previous' },
  { value: 'Foreign', label: 'Foreign' },
  { value: 'Legal', label: 'Legal' },
  { value: 'HomeOoffice', label: 'Home office' },
];

/**
 * Direcciones y puntos de contacto del cliente (CRUD real contra
 * /customers/{id}/addresses y /contact-points). Presentacional puro: las
 * escrituras las dispara el contenedor vía @Output, que tras el POST/PATCH/DELETE
 * recarga GET /customers/{id} (que SÍ devuelve estas colecciones) — sin refresh.
 * Value Objects respetados: address line1/city/postal requeridos, countryCode 2
 * letras; el valor de un contacto se valida como email o teléfono según su tipo.
 */
@Component({
  selector: 'app-client-profile-contact-details',
  imports: [CommonModule, FormsModule, ModalComponent, ConfirmDialogComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-contact-details.component.html',
  styleUrl: './client-profile-contact-details.component.css',
})
export class ClientProfileContactDetailsComponent {
  @Input() addresses: AddressResponse[] = [];
  @Input() contactPoints: ContactPointResponse[] = [];
  @Input() saving = false;

  @Output() saveAddress = new EventEmitter<SaveAddressPayload>();
  @Output() deleteAddress = new EventEmitter<string>();
  @Output() saveContact = new EventEmitter<SaveContactPayload>();
  @Output() deleteContact = new EventEmitter<string>();

  readonly addressKinds = ADDRESS_KINDS;

  // ---------- Address form ----------
  readonly addrOpen = signal(false);
  readonly addrEditingId = signal<string | null>(null);
  readonly addrKind = signal<AddressKind>('Home');
  readonly addrLine1 = signal('');
  readonly addrLine2 = signal('');
  readonly addrCity = signal('');
  readonly addrRegion = signal('');
  readonly addrPostal = signal('');
  readonly addrCountry = signal('US');
  readonly addrPrimary = signal(true);
  readonly addrErr = signal<string | null>(null);

  readonly canSaveAddr = computed(
    () =>
      this.addrLine1().trim().length > 0 &&
      this.addrCity().trim().length > 0 &&
      this.addrPostal().trim().length > 0 &&
      this.addrCountry().trim().length === COUNTRY_CODE_LENGTH,
  );

  // ---------- Contact form ----------
  readonly cpOpen = signal(false);
  readonly cpEditingId = signal<string | null>(null);
  readonly cpType = signal<ContactPointType>('Email');
  readonly cpValue = signal('');
  readonly cpLabel = signal('');
  readonly cpPrimary = signal(false);
  readonly cpErr = signal<string | null>(null);

  // ---------- Delete ----------
  readonly pendingDelete = signal<{ kind: 'address' | 'contact'; id: string; label: string } | null>(null);

  addressKindLabel(kind: AddressKind): string {
    return ADDRESS_KINDS.find(k => k.value === kind)?.label ?? kind;
  }

  contactDisplay(cp: ContactPointResponse): string {
    return cp.type === 'Phone' ? formatPhoneForDisplay(cp.value) : cp.value;
  }

  // ---------- Address actions ----------

  openAddAddress(): void {
    this.addrEditingId.set(null);
    this.addrKind.set('Home');
    this.addrLine1.set('');
    this.addrLine2.set('');
    this.addrCity.set('');
    this.addrRegion.set('');
    this.addrPostal.set('');
    this.addrCountry.set('US');
    this.addrPrimary.set(this.addresses.length === 0);
    this.addrErr.set(null);
    this.addrOpen.set(true);
  }

  openEditAddress(a: AddressResponse): void {
    this.addrEditingId.set(a.id);
    this.addrKind.set(a.kind);
    this.addrLine1.set(a.line1);
    this.addrLine2.set(a.line2 ?? '');
    this.addrCity.set(a.city);
    this.addrRegion.set(a.region ?? '');
    this.addrPostal.set(a.postalCode);
    this.addrCountry.set(a.countryCode);
    this.addrPrimary.set(a.isPrimary);
    this.addrErr.set(null);
    this.addrOpen.set(true);
  }

  submitAddress(): void {
    if (!this.canSaveAddr() || this.saving) return;
    const country = this.addrCountry().trim().toUpperCase();
    if (country.length !== COUNTRY_CODE_LENGTH) {
      this.addrErr.set('Country must be a 2-letter code (e.g. US).');
      return;
    }
    const req: AddAddressRequest = {
      kind: this.addrKind(),
      line1: this.addrLine1().trim(),
      line2: this.addrLine2().trim() || null,
      city: this.addrCity().trim(),
      region: this.addrRegion().trim() || null,
      postalCode: this.addrPostal().trim(),
      countryCode: country,
      isPrimary: this.addrPrimary(),
    };
    this.saveAddress.emit({ id: this.addrEditingId(), req });
    this.addrOpen.set(false);
  }

  // ---------- Contact actions ----------

  openAddContact(): void {
    this.cpEditingId.set(null);
    this.cpType.set('Email');
    this.cpValue.set('');
    this.cpLabel.set('');
    this.cpPrimary.set(false);
    this.cpErr.set(null);
    this.cpOpen.set(true);
  }

  openEditContact(cp: ContactPointResponse): void {
    this.cpEditingId.set(cp.id);
    this.cpType.set(cp.type);
    this.cpValue.set(cp.value);
    this.cpLabel.set(cp.label ?? '');
    this.cpPrimary.set(cp.isPrimary);
    this.cpErr.set(null);
    this.cpOpen.set(true);
  }

  submitContact(): void {
    if (this.saving) return;
    const type = this.cpType();
    const raw = this.cpValue().trim();
    const ok = type === 'Email' ? isValidEmail(raw) : isValidPhone(raw);
    if (!ok) {
      this.cpErr.set(type === 'Email' ? 'Enter a valid email.' : 'Enter a valid phone number with country code.');
      return;
    }
    const req: AddContactPointRequest = {
      type,
      value: type === 'Email' ? normalizeEmailToApi(raw) : normalizePhoneToApi(raw),
      label: this.cpLabel().trim() || null,
      isPrimary: this.cpPrimary(),
    };
    this.saveContact.emit({ id: this.cpEditingId(), req });
    this.cpOpen.set(false);
  }

  // ---------- Delete ----------

  requestDeleteAddress(a: AddressResponse): void {
    this.pendingDelete.set({ kind: 'address', id: a.id, label: `${a.line1}, ${a.city}` });
  }

  requestDeleteContact(cp: ContactPointResponse): void {
    this.pendingDelete.set({ kind: 'contact', id: cp.id, label: this.contactDisplay(cp) });
  }

  confirmDelete(): void {
    const pending = this.pendingDelete();
    if (!pending) return;
    if (pending.kind === 'address') {
      this.deleteAddress.emit(pending.id);
    } else {
      this.deleteContact.emit(pending.id);
    }
    this.pendingDelete.set(null);
  }

  cancelDelete(): void {
    this.pendingDelete.set(null);
  }
}
