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
import { ModalComponent } from '@shared/ui/modal/modal.component';
import {
  AddRelationRequest,
  CustomerFiscalProfileResponse,
  FiscalSubjectKind,
  RelationPurpose,
  RelationResponse,
  SetCustomerFiscalProfileRequest,
} from '../../data-access/clients.model';
import {
  formatEinForDisplay,
  formatSsnForDisplay,
  isValidEmail,
  isValidPhone,
  isValidTaxIdentifier,
  normalizeEmailToApi,
  normalizePhoneToApi,
  serializeDateOnly,
  taxIdentifierDigits,
} from '../../utils/customer-form-normalizers';

const FILING_STATUSES: { value: string; label: string }[] = [
  { value: 'Single', label: 'Single' },
  { value: 'MarriedJoint', label: 'Married filing jointly' },
  { value: 'MarriedSeparate', label: 'Married filing separately' },
  { value: 'HeadOfHousehold', label: 'Head of household' },
  { value: 'QualifyingSurvivingSpouse', label: 'Qualifying surviving spouse' },
];

/** Cónyuge declarado junto al perfil fiscal (solo con "Married filing jointly"). */
export interface FiscalSpouseDraft {
  /** null = no hay cónyuge en ficha ⇒ se crea. */
  id: string | null;
  /** null = los datos del cónyuge existente no cambiaron (no hace falta PATCH). */
  req: AddRelationRequest | null;
  /** SSN/ITIN en dígitos, o null si no se escribió (se conserva el que hubiera). */
  taxIdentifier: string | null;
}

export interface SaveFiscalPayload {
  profile: SetCustomerFiscalProfileRequest;
  spouse: FiscalSpouseDraft | null;
}

/** Datos editables del cónyuge dentro del formulario. */
interface SpouseFields {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
}

const EMPTY_SPOUSE: SpouseFields = { firstName: '', lastName: '', dateOfBirth: '', email: '', phone: '' };

/** `RelationResponse` solo trae `displayName`: se parte en el primer espacio (igual que la pestaña Family). */
function spouseFieldsFrom(relation: RelationResponse | null): SpouseFields {
  if (!relation) {
    return EMPTY_SPOUSE;
  }
  const name = relation.displayName.trim();
  const space = name.indexOf(' ');
  return {
    firstName: space === -1 ? name : name.slice(0, space),
    lastName: space === -1 ? '' : name.slice(space + 1),
    dateOfBirth: relation.dateOfBirth ?? '',
    email: relation.primaryEmail ?? '',
    phone: relation.primaryPhone ?? '',
  };
}

function sameSpouse(a: SpouseFields, b: SpouseFields): boolean {
  return (
    a.firstName.trim() === b.firstName.trim() &&
    a.lastName.trim() === b.lastName.trim() &&
    a.dateOfBirth === b.dateOfBirth &&
    a.email.trim() === b.email.trim() &&
    normalizePhoneToApi(a.phone) === normalizePhoneToApi(b.phone)
  );
}

/**
 * Formulario del perfil fiscal (PUT /customers/{id}/fiscal-profile). Solo escritura:
 * el identificador viaja en claro al backend (que lo cifra), NUNCA se persiste acá y
 * el modelo del cliente solo guarda el last4. El `subjectKind` decide SSN/ITIN vs EIN
 * y las reglas de validación (9 dígitos; SSN no empieza en 000/666). En edición el tax
 * id se re-escribe (el detalle solo trae el last4). El backend REEMPLAZA el perfil, así
 * que la info bancaria en blanco al editar la borra — se avisa en pantalla.
 *
 * Con "Married filing jointly" aparece el bloque del cónyuge: si ya hay uno en ficha se
 * precarga para revisarlo/editarlo; si no, se invita a cargarlo. El padre guarda la
 * relación (POST/PATCH) y, si se escribió, su SSN (PUT .../relations/{id}/fiscal-profile).
 */
