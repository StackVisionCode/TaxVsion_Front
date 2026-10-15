import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { formatMoney } from '@shared/utils/format.util';
import { toApiError } from '@core/models/api-error.model';
import { SeatPurchaseStore } from '../../data-access/seat-purchase.store';
import { SeatCheckoutStatusResponse } from '../../data-access/seats.model';

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

  /** Intent abandonado en la pasarela (recuperado de sessionStorage al abrir): sin cerrarlo el backend
   *  rechaza una compra nueva. Mientras exista, el modal muestra la vista "pending" en lugar de la compra. */
  readonly pendingIntent = signal<SeatCheckoutStatusResponse | null>(null);
  readonly checkingPending = signal(false);
  readonly cancellingPending = signal(false);
  readonly pendingCancelError = signal<string | null>(null);

  readonly quote = this.store.quote;
  readonly quoteLoading = this.store.quoteLoading;
  readonly purchasing = this.store.purchasing;
  readonly error = this.store.error;
  readonly hasCardOnFile = this.store.hasCardOnFile;
  readonly defaultCard = this.store.defaultCard;

  readonly chargedTodayLabel = computed(() => {
    const quote = this.quote();
    return quote ? formatMoney(quote.proratedTotalCents, quote.currency, { fromCents: true }) : '—';
  });

  /** Etiqueta del total pendiente: "N seats for $X". */
  readonly pendingLabel = computed(() => {
    const pending = this.pendingIntent();
    if (!pending) {
      return '';
    }
    const total = formatMoney(pending.proratedTotalCents, pending.currency, { fromCents: true });
    return `${pending.quantity} seat${pending.quantity === 1 ? '' : 's'} for ${total}`;
  });

  readonly renewsAtLabel = computed(() => {
    const quote = this.quote();
    if (!quote) {
      return '—';
    }
    return `${formatMoney(quote.unitAmountCents * this.quantity(), quote.currency, { fromCents: true })}/${this.cycleWord(quote.billingCycle)}`;
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

  /** Retomar la pasarela abandonada: evita crear un segundo intent paralelo. */
  resumePendingCheckout(): void {
    const pending = this.pendingIntent();
    if (!pending?.checkoutUrl) {
      return;
    }
    // Dejamos el intent id en storage: la página espera verlo al volver para poll-ear el estado.
    try {
      sessionStorage.setItem(SEAT_CHECKOUT_INTENT_KEY, pending.seatPurchaseIntentId);
    } catch {
      // Modo privado: el redirect igual funciona, aunque el poll al volver se saltea.
    }
    window.location.href = pending.checkoutUrl;
  }

  /** Cancelar el intent abierto: libera el guard y abre el flujo normal de compra. */
  cancelPendingCheckout(): void {
    const pending = this.pendingIntent();
    if (!pending || this.cancellingPending()) {
      return;
    }
    this.cancellingPending.set(true);
    this.pendingCancelError.set(null);
    this.store.cancelOpenCheckout(pending.seatPurchaseIntentId).subscribe({
      next: () => {
        this.cancellingPending.set(false);
        this.pendingIntent.set(null);
        try {
          sessionStorage.removeItem(SEAT_CHECKOUT_INTENT_KEY);
        } catch {
          // Si storage no está disponible nada que limpiar, el intent ya se cerró en el backend.
        }
        this.beginPurchase();
      },
      error: err => {
        this.cancellingPending.set(false);
        this.pendingCancelError.set(toApiError(err).message);
      },
    });
  }

  close(): void {
    this.closed.emit();
  }

  private onOpen(): void {
    this.pendingIntent.set(null);
    this.pendingCancelError.set(null);
    const stored = this.readStoredIntent();
    if (stored) {
      this.loadPendingIntent(stored);
      return;
    }
    this.beginPurchase();
  }

  /** Carga el intent pending desde el backend (status + checkoutUrl). Un status terminal (Cancelled, Expired,
   *  Failed, Provisioned) significa que ya no es pending: limpiamos storage y seguimos con la compra normal. */
  private loadPendingIntent(intentId: string): void {
    this.checkingPending.set(true);
    this.store.getCheckoutStatus(intentId).subscribe({
      next: status => {
        this.checkingPending.set(false);
        const isOpen = status.status === 'Pending' && !!status.checkoutUrl;
        if (isOpen) {
          this.pendingIntent.set(status);
          return;
        }
        try {
          sessionStorage.removeItem(SEAT_CHECKOUT_INTENT_KEY);
        } catch {
          // Nada que limpiar — ya no está disponible.
        }
        this.beginPurchase();
      },
      error: () => {
        // Si no podemos leer el estado (404, red): limpiamos storage y seguimos con la compra normal.
        this.checkingPending.set(false);
        try {
          sessionStorage.removeItem(SEAT_CHECKOUT_INTENT_KEY);
        } catch {
          // Nada que limpiar.
        }
        this.beginPurchase();
      },
    });
  }

  private beginPurchase(): void {
    this.quantity.set(1);
    this.provider.set('Stripe');
    this.store.clearQuote();
    this.store.loadQuote(this.seatType, 1);
    this.store.checkCardOnFile('Stripe');
  }

  private readStoredIntent(): string | null {
    try {
      return sessionStorage.getItem(SEAT_CHECKOUT_INTENT_KEY);
    } catch {
      return null;
    }
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
