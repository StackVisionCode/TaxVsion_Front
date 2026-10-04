import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { StatusPillComponent, StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import {
  EXPIRATION_OPTIONS,
  PaymentLink,
  PaymentLinkStatus,
  PaymentPurposeKind,
  SELECTABLE_PURPOSES,
  formatCents,
  paymentLinkStatusTone,
  paymentLinkUrl,
  purposeLabel,
} from '../../data-access/billing.model';

/** Alta de un link suelto. */
export interface CreatePaymentLinkForm {
  amount: number;
  currency: string;
  purposeKind: PaymentPurposeKind;
  reference: string;
  expiration: string;
}

const STATUS_FILTERS: (PaymentLinkStatus | null)[] = [null, 'Active', 'Used', 'Expired', 'Revoked'];

/**
 * Links de pago sueltos (`/payments-client/payment-links`): cobros que no cuelgan de una factura —
 * un anticipo, una iguala, una consulta. Es el panel "Payment Links" del CRM legado, pero contra el
 * servicio real.
 *
 * La URL pública se arma en el front como `{origin}/pay/{token}` porque es esta misma app la que
 * sirve esa ruta (`features/invoice-checkout`); el backend usa la misma forma cuando redirige desde
 * `/payments-client/invoices/{reference}`.
 *
 * Ojo con la paginación: el endpoint devuelve un ARRAY plano, sin total, así que no se puede pintar
 * "página X de Y" — solo avanzar y retroceder mientras la página venga llena.
 */
@Component({
  selector: 'app-payment-links-panel',
  imports: [CommonModule, FormsModule, ModalComponent, StatusPillComponent, FilterChipsComponent, StateBlockComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './payment-links-panel.component.html',
})
export class PaymentLinksPanelComponent {
  @Input() links: PaymentLink[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input() statusFilter: PaymentLinkStatus | null = null;
  @Input() page = 1;
  @Input() hasMore = false;
  @Input() creating = false;
  /** B6 — crear y revocar links de pago exige `payment_client.payment_link.manage`. */
  @Input() canManage = true;
  /** Moneda por defecto de la oficina (Billing → Company); el usuario puede cambiarla por link. */
  @Input() defaultCurrency = 'USD';

  @Output() statusFilterChanged = new EventEmitter<PaymentLinkStatus | null>();
  @Output() pageChanged = new EventEmitter<number>();
  @Output() refreshRequested = new EventEmitter<void>();
  @Output() createRequested = new EventEmitter<CreatePaymentLinkForm>();
  @Output() revokeRequested = new EventEmitter<{ link: PaymentLink; reason: string }>();
  @Output() copyRequested = new EventEmitter<string>();

  /** Chips de filtro: `null` (sin filtro) viaja como 'All' porque los chips no admiten null. */
  readonly filterOptions: FilterChipOption<PaymentLinkStatus | 'All'>[] = STATUS_FILTERS.map(status => ({
    id: status ?? 'All',
    label: status ?? 'All',
  }));
  readonly purposes = SELECTABLE_PURPOSES;
  readonly expirations = EXPIRATION_OPTIONS;

  // ---------- Alta ----------

  readonly formOpen = signal(false);
  readonly amount = signal(0);
  readonly currency = signal(this.defaultCurrency);
  readonly purpose = signal<PaymentPurposeKind>('DepositPayment');
  readonly reference = signal('');
  /** Por defecto 7 días, como el CRM legado. */
  readonly expiration = signal(EXPIRATION_OPTIONS[3].value);

  openForm(): void {
    this.amount.set(0);
    this.currency.set(this.defaultCurrency || 'USD');
    this.purpose.set('DepositPayment');
    this.reference.set('');
    this.expiration.set(EXPIRATION_OPTIONS[3].value);
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
  }

  get canCreate(): boolean {
    return !this.creating && this.amount() > 0;
  }

  submit(): void {
    if (!this.canCreate) {
      return;
    }
    this.createRequested.emit({
      amount: this.amount(),
      currency: this.currency(),
      purposeKind: this.purpose(),
      reference: this.reference(),
      expiration: this.expiration(),
    });
  }

  // ---------- Revocar ----------

  readonly revokeTarget = signal<PaymentLink | null>(null);
  readonly revokeReason = signal('');

  askRevoke(link: PaymentLink): void {
    this.revokeReason.set('');
    this.revokeTarget.set(link);
  }

  cancelRevoke(): void {
    this.revokeTarget.set(null);
  }

  confirmRevoke(): void {
    const link = this.revokeTarget();
    if (!link) {
      return;
    }
    this.revokeRequested.emit({ link, reason: this.revokeReason().trim() || 'Revoked from billing' });
    this.revokeTarget.set(null);
  }

  // ---------- Presentación ----------

  trackByLinkId(_index: number, link: PaymentLink): string {
    return link.id;
  }

  onFilterChip(id: PaymentLinkStatus | 'All'): void {
    this.statusFilterChanged.emit(id === 'All' ? null : id);
  }

  money(link: PaymentLink): string {
    return formatCents(link.amountCents, link.currency);
  }

  statusTone(status: PaymentLinkStatus): StatusTone {
    return paymentLinkStatusTone(status);
  }

  purposeText(kind: PaymentPurposeKind): string {
    return purposeLabel(kind);
  }

  shortDate(value: string | null | undefined): string {
    const date = parseUtcDateOrNull(value);
    return date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  }

  publicUrl(link: PaymentLink): string {
    return paymentLinkUrl(link.token);
  }

  copy(link: PaymentLink): void {
    this.copyRequested.emit(this.publicUrl(link));
  }

  canRevoke(link: PaymentLink): boolean {
    // El estado dice si tiene sentido; el permiso, si esta persona puede hacerlo.
    return link.status === 'Active' && this.canManage;
  }
}
