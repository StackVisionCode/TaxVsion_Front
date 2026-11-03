import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, input, output } from '@angular/core';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import { ProviderLogoComponent } from '../provider-logo/provider-logo.component';
import { PaymentLinkDetailState } from '../../data-access/billing.store';
import {
  cardBrandLabel,
  formatCents,
  paymentLinkStatusTone,
  purposeLabel,
  tenantPaymentStatusLabel,
  tenantPaymentStatusTone,
} from '../../data-access/billing.model';

/**
 * Detalle de un link de pago: quién pagó, cuándo y con qué. Los datos del pagador solo existen en pagos
 * nuevos (antes no se guardaban); si faltan, se dice en vez de dejar huecos. Sin referencias técnicas
 * del proveedor a la vista.
 */
@Component({
  selector: 'app-payment-link-detail',
  imports: [ModalComponent, StatusPillComponent, InfinityLoaderComponent, ProviderLogoComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @let detail = state();
    <app-modal [isOpen]="!!detail" heading="Payment link details" [subheading]="subheading()" size="md"
      (closed)="closed.emit()">
      @if (detail; as d) {
        <div class="mt-5 flex flex-col gap-5" data-testid="link-detail">
          <div class="rounded-[1.25rem] border border-[#E4DCCF] bg-[#F8F4ED] px-6 py-5 text-center">
            <p class="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-[#3E5F6B]">Amount</p>
            <p class="mt-1 font-display text-[2rem] font-bold text-[#083645]" data-testid="detail-amount">
              {{ amount() }}
            </p>
            <div class="mt-2 flex justify-center">
              @if (d.payment; as p) {
                <app-status-pill [tone]="paymentTone()" [soft]="true" data-testid="detail-status">
                  {{ paymentStatus() }}
                </app-status-pill>
              } @else {
                <app-status-pill [tone]="linkTone()" [soft]="true" data-testid="detail-status">
                  {{ linkStatus() }}
                </app-status-pill>
              }
            </div>
          </div>

          @if (d.link.relatedTenantPaymentId) {
            <section aria-labelledby="detail-payment-title">
              <h3 id="detail-payment-title" class="text-sm font-semibold text-[#083645]">Payment</h3>
              @if (d.paymentLoading) {
                <div class="mt-3 flex items-center gap-2 text-sm text-[#3E5F6B]" role="status">
                  <app-infinity-loader size="xs" /> Loading payment…
                </div>
              } @else if (d.paymentFailed) {
                <p class="mt-2 text-sm text-[#3E5F6B]" data-testid="detail-payment-unavailable">
                  Payment details aren't available right now.
                </p>
              } @else if (d.payment; as p) {
                <dl class="mt-2 divide-y divide-[#E4DCCF] text-sm">
                  @if (paidAt(); as when) {
                    <div class="flex justify-between gap-4 py-2.5">
                      <dt class="text-[#3E5F6B]">Paid on</dt>
                      <dd class="text-right font-medium text-[#083645]" data-testid="detail-paid-at">{{ when }}</dd>
                    </div>
                  }
                  <div class="flex items-center justify-between gap-4 py-2.5">
                    <dt class="text-[#3E5F6B]">Paid with</dt>
                    <dd class="flex items-center gap-2 text-right font-medium text-[#083645]" data-testid="detail-method">
                      <app-provider-logo [code]="p.providerCode" [name]="p.providerCode" size="sm" [decorative]="true" />
                      {{ method() }}
                    </dd>
                  </div>
                  @if (p.status === 'Failed' && p.failureReason) {
                    <div class="flex justify-between gap-4 py-2.5">
                      <dt class="text-[#3E5F6B]">Reason</dt>
                      <dd class="text-right text-[#083645]">{{ p.failureReason }}</dd>
                    </div>
                  }
                </dl>
              }
            </section>

            @if (d.payment; as p) {
              <section aria-labelledby="detail-payer-title">
                <h3 id="detail-payer-title" class="text-sm font-semibold text-[#083645]">Paid by</h3>
                @if (hasPayer()) {
                  <dl class="mt-2 divide-y divide-[#E4DCCF] text-sm" data-testid="detail-payer">
                    @if (p.payerName) {
                      <div class="flex justify-between gap-4 py-2.5">
                        <dt class="text-[#3E5F6B]">Name</dt>
                        <dd class="text-right font-medium text-[#083645]">{{ p.payerName }}</dd>
                      </div>
                    }
                    @if (p.payerEmail) {
                      <div class="flex justify-between gap-4 py-2.5">
                        <dt class="text-[#3E5F6B]">Email</dt>
                        <dd class="min-w-0 break-all text-right font-medium text-[#083645]">{{ p.payerEmail }}</dd>
                      </div>
                    }
                    @if (showReceiptEmail()) {
                      <div class="flex justify-between gap-4 py-2.5">
                        <dt class="text-[#3E5F6B]">Receipt sent to</dt>
                        <dd class="min-w-0 break-all text-right font-medium text-[#083645]">{{ p.receiptEmail }}</dd>
                      </div>
                    }
                  </dl>
                } @else {
                  <p class="mt-2 text-sm text-[#3E5F6B]" data-testid="detail-no-payer">
                    No payer details were saved for this payment.
                  </p>
                }
              </section>
            }
          }

          <section aria-labelledby="detail-link-title">
            <h3 id="detail-link-title" class="text-sm font-semibold text-[#083645]">Link</h3>
            <dl class="mt-2 divide-y divide-[#E4DCCF] text-sm">
              @if (d.clientName) {
                <div class="flex justify-between gap-4 py-2.5">
                  <dt class="text-[#3E5F6B]">Client</dt>
                  <dd class="text-right font-medium text-[#083645]" data-testid="detail-client">{{ d.clientName }}</dd>
                </div>
              }
              <div class="flex justify-between gap-4 py-2.5">
                <dt class="text-[#3E5F6B]">Purpose</dt>
                <dd class="text-right font-medium text-[#083645]">{{ purpose() }}</dd>
              </div>
              @if (d.link.purposeExternalReferenceId) {
                <div class="flex justify-between gap-4 py-2.5">
                  <dt class="text-[#3E5F6B]">Reference</dt>
                  <dd class="min-w-0 break-all text-right font-medium text-[#083645]">{{ d.link.purposeExternalReferenceId }}</dd>
                </div>
              }
              <div class="flex justify-between gap-4 py-2.5">
                <dt class="text-[#3E5F6B]">Created</dt>
                <dd class="text-right text-[#083645]">{{ date(d.link.createdAtUtc) }}</dd>
              </div>
              @if (!d.link.relatedTenantPaymentId) {
                <div class="flex justify-between gap-4 py-2.5">
                  <dt class="text-[#3E5F6B]">Expires</dt>
                  <dd class="text-right text-[#083645]">{{ date(d.link.expiresAtUtc) }}</dd>
                </div>
              }
            </dl>
          </section>
        </div>
      }
    </app-modal>
  `,
})
export class PaymentLinkDetailComponent {
  readonly state = input<PaymentLinkDetailState | null>(null);
  readonly closed = output<void>();

  readonly amount = computed(() => {
    const d = this.state();
    return d ? formatCents(d.payment?.amountCents ?? d.link.amountCents, d.payment?.currency ?? d.link.currency) : '';
  });
  readonly subheading = computed(() => {
    const d = this.state();
    if (!d) return '';
    return d.link.relatedTenantPaymentId ? 'Who paid and how' : 'This link hasn’t been paid yet';
  });
  readonly purpose = computed(() => {
    const kind = this.state()?.link.purposeKind;
    return kind ? purposeLabel(kind) : '';
  });
  readonly linkStatus = computed(() => {
    const status = this.state()?.link.status;
    return status === 'Used' ? 'Paid' : (status ?? '');
  });
  readonly linkTone = computed(() => {
    const status = this.state()?.link.status;
    return status ? paymentLinkStatusTone(status) : 'neutral';
  });
  readonly paymentStatus = computed(() => {
    const p = this.state()?.payment;
    return p ? tenantPaymentStatusLabel(p.status) : '';
  });
  readonly paymentTone = computed(() => {
    const p = this.state()?.payment;
    return p ? tenantPaymentStatusTone(p.status) : 'neutral';
  });
  readonly paidAt = computed(() => this.dateTime(this.state()?.payment?.paidAtUtc ?? null));

  /** "Visa •••• 4242", o el proveedor si no hubo tarjeta (p. ej. saldo de PayPal). */
  readonly method = computed(() => {
    const p = this.state()?.payment;
    if (!p) return '';
    if (p.cardLast4) return `${cardBrandLabel(p.cardBrand)} •••• ${p.cardLast4}`;
    return p.providerCode;
  });

  readonly hasPayer = computed(() => {
    const p = this.state()?.payment;
    return !!(p?.payerName || p?.payerEmail || p?.receiptEmail);
  });

  /** El email del recibo solo se repite si es distinto al del pagador. */
  readonly showReceiptEmail = computed(() => {
    const p = this.state()?.payment;
    return !!p?.receiptEmail && p.receiptEmail.toLowerCase() !== (p.payerEmail ?? '').toLowerCase();
  });

  date(iso: string | null): string {
    const parsed = parseUtcDateOrNull(iso);
    return parsed ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  }

  private dateTime(iso: string | null): string | null {
    const parsed = parseUtcDateOrNull(iso);
    return parsed
      ? parsed.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : null;
  }
}
