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
  CustomerFiscalProfileResponse,
  FiscalSubjectKind,
  SetCustomerFiscalProfileRequest,
} from '../../data-access/clients.model';
import {
  formatEinForDisplay,
  formatSsnForDisplay,
  isValidTaxIdentifier,
  taxIdentifierDigits,
} from '../../utils/customer-form-normalizers';

const FILING_STATUSES: { value: string; label: string }[] = [
  { value: 'Single', label: 'Single' },
  { value: 'MarriedJoint', label: 'Married filing jointly' },
  { value: 'MarriedSeparate', label: 'Married filing separately' },
  { value: 'HeadOfHousehold', label: 'Head of household' },
  { value: 'QualifyingSurvivingSpouse', label: 'Qualifying surviving spouse' },
];

/**
 * Formulario del perfil fiscal (PUT /customers/{id}/fiscal-profile). Solo escritura:
 * el identificador viaja en claro al backend (que lo cifra), NUNCA se persiste acá y
 * el modelo del cliente solo guarda el last4. El `subjectKind` decide SSN/ITIN vs EIN
 * y las reglas de validación (9 dígitos; SSN no empieza en 000/666). En edición el tax
 * id se re-escribe (el detalle solo trae el last4). El backend REEMPLAZA el perfil, así
 * que la info bancaria en blanco al editar la borra — se avisa en pantalla.
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

  @Output() save = new EventEmitter<SetCustomerFiscalProfileRequest>();
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

  readonly isEdit = computed(() => this.existing !== null);
  readonly taxIdKindLabel = computed(() => (this.subjectKind() === 'Business' ? 'EIN' : 'SSN / ITIN'));

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] || changes['existing']) {
      this.reset();
    }
  }

  private reset(): void {
    const e = this.existing;
    this.subjectKind.set(e?.subjectKind ?? (this.clientKind === 'company' ? 'Business' : 'Individual'));
    this.taxIdentifier.set('');
    this.filingStatus.set(e?.filingStatus ?? '');
    this.priorYearAgi.set(e?.priorYearAgi != null ? String(e.priorYearAgi) : '');
    this.isReturning.set(e?.isReturningCustomer ?? false);
    this.refundAccount.set('');
    this.refundRouting.set('');
    this.taxErr.set(null);
    this.bankErr.set(null);
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
    this.save.emit(req);
  }
}
