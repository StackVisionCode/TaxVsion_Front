import { Injectable, computed, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { OnboardingService } from './onboarding.service';
import {
  ContactDraft,
  OnboardingCodes,
  OnboardingPlan,
  OnboardingStep,
  StartCheckoutResponse,
} from './onboarding.model';

/**
 * Estado del wizard pago-primero + orquestación real contra /onboarding/*:
 * contacto → OTP de email → plan → códigos+pago (Stripe hosted, o cubierto 100% sin cobro) → listo.
 * No aprovisiona el tenant acá: al pagar, el backend manda por email el link de registro (el tenant se
 * crea recién cuando el comprador completa ese registro).
 */
@Injectable()
export class OnboardingStore {
  private readonly service = inject(OnboardingService);

  // Catálogo de planes
  readonly plans = signal<OnboardingPlan[]>([]);
  readonly loadingPlans = signal(false);
  readonly plansError = signal<string | null>(null);

  // Navegación del wizard
  readonly step = signal<OnboardingStep>('contact');
  readonly billingCycle = signal<'Monthly' | 'Yearly'>('Monthly');
  readonly selectedPlan = signal<OnboardingPlan | null>(null);

  // Contacto + verificación de email
  readonly contact = signal<ContactDraft | null>(null);
  readonly challengeId = signal<string | null>(null);
  readonly sendingChallenge = signal(false);
  readonly verifyingOtp = signal(false);
  readonly otpError = signal<string | null>(null);
  readonly resent = signal(false);

  // Checkout
  readonly processing = signal(false);
  readonly checkoutError = signal<string | null>(null);
  /** Resultado del checkout con el desglose bruto→descuento→neto (para la pantalla final). */
  readonly checkout = signal<StartCheckoutResponse | null>(null);
  /** Cuando el comprador vuelve de Stripe con ?status=success (cobro hecho). */
  readonly paidViaStripe = signal(false);

  readonly hasPlans = computed(() => this.plans().length > 0);
  readonly canContinueFromPlan = computed(() => this.selectedPlan() !== null);

  loadPlans(): void {
    this.loadPlansThen();
  }

  /**
   * Carga el catálogo y, si se pide, deja marcado un plan concreto en cuanto llega.
   * `preselectId` viene del modal de "Sign up" (`/onboarding?plan=<id>`): el paso de
   * plan se muestra igual, pero con la opción ya elegida. Un id inexistente se ignora
   * — el usuario elige normalmente en su paso.
   */
  loadPlansThen(preselectId?: string): void {
    const preselect = (plans: OnboardingPlan[]): void => {
      if (!preselectId) {
        return;
      }
      const plan = plans.find(p => p.id === preselectId);
      if (plan) {
        this.selectedPlan.set(plan);
      }
    };

    if (this.plans().length > 0) {
      preselect(this.plans());
      return;
    }
    this.loadingPlans.set(true);
    this.plansError.set(null);
    this.service.listPlans().subscribe({
      next: plans => {
        const sorted = [...plans].sort((a, b) => a.monthlyPriceUsd - b.monthlyPriceUsd);
        this.plans.set(sorted);
        preselect(sorted);
        this.loadingPlans.set(false);
      },
      error: err => {
        this.plansError.set(toApiError(err).message);
        this.loadingPlans.set(false);
      },
    });
  }

  /** Paso 1 → 2: guarda el contacto y dispara el OTP de email. */
  startContact(draft: ContactDraft): void {
    this.sendingChallenge.set(true);
    this.otpError.set(null);
    this.contact.set(draft);
    this.service.createChallenge(draft.email, draft.firstName).subscribe({
      next: res => {
        this.challengeId.set(res.challengeId);
        this.sendingChallenge.set(false);
        this.step.set('otp');
      },
      error: err => {
        this.otpError.set(toApiError(err).message);
        this.sendingChallenge.set(false);
      },
    });
  }

  /** Paso 2 → 3: verifica el OTP y pasa a elegir plan. */
  verifyOtp(code: string): void {
    const id = this.challengeId();
    if (!id) return;
    this.verifyingOtp.set(true);
    this.otpError.set(null);
    this.service.verifyChallenge(id, code).subscribe({
      next: () => {
        this.verifyingOtp.set(false);
        this.step.set('plan');
        this.loadPlans();
      },
      error: err => {
        this.otpError.set(toApiError(err).message);
        this.verifyingOtp.set(false);
      },
    });
  }

  resendOtp(): void {
    const id = this.challengeId();
    if (!id) return;
    this.resent.set(false);
    this.service.resendChallenge(id).subscribe({
      next: () => this.resent.set(true),
      error: err => this.otpError.set(toApiError(err).message),
    });
  }

  selectPlan(plan: OnboardingPlan): void {
    this.selectedPlan.set(plan);
  }

  setBillingCycle(cycle: 'Monthly' | 'Yearly'): void {
    this.billingCycle.set(cycle);
  }

  goToPay(): void {
    if (this.canContinueFromPlan()) this.step.set('pay');
  }

  goToPlan(): void {
    this.step.set('plan');
  }

  /**
   * Paso final: crea el onboarding, aplica códigos y arranca el checkout. Si un código cubre el 100%,
   * muestra la pantalla de éxito ($0, sin Stripe). Si hay neto, redirige a la sesión hosted de Stripe.
   */
  pay(codes: OnboardingCodes): void {
    const contact = this.contact();
    const plan = this.selectedPlan();
    const challengeId = this.challengeId();
    if (!contact || !plan || !challengeId) return;

    this.processing.set(true);
    this.checkoutError.set(null);

    this.service
      .createOnboarding({
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone?.trim() || null,
        planId: plan.id,
        emailVerificationChallengeId: challengeId,
        billingCycle: this.billingCycle(),
      })
      .subscribe({
        next: created => {
          const origin = window.location.origin;
          this.service
            .startCheckout({
              onboardingId: created.onboardingId,
              payerEmail: contact.email,
              successUrl: `${origin}/onboarding?status=success`,
              cancelUrl: `${origin}/onboarding?status=cancel`,
              codes,
            })
            .subscribe({
              next: res => {
                this.checkout.set(res);
                if (res.fullyCovered) {
                  this.processing.set(false);
                  this.step.set('done');
                } else if (res.checkoutUrl) {
                  // Redirección a Stripe (sesión hosted). No liberamos `processing`: la página se va.
                  window.location.href = res.checkoutUrl;
                } else {
                  this.processing.set(false);
                  this.checkoutError.set('El checkout no devolvió una URL de pago.');
                }
              },
              error: err => {
                this.checkoutError.set(toApiError(err).message);
                this.processing.set(false);
              },
            });
        },
        error: err => {
          this.checkoutError.set(toApiError(err).message);
          this.processing.set(false);
        },
      });
  }

  /** El comprador volvió de Stripe. success = cobro hecho → pantalla final; cancel = volver al pago. */
  applyReturnStatus(status: string | null): void {
    if (status === 'success') {
      this.paidViaStripe.set(true);
      this.step.set('done');
    } else if (status === 'cancel') {
      this.step.set('pay');
      this.checkoutError.set('Pago cancelado. Podés intentarlo de nuevo.');
    }
  }
}
