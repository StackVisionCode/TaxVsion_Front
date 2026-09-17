import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { SeatPurchaseStore } from '../../../subscription/data-access/seat-purchase.store';

/** Clave de sessionStorage donde se guarda el intentId antes del redirect, para pollear el estado al volver. */
export const SEAT_CHECKOUT_INTENT_KEY = 'seatCheckoutIntentId';

type CheckoutProvider = 'Stripe' | 'PayPal';

/**
 * Modal de compra de asientos de staff (capacidad de cupo) desde `company/users`. Muestra la cotización
 * server-authoritative (prorrateo a hoy + renovación) y ofrece el pago HÍBRIDO (ADR-5): si el tenant tiene
 * tarjeta en archivo, cobro OFF-SESSION inmediato; si no (o si elige "otra forma"), HOSTED-CHECKOUT por
 * redirect (Stripe/PayPal). Tras un cobro off-session exitoso emite `purchased`; en el redirect navega al
 * provider y guarda el intentId en sessionStorage para que la página poll-ee el estado al volver.
 */
@Component({
  selector: 'app-seat-purchase-modal',
  imports: [CommonModule, FormsModule, ModalComponent],
  templateUrl: './seat-purchase-modal.component.html',
})
export class SeatPurchaseModalComponent {
  private readonly store = inject(SeatPurchaseStore);
  private readonly auth = inject(AuthService);

  @Input() set isOpen(value: boolean) {
    const wasOpen = this._isOpen();
    this._isOpen.set(value);
    if (value && !wasOpen) {
      this.onOpen();
    }
  }
  get isOpen(): boolean {
    return this._isOpen();
  }
  private readonly _isOpen = signal(false);

  /** Uso actual (para el encabezado "X / Y en uso"); informativo. */
  @Input() seatsInUse: number | null = null;
  @Input() seatCap: number | null = null;

  @Output() closed = new EventEmitter<void>();
  /** Emitido tras un cobro off-session exitoso (la página refresca límites y sigue con la invitación). */
  @Output() purchased = new EventEmitter<void>();

  readonly seatType = 'Standard';
  readonly quantity = signal(1);
  readonly provider = signal<CheckoutProvider>('Stripe');

  readonly quote = this.store.quote;
  readonly quoteLoading = this.store.quoteLoading;
  readonly purchasing = this.store.purchasing;
  readonly error = this.store.error;
  readonly hasCardOnFile = this.store.hasCardOnFile;
  readonly defaultCard = this.store.defaultCard;

  readonly chargedTodayLabel = computed(() => {
    const quote = this.quote();
    return quote ? this.money(quote.proratedTotalCents, quote.currency) : '—';
  });

  readonly renewsAtLabel = computed(() => {
    const quote = this.quote();
    if (!quote) {
      return '—';
    }
    return `${this.money(quote.unitAmountCents * this.quantity(), quote.currency)}/${this.cycleWord(quote.billingCycle)}`;
  });

  setQuantity(value: number): void {
    const next = Math.max(1, Math.min(500, Math.floor(Number(value) || 1)));
    this.quantity.set(next);
    this.store.loadQuote(this.seatType, next);
  }

  increment(): void {
    this.setQuantity(this.quantity() + 1);
  }

  decrement(): void {
    this.setQuantity(this.quantity() - 1);
  }

  selectProvider(provider: CheckoutProvider): void {
    this.provider.set(provider);
  }

  /** Cobro OFF-SESSION del método en archivo → los asientos quedan disponibles de inmediato. */
  buyWithCardOnFile(): void {
    this.store.startPurchase(this.seatType, this.quantity(), true).subscribe({
      next: () => {
        this.purchased.emit();
        this.close();
      },
      // El error queda en store.error (se muestra inline); no cerramos el modal.
      error: () => {},
    });
  }

  /** HOSTED-CHECKOUT: navega al provider y deja el intentId para pollear al volver. */
  continueToCheckout(): void {
    const returnUrl = window.location.href.split('?')[0];
    this.store
      .startCheckout({
        seatType: this.seatType,
        quantity: this.quantity(),
        autoRenew: true,
        payerEmail: this.auth.currentUser()?.email ?? '',
        successUrl: returnUrl,
        cancelUrl: returnUrl,
        provider: this.provider(),
        method: this.provider() === 'PayPal' ? 'Wallet' : 'Card',
      })
      .subscribe({
        next: response => {
          try {
            sessionStorage.setItem(SEAT_CHECKOUT_INTENT_KEY, response.seatPurchaseIntentId);
          } catch {
            // sessionStorage no disponible (modo privado): el redirect igual funciona; el poll se saltea.
          }
          window.location.href = response.checkoutUrl;
        },
        error: () => {},
      });
  }

  close(): void {
    this.closed.emit();
  }

  private onOpen(): void {
    this.quantity.set(1);
    this.provider.set('Stripe');
    this.store.clearQuote();
    this.store.loadQuote(this.seatType, 1);
    this.store.checkCardOnFile('Stripe');
  }

  private money(cents: number, currency: string): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  }

  private cycleWord(cycle: string): string {
    if (cycle === 'Yearly') {
      return 'yr';
    }
    if (cycle === 'Quarterly') {
      return 'qtr';
    }
    return 'mo';
  }
}
