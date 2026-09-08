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
import { ModalComponent } from '@shared/ui/modal/modal.component';
import {
  InvoicePaymentMethod,
  InvoiceSummary,
  MANUAL_PAYMENT_METHODS,
  formatCents,
  toCents,
} from '../../data-access/billing.model';

/** Lo que el diálogo pide registrar. `amountCents` es el TOTAL pagado, no el incremento. */
export interface RecordPaymentRequest {
  method: InvoicePaymentMethod;
  amountCents: number;
}

/**
 * Registro de un cobro offline (efectivo, cheque, transferencia).
 *
 * ⚠️ Detalle del backend que condiciona este formulario: `Invoice.MarkPaid` hace
 * `AmountPaid = amountCents` — **reemplaza** el importe pagado, no lo suma. Si se mandara solo lo
 * recibido hoy sobre una factura con un pago parcial previo, el pago anterior se perdería y el
 * saldo saldría mal. Por eso el campo pregunta lo recibido AHORA (que es como lo piensa quien
 * cobra) pero lo que viaja es `pagado hasta ahora + lo recibido`, topado al total.
 */
@Component({
  selector: 'app-record-payment-dialog',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './record-payment-dialog.component.html',
})
export class RecordPaymentDialogComponent implements OnChanges {
  @Input() invoice: InvoiceSummary | null = null;
  @Input() saving = false;

  @Output() closed = new EventEmitter<void>();
  @Output() confirmed = new EventEmitter<RecordPaymentRequest>();

  readonly methods = MANUAL_PAYMENT_METHODS;
  readonly method = signal<InvoicePaymentMethod>('Cash');
  /** Importe recibido en esta operación, en la moneda de la factura. */
  readonly amount = signal(0);

  ngOnChanges(changes: SimpleChanges): void {
    // Solo al abrirse con otra factura: `saving` cambia a mitad de la operación y no debe pisar
    // el importe que el usuario ya tecleó.
    if (!changes['invoice'] || !this.invoice) {
      return;
    }
    this.method.set('Cash');
    // Por defecto se cobra el saldo pendiente completo, que es el caso habitual.
    this.amount.set(this.invoice.amountDueCents / 100);
  }

  get isOpen(): boolean {
    return !!this.invoice;
  }

  money(cents: number): string {
    return formatCents(cents, this.invoice?.currency ?? 'USD');
  }

  /** Importe que realmente viajará: acumulado y topado al total de la factura. */
  get cumulativeCents(): number {
    if (!this.invoice) {
      return 0;
    }
    const received = Math.max(0, toCents(this.amount()));
    return Math.min(this.invoice.amountPaidCents + received, this.invoice.totalCents);
  }

  get settlesInvoice(): boolean {
    return !!this.invoice && this.cumulativeCents >= this.invoice.totalCents;
  }

  get canSubmit(): boolean {
    return !this.saving && !!this.invoice && toCents(this.amount()) > 0;
  }

  methodLabel(method: InvoicePaymentMethod): string {
    return method === 'BankTransfer' ? 'Bank transfer' : method;
  }

  /** Atajo "cobrar todo lo que falta". */
  payFullBalance(): void {
    if (this.invoice) {
      this.amount.set(this.invoice.amountDueCents / 100);
    }
  }

  submit(): void {
    if (!this.canSubmit) {
      return;
    }
    this.confirmed.emit({ method: this.method(), amountCents: this.cumulativeCents });
  }

  close(): void {
    this.closed.emit();
  }
}
