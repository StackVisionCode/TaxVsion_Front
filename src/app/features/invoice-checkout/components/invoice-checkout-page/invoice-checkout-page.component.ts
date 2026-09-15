import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Stripe, StripeCardElement, StripeElements, loadStripe } from '@stripe/stripe-js';
import { InvoiceCheckoutService } from '../../data-access/invoice-checkout.service';
import { CheckoutPhase, InvoiceCheckout, InvoiceCheckoutMethod } from '../../data-access/invoice-checkout.model';

/** Carga perezosa (una vez por client-id+moneda) del SDK JS de PayPal. El client-id decide sandbox/live. */
const paypalSdkPromises = new Map<string, Promise<unknown>>();
function loadPayPalSdk(clientId: string, currency: string): Promise<unknown> {
  const key = `${clientId}|${currency}`;
  const cached = paypalSdkPromises.get(key);
  if (cached) return cached;
  const promise = new Promise<unknown>((resolve, reject) => {
    const script = document.createElement('script');
    script.src =
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}` +
      `&currency=${encodeURIComponent(currency)}&intent=capture`;
    script.onload = () => resolve((window as unknown as { paypal?: unknown }).paypal);
    script.onerror = () => reject(new Error('No se pudo cargar PayPal.'));
    document.body.appendChild(script);
  });
  paypalSdkPromises.set(key, promise);
  return promise;
}

/**
 * Página pública de pago de una factura (/pay/:token). Sin login: el token es la única prueba de
 * posesión. Consume GET /payments-client/checkout/{token} (monto + métodos ACTIVOS del tenant) y
 * ofrece un selector cuando hay más de un método. Soporta dos flujos: **Stripe** (Card Element →
 * createPaymentMethod → server confirma) y **PayPal** (Buttons → crear+aprobar orden → mandamos el
 * orderId y el server hace el capture). El backend solo devuelve métodos con adapter registrado.
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
  private paypalButtons: { close?: () => void } | null = null;

  /** Métodos ofrecibles (los que el backend devolvió = activos + con adapter). */
  readonly methods = computed<InvoiceCheckoutMethod[]>(() => this.checkout()?.methods ?? []);

  /** ProviderCode elegido por el pagador (default: Stripe si está, si no el primero). */
  readonly selectedProviderCode = signal<string | null>(null);

  readonly selectedMethod = computed<InvoiceCheckoutMethod | undefined>(() => {
    const all = this.methods();
    const code = this.selectedProviderCode();
    return all.find(m => m.providerCode === code) ?? all[0];
  });

  readonly isStripeSelected = computed(() => this.selectedMethod()?.providerCode === 'Stripe');
  readonly isPayPalSelected = computed(() => this.selectedMethod()?.providerCode === 'PayPal');

  /** Un método con flujo de pago implementado en el frontend (hoy Stripe o PayPal). */
  readonly isSupportedSelected = computed(() => this.isStripeSelected() || this.isPayPalSelected());

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
        if (c.methods.length === 0) {
          this.phase.set('error');
          this.errorMessage.set('El comercio no tiene un método de pago disponible todavía.');
          return;
        }
        // Default: preferir Stripe (Card Element); si no, el primero.
        const preferred = c.methods.find(m => m.providerCode === 'Stripe') ?? c.methods[0];
        this.selectedProviderCode.set(preferred.providerCode);
        this.phase.set('ready');
        this.mountSelected();
      },
      error: () => this.phase.set('invalid'),
    });
  }

  /** Cambia el método elegido; monta el widget del proveedor nuevo. */
  selectMethod(providerCode: string): void {
    if (this.selectedProviderCode() === providerCode) return;
    this.selectedProviderCode.set(providerCode);
    this.cardError.set(null);
    this.errorMessage.set(null);
    this.teardownCard();
    this.teardownPayPal();
    this.mountSelected();
  }

  /** Monta el widget del método actualmente seleccionado (Stripe Card o PayPal Buttons). */
  private mountSelected(): void {
    if (this.isStripeSelected()) {
      setTimeout(() => this.mountCard(), 0);
    } else if (this.isPayPalSelected()) {
      setTimeout(() => this.mountPayPal(), 0);
    }
  }

  private teardownCard(): void {
    this.card?.destroy();
    this.card = null;
    this.elements = null;
    this.stripe = null;
  }

  private teardownPayPal(): void {
    try {
      this.paypalButtons?.close?.();
    } catch {
      /* noop */
    }
    this.paypalButtons = null;
    const container = document.getElementById('paypal-buttons');
    if (container) container.innerHTML = '';
  }

  private async mountCard(): Promise<void> {
    try {
      const method = this.selectedMethod();
      if (!method || method.providerCode !== 'Stripe') return;
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

  private async mountPayPal(): Promise<void> {
    const method = this.selectedMethod();
    const c = this.checkout();
    if (!method || method.providerCode !== 'PayPal' || !c) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paypal = (await loadPayPalSdk(method.publishableKey, c.currency)) as any;
      if (!paypal?.Buttons) throw new Error('PayPal SDK no disponible.');
      const value = (c.amountCents / 100).toFixed(2);
      this.paypalButtons = paypal.Buttons({
        style: { layout: 'vertical', label: 'pay', height: 45 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createOrder: (_data: unknown, actions: any) =>
          actions.order.create({
            intent: 'CAPTURE',
            purchase_units: [{ amount: { value, currency_code: c.currency } }],
          }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onApprove: (data: any) => {
          // El server hace el capture del orderId aprobado y valida el monto.
          this.submitPayment(data.orderID);
          return Promise.resolve();
        },
        onCancel: () => {
          this.phase.set('ready');
        },
        onError: () => {
          this.phase.set('error');
          this.errorMessage.set('No se pudo completar el pago con PayPal.');
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.paypalButtons as any).render('#paypal-buttons');
    } catch {
      this.phase.set('error');
      this.errorMessage.set('No se pudo inicializar PayPal.');
    }
  }

  /** Stripe: tokeniza la tarjeta y envía el pm_ al server. */
  async pay(): Promise<void> {
    const method = this.selectedMethod();
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

    this.submitPayment(paymentMethod.id);
  }

  /** Envía la referencia opaca (pm_ de Stripe / orderId de PayPal) del método elegido al backend. */
  private submitPayment(providerPaymentMethodToken: string): void {
    const method = this.selectedMethod();
    if (!method) return;
    this.phase.set('paying');
    this.errorMessage.set(null);

    this.service
      .pay(this.token, {
        provider: method.providerCode,
        providerPaymentMethodToken,
        receiptEmail: this.receiptEmail() || undefined,
      })
      .subscribe({
        next: res => {
          if (res.status === 'Succeeded') this.phase.set('paid');
          else if (res.status === 'Processing') this.phase.set('processing');
          else if (res.status === 'RequiresAction') {
            this.phase.set('error');
            this.errorMessage.set(
              'Esta tarjeta requiere autenticación adicional (3DS), no soportada en esta prueba. Usá 4242 4242 4242 4242.',
            );
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
    this.teardownCard();
    this.teardownPayPal();
    this.mountSelected();
  }
}