@Component({
  selector: 'app-client-fiscal-form',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-fiscal-form.component.html',
  styleUrl: './client-fiscal-form.component.css',
})
export class ClientFiscalFormComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() existing: CustomerFiscalProfileResponse | null = null;
  @Input() clientKind: 'individual' | 'company' = 'individual';
  @Input() saving = false;
  /** Cónyuge en ficha (relación `Spouse`), o null si no hay. */
  @Input() spouse: RelationResponse | null = null;

  @Output() save = new EventEmitter<SaveFiscalPayload>();
  @Output() closed = new EventEmitter<void>();

  readonly filingStatuses = FILING_STATUSES;

  readonly subjectKind = signal<FiscalSubjectKind>('Individual');
  readonly taxIdentifier = signal('');
  readonly filingStatus = signal('');
  readonly priorYearAgi = signal('');
  readonly isReturning = signal(false);
  readonly refundAccount = signal('');
  readonly refundRouting = signal('');
  readonly taxErr = signal<string | null>(null);
  readonly bankErr = signal<string | null>(null);

  /** Signal (no computed): `existing` es un @Input plano y un computed no se enteraría de sus cambios. */
  readonly isEdit = signal(false);

  // ---------- Cónyuge (solo con "Married filing jointly") ----------
  readonly spouseOnFile = signal(false);
  readonly spouseFirstName = signal('');
  readonly spouseLastName = signal('');
  readonly spouseDob = signal('');
  readonly spouseEmail = signal('');
  readonly spousePhone = signal('');
  readonly spouseSsn = signal('');
  readonly spouseErr = signal<string | null>(null);
  /** Id y datos originales del cónyuge en ficha, para decidir POST vs PATCH vs nada. */
  private spouseId: string | null = null;
  private spouseOriginal: SpouseFields = EMPTY_SPOUSE;

  readonly showSpouse = computed(() => this.filingStatus() === 'MarriedJoint' && this.subjectKind() === 'Individual');
  readonly taxIdKindLabel = computed(() => (this.subjectKind() === 'Business' ? 'EIN' : 'SSN / ITIN'));

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] || changes['existing']) {
      this.reset();
    } else if (changes['spouse']) {
      // El padre recargó el cliente con el modal abierto (p. ej. tras un guardado parcial
      // que creó el cónyuge pero falló su SSN): se adopta el id para que el reintento haga
      // PATCH en vez de crear un segundo cónyuge, sin pisar lo que el usuario escribió.
      this.spouseId = this.spouse?.id ?? null;
      this.spouseOriginal = spouseFieldsFrom(this.spouse);
      this.spouseOnFile.set(this.spouse !== null);
    }
  }

  private reset(): void {
    const e = this.existing;
    this.isEdit.set(e !== null);
    this.subjectKind.set(e?.subjectKind ?? (this.clientKind === 'company' ? 'Business' : 'Individual'));
    this.taxIdentifier.set('');
    this.filingStatus.set(e?.filingStatus ?? '');
    this.priorYearAgi.set(e?.priorYearAgi != null ? String(e.priorYearAgi) : '');
    this.isReturning.set(e?.isReturningCustomer ?? false);
    this.refundAccount.set('');
    this.refundRouting.set('');
    this.taxErr.set(null);
    this.bankErr.set(null);
    this.resetSpouse();
  }

  private resetSpouse(): void {
    const fields = spouseFieldsFrom(this.spouse);
    this.spouseId = this.spouse?.id ?? null;
    this.spouseOriginal = fields;
    this.spouseOnFile.set(this.spouse !== null);
    this.spouseFirstName.set(fields.firstName);
    this.spouseLastName.set(fields.lastName);
    this.spouseDob.set(fields.dateOfBirth);
    this.spouseEmail.set(fields.email);
    this.spousePhone.set(fields.phone);
    this.spouseSsn.set('');
    this.spouseErr.set(null);
  }

  onSpouseSsnInput(value: string): void {
    this.spouseSsn.set(formatSsnForDisplay(value));
    this.spouseErr.set(null);
  }

  onTaxInput(value: string): void {
    this.taxIdentifier.set(this.subjectKind() === 'Business' ? formatEinForDisplay(value) : formatSsnForDisplay(value));
    this.taxErr.set(null);
  }

  onSubjectChange(kind: FiscalSubjectKind): void {
    this.subjectKind.set(kind);
    // Re-formatea lo ya escrito con la máscara del nuevo tipo.
    this.taxIdentifier.set(kind === 'Business' ? formatEinForDisplay(this.taxIdentifier()) : formatSsnForDisplay(this.taxIdentifier()));
  }

  close(): void {
    this.closed.emit();
  }

  submit(): void {
    if (this.saving) return;
    this.taxErr.set(null);
    this.bankErr.set(null);

    // Al editar, dejar el identificador en blanco = conservar el actual (el backend no lo toca).
    // Al crear, es obligatorio. Solo se valida cuando el usuario escribió algo.
    const keepExisting = this.isEdit() && this.taxIdentifier().trim().length === 0;
    let taxIdentifier: string | null = null;
    if (!keepExisting) {
      if (!isValidTaxIdentifier(this.taxIdentifier(), this.subjectKind())) {
        this.taxErr.set(
          this.subjectKind() === 'Individual'
            ? 'Enter a valid 9-digit SSN/ITIN (can’t start with 000 or 666).'
            : 'Enter a valid 9-digit EIN.',
        );
        return;
      }
      taxIdentifier = taxIdentifierDigits(this.taxIdentifier());
    }

    const account = this.refundAccount().trim();
    const routing = this.refundRouting().trim();
    if ((account && !routing) || (!account && routing)) {
      this.bankErr.set('Enter both the routing and account number, or leave both blank.');
      return;
    }

    const spouse = this.showSpouse() ? this.buildSpouseDraft() : null;
    if (spouse === undefined) {
      return;
    }

    const agiRaw = this.priorYearAgi().replace(/[^0-9.]/g, '');
    const req: SetCustomerFiscalProfileRequest = {
      subjectKind: this.subjectKind(),
      taxIdentifier,
      filingStatus: this.filingStatus() || null,
      priorYearAgi: agiRaw ? parseFloat(agiRaw) : null,
      isReturningCustomer: this.isReturning(),
      refundBankAccount: account || null,
      refundBankRouting: routing || null,
    };
    this.save.emit({ profile: req, spouse });
  }

  /**
   * Valida el bloque del cónyuge. `undefined` = hay un error (ya mostrado); `null` = no hay
   * nada que guardar (sin cónyuge en ficha y el bloque vacío: la invitación es opcional).
   */
  private buildSpouseDraft(): FiscalSpouseDraft | null | undefined {
    this.spouseErr.set(null);
    const fields: SpouseFields = {
      firstName: this.spouseFirstName(),
      lastName: this.spouseLastName(),
      dateOfBirth: this.spouseDob(),
      email: this.spouseEmail(),
      phone: this.spousePhone(),
    };
    const ssn = this.spouseSsn().trim();
    const typedSomething = !sameSpouse(fields, EMPTY_SPOUSE) || ssn.length > 0;
    if (!this.spouseId && !typedSomething) {
      return null;
    }
    const changed = !this.spouseId || !sameSpouse(fields, this.spouseOriginal);

    // Datos del cónyuge en ficha sin tocar: no se re-validan (un displayName de una sola
    // palabra no debe bloquear el guardado del perfil fiscal).
    if (changed && (!fields.firstName.trim() || !fields.lastName.trim())) {
      this.spouseErr.set('Enter the spouse’s first and last name.');
      return undefined;
    }
    if (changed && fields.email.trim() && !isValidEmail(fields.email)) {
      this.spouseErr.set('Enter a valid email for the spouse.');
      return undefined;
    }
    if (changed && !isValidPhone(fields.phone)) {
      this.spouseErr.set('Enter the spouse’s phone with country code, e.g. +1 305 555 1234.');
      return undefined;
    }
    if (ssn && !isValidTaxIdentifier(ssn, 'Individual')) {
      this.spouseErr.set('Enter a valid 9-digit SSN/ITIN for the spouse (can’t start with 000 or 666).');
      return undefined;
    }

    const req: AddRelationRequest | null = changed
      ? {
          relationshipKind: 'Spouse',
          purposes: RelationPurpose.TaxHouseholdMember,
          firstName: fields.firstName.trim(),
          lastName: fields.lastName.trim(),
          dateOfBirth: serializeDateOnly(fields.dateOfBirth),
          primaryEmail: fields.email.trim() ? normalizeEmailToApi(fields.email) : null,
          primaryPhone: fields.phone.trim() ? normalizePhoneToApi(fields.phone) : null,
        }
      : null;
    return { id: this.spouseId, req, taxIdentifier: ssn ? taxIdentifierDigits(ssn) : null };
  }
}
