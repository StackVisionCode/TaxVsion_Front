import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Stripe, StripeCardElement, StripeElements, loadStripe } from '@stripe/stripe-js';
import { InvoiceCheckoutService } from '../../data-access/invoice-checkout.service';
import { CheckoutPhase, InvoiceCheckout, InvoiceCheckoutMethod } from '../../data-access/invoice-checkout.model';

/**
 * Página pública de pago de una factura (/pay/:token). Sin login: el token es la única prueba de
 * posesión. Consume GET /payments-client/checkout/{token} (monto + métodos ACTIVOS del tenant),
 * renderiza Stripe Card Element con la publishable key del tenant, tokeniza la tarjeta (createPaymentMethod)
 * y llama POST .../pay. Solo Stripe tiene adapter hoy; se elige el primer método Stripe.
 */
@Component({
  selector: 'app-invoice-checkout-page',
  imports: [CommonModule, FormsModule],
  templateUrl: './invoice-checkout-page.component.html',
  styleUrl: './invoice-checkout-page.component.css',
})
export class InvoiceCheckoutPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(InvoiceCheckoutService);

  readonly phase = signal<CheckoutPhase>('loading');
  readonly checkout = signal<InvoiceCheckout | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly cardError = signal<string | null>(null);
  readonly receiptEmail = signal('');

  private token = '';
  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;
  private card: StripeCardElement | null = null;

  /** El método Stripe activo del tenant (el único con adapter hoy). */
  readonly stripeMethod = computed<InvoiceCheckoutMethod | undefined>(() =>
    this.checkout()?.methods.find(m => m.providerCode === 'Stripe')
  );

  readonly amountLabel = computed(() => {
    const c = this.checkout();
    if (!c) return '';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c.currency }).format(c.amountCents / 100);
  });

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.phase.set('invalid');
      return;
    }
    this.service.getCheckout(this.token).subscribe({
      next: c => {
        this.checkout.set(c);
        if (!this.stripeMethod()) {
          this.phase.set('error');
          this.errorMessage.set('El comercio no tiene un método de pago disponible todavía.');
          return;
        }
        this.phase.set('ready');
        // El div #card-element se renderiza recién cuando phase === 'ready'.
        setTimeout(() => this.mountCard(), 0);
      },
      error: () => this.phase.set('invalid'),
    });
  }

  private async mountCard(): Promise<void> {
    try {
      const method = this.stripeMethod();
      if (!method) return;
      this.stripe = await loadStripe(method.publishableKey);
      if (!this.stripe) throw new Error('No se pudo cargar Stripe.');
      this.elements = this.stripe.elements();
      this.card = this.elements.create('card', { hidePostalCode: true });
      this.card.mount('#card-element');
      this.card.on('change', ev => this.cardError.set(ev.error?.message ?? null));
    } catch {
      this.phase.set('error');
      this.errorMessage.set('No se pudo inicializar el formulario de tarjeta.');
    }
  }

  async pay(): Promise<void> {
    const method = this.stripeMethod();
    if (!this.stripe || !this.card || !method) return;
    this.phase.set('paying');
    this.errorMessage.set(null);

    const { error, paymentMethod } = await this.stripe.createPaymentMethod({
      type: 'card',
      card: this.card,
      billing_details: this.receiptEmail() ? { email: this.receiptEmail() } : undefined,
    });

    if (error || !paymentMethod) {
      this.cardError.set(error?.message ?? 'No se pudo procesar la tarjeta.');
      this.phase.set('ready');
      return;
    }

    this.service
      .pay(this.token, {
        provider: method.providerCode,
        providerPaymentMethodToken: paymentMethod.id,
        receiptEmail: this.receiptEmail() || undefined,
      })
      .subscribe({
        next: res => {
          if (res.status === 'Succeeded') this.phase.set('paid');
          else if (res.status === 'Processing') this.phase.set('processing');
          else if (res.status === 'RequiresAction') {
            this.phase.set('error');
            this.errorMessage.set('Esta tarjeta requiere autenticación adicional (3DS), no soportada en esta prueba. Usá 4242 4242 4242 4242.');
          } else {
            this.phase.set('error');
            this.errorMessage.set(res.failureMessage ?? 'El pago fue rechazado.');
          }
        },
        error: err => {
          this.phase.set('error');
          this.errorMessage.set(err?.error?.message ?? 'No se pudo completar el pago.');
        },
      });
  }

  retry(): void {
    this.errorMessage.set(null);
    this.phase.set('ready');
    setTimeout(() => this.mountCard(), 0);
  }
}
