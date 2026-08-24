import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OnboardingService } from '../../data-access/onboarding.service';
import { OnboardingSessionStore } from '../../data-access/onboarding-session.store';
import { toOnboardingError } from '../../data-access/onboarding-errors';
import { AuthShellComponent } from '../../ui/auth-shell/auth-shell.component';

/**
 * Aterrizaje cuando el comprador cancela o cierra el checkout de Stripe
 * (`cancelUrl`). No se cobró nada.
 *
 * Si la sesión de compra sigue viva en la pestaña, ofrece reintentar sin rehacer
 * el OTP: `POST onboarding/checkout` es idempotente (clave
 * `onboarding-checkout-{id}`) y devuelve la misma URL de Stripe.
 *
 * Si el backend responde `Onboarding.InvalidState`, el onboarding quedó atascado
 * en `PaymentProcessing` y no hay forma de retomarlo desde el cliente — se
 * descarta la sesión y se arranca de cero.
 */
@Component({
  selector: 'app-checkout-cancelled',
  imports: [CommonModule, RouterModule, AuthShellComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './checkout-cancelled.component.html',
})
export class CheckoutCancelledComponent {
  private readonly onboarding = inject(OnboardingService);
  private readonly sessionStore = inject(OnboardingSessionStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly session = this.sessionStore.session;
  readonly canRetry = computed(() => this.session() !== null);

  readonly submitting = signal(false);
  readonly retryError = signal<string | null>(null);

  retryPayment(): void {
    const session = this.session();
    if (!session) {
      return;
    }
    this.retryError.set(null);
    this.submitting.set(true);

    const origin = window.location.origin;

    this.onboarding
      .startCheckout({
        onboardingId: session.onboardingId,
        payerEmail: session.email,
        successUrl: `${origin}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/onboarding/cancelled`,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          window.location.href = res.checkoutUrl;
        },
        error: (err: unknown) => {
          const error = toOnboardingError(err);
          if (error.code === 'Onboarding.InvalidState' || error.code === 'Onboarding.NotFound') {
            // Ya no se puede retomar esta compra: hay que empezar de nuevo.
            this.sessionStore.clear();
            this.retryError.set('We could not resume this checkout. Please start again.');
          } else {
            this.retryError.set(error.message);
          }
          this.submitting.set(false);
        },
      });
  }

  startOver(): void {
    this.sessionStore.clear();
    void this.router.navigateByUrl('/register');
  }
}
