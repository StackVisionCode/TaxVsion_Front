import { Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Stripe, StripeElements, StripePaymentElement, loadStripe } from '@stripe/stripe-js';
import { environment } from '@env/environment';
import { CheckoutStore } from '../../data-access/checkout.store';
import { TestCard } from '../../data-access/checkout.model';

/**
 * Checkout del plan elegido en el alta. Con la publishable key de Stripe configurada usa el
 * **Payment Element** oficial (la tarjeta va directo a Stripe vía un SetupIntent; el PAN nunca toca
 * el backend). Sin key, cae a botones de tarjetas de prueba (referencias pm_card_*). En ambos casos:
 * se obtiene un pm_… → attach → change-plan (gatea en pago) → al confirmarse, se entra en el plan.
 */
@Component({
  selector: 'app-checkout-page',
  imports: [CommonModule],
  templateUrl: './checkout-page.component.html',
})
export class CheckoutPageComponent implements OnInit, OnDestroy {
  readonly store = inject(CheckoutStore);
  private readonly router = inject(Router);

  readonly stripeEnabled = !!environment.stripePublishableKey;
  private readonly cardMount = viewChild<ElementRef<HTMLDivElement>>('cardMount');

  readonly initializing = signal(true);
  readonly stripeError = signal<string | null>(null);
  readonly confirming = signal(false);

  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;
  private paymentElement: StripePaymentElement | null = null;

  /**
   * Producción sin publishable key configurada: no hay forma de cobrar. Se muestra un
   * aviso y se corta, en vez de caer al selector de tarjetas de prueba — ese fallback
   * postea `pm_card_visa` al backend REAL y en producción sería un cobro fantasma.
   */
  readonly misconfigured = environment.production && !this.stripeEnabled;

  // Fallback cuando no hay publishable key (solo dev): tarjetas de prueba mapeadas a su referencia de Stripe.
  readonly testCards: TestCard[] = [
    { label: 'Visa · pago exitoso', brand: 'Visa', number: '4242 4242 4242 4242', reference: 'pm_card_visa' },
    { label: 'Tarjeta rechazada', brand: 'Visa', number: '4000 0000 0000 0002', reference: 'pm_card_chargeDeclined' },
  ];
  readonly selectedCard = signal<TestCard>(this.testCards[0]);

  async ngOnInit(): Promise<void> {
    this.store.loadSubscription();

    if (!this.store.intent() || !this.stripeEnabled) {
      this.initializing.set(false);
      return;
    }

    try {
      const clientSecret = await this.store.loadSetupIntentAsync();
      this.stripe = await loadStripe(environment.stripePublishableKey);
      if (!this.stripe) throw new Error('No se pudo cargar Stripe.');

      this.elements = this.stripe.elements({ clientSecret, appearance: { theme: 'stripe' } });
      this.paymentElement = this.elements.create('payment');
      this.initializing.set(false);
      // El div ya está en el DOM (initializing=false lo mostró); montar en el próximo tick.
      setTimeout(() => {
        const host = this.cardMount()?.nativeElement;
        if (host && this.paymentElement) this.paymentElement.mount(host);
      });
    } catch (err) {
      this.stripeError.set(err instanceof Error ? err.message : 'No se pudo inicializar el pago.');
      this.initializing.set(false);
    }
  }

  ngOnDestroy(): void {
    this.paymentElement?.destroy();
  }

  /** Payment Element: confirma el SetupIntent → obtiene el pm_… → attach + change-plan. */
  async payWithElement(): Promise<void> {
    if (!this.stripe || !this.elements) return;
    this.confirming.set(true);
    this.stripeError.set(null);

    const { error, setupIntent } = await this.stripe.confirmSetup({
      elements: this.elements,
      redirect: 'if_required',
    });

    if (error) {
      this.stripeError.set(error.message ?? 'No se pudo procesar la tarjeta.');
      this.confirming.set(false);
      return;
    }

    // Defensa: solo un SetupIntent efectivamente confirmado deja continuar al cobro.
    if (setupIntent?.status !== 'succeeded') {
      this.stripeError.set('La tarjeta no pudo confirmarse. Probá con otra.');
      this.confirming.set(false);
      return;
    }

    const pm = setupIntent?.payment_method;
    const pmId = typeof pm === 'string' ? pm : pm?.id;
    this.confirming.set(false);
    if (!pmId) {
      this.stripeError.set('No se obtuvo el método de pago de Stripe.');
      return;
    }
    this.store.pay(pmId);
  }

  // --- Fallback sin key ---
  selectCard(card: TestCard): void {
    this.selectedCard.set(card);
  }

  payWithTestCard(): void {
    // Cinturón además del @if del template: una referencia de tarjeta de prueba
    // nunca debe salir hacia el backend de producción.
    if (environment.production) {
      return;
    }
    this.store.pay(this.selectedCard().reference);
  }

  enter(): void {
    void this.router.navigateByUrl('/dashboard');
  }

  skip(): void {
    this.store.skip();
    void this.router.navigateByUrl('/dashboard');
  }
}
