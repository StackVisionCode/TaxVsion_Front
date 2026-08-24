import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OnboardingService } from '../../data-access/onboarding.service';
import { OnboardingSessionStore } from '../../data-access/onboarding-session.store';
import { onboardingErrorMessage, toOnboardingError } from '../../data-access/onboarding-errors';
import { PlanResponse } from '../../data-access/onboarding.model';
import { AuthShellComponent } from '../../ui/auth-shell/auth-shell.component';
import { PlanPickerComponent } from '../../ui/plan-picker/plan-picker.component';

/** Segundos de espera que el backend exige entre reenvíos de OTP. */
const RESEND_COOLDOWN_SECONDS = 60;
/** `EmailVerificationChallenge.MaxResends` del backend. */
const MAX_RESENDS = 5;

type EmailPhase = 'email' | 'code' | 'verified';

/**
 * Wizard de compra del flujo PayFlow "pago-primero": plan → verificación de
 * email por OTP → datos del comprador → Stripe Checkout.
 *
 * Nadie puede crear una cuenta sin pagar: el tenant, el usuario owner y la
 * suscripción recién se provisionan después del pago, cuando el comprador vuelve
 * por el link que le llega por email (ver CompleteRegistrationComponent).
 *
 * El `onboardingId` que devuelve el paso 3 es el único dato sensible que
 * manejamos acá; queda en OnboardingSessionStore solo hasta volver de Stripe.
 */
@Component({
  selector: 'app-signup-wizard',
  imports: [CommonModule, RouterModule, ReactiveFormsModule, AuthShellComponent, PlanPickerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signup-wizard.component.html',
  styleUrl: './signup-wizard.component.css',
})
export class SignupWizardComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly onboarding = inject(OnboardingService);
  private readonly sessionStore = inject(OnboardingSessionStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly stepTitles = ['Choose your plan', 'Verify your email', 'Your details', 'Payment'];
  readonly totalSteps = this.stepTitles.length;

  readonly currentStep = signal(1);
  readonly stepTitle = computed(() => this.stepTitles[this.currentStep() - 1]);
  readonly formError = signal<string | null>(null);
  readonly submitting = signal(false);

  // Paso 1 — catálogo de planes.
  readonly plans = signal<PlanResponse[]>([]);
  readonly plansLoading = signal(false);
  readonly plansError = signal<string | null>(null);
  readonly selectedPlanId = signal<string | null>(null);
  readonly selectedPlan = computed(() => this.plans().find(p => p.id === this.selectedPlanId()) ?? null);

  // Paso 2 — OTP.
  readonly emailPhase = signal<EmailPhase>('email');
  readonly challengeId = signal<string | null>(null);
  readonly verifiedEmail = signal<string | null>(null);
  readonly resendCount = signal(0);
  readonly cooldownSeconds = signal(0);
  readonly canResend = computed(() => this.cooldownSeconds() === 0 && this.resendCount() < MAX_RESENDS);
  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

  // Paso 4 — el onboarding ya existe en el backend.
  readonly onboardingId = signal<string | null>(null);

  readonly emailForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  readonly codeForm: FormGroup = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  readonly detailsForm: FormGroup = this.fb.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    phone: [''],
  });

  ngOnInit(): void {
    this.loadPlans();
  }

  ngOnDestroy(): void {
    this.stopCooldown();
  }

  // ── Paso 1 ────────────────────────────────────────────────────────────────

  private loadPlans(): void {
    this.plansLoading.set(true);
    this.plansError.set(null);

    this.onboarding
      .getPlans()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: plans => {
          this.plans.set(plans);
          this.plansLoading.set(false);
        },
        error: (err: unknown) => {
          this.plansError.set(onboardingErrorMessage(err));
          this.plansLoading.set(false);
        },
      });
  }

  retryLoadPlans(): void {
    this.loadPlans();
  }

  selectPlan(planId: string): void {
    this.selectedPlanId.set(planId);
    this.formError.set(null);
  }

  confirmPlan(): void {
    if (!this.selectedPlanId()) {
      this.formError.set('Please choose a plan to continue.');
      return;
    }
    this.formError.set(null);
    this.currentStep.set(2);
  }

  // ── Paso 2 ────────────────────────────────────────────────────────────────

  sendCode(): void {
    const control = this.emailForm.get('email');
    control?.markAsTouched();
    if (this.emailForm.invalid) {
      this.formError.set('Please enter a valid email address.');
      return;
    }
    this.formError.set(null);
    this.submitting.set(true);

    const email = (control?.value as string).trim();

    this.onboarding
      // Sin `firstNameHint`: solo personaliza el asunto del email del OTP y en
      // este punto del wizard todavía no le pedimos el nombre al comprador.
      .createEmailChallenge({ email })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          this.challengeId.set(res.challengeId);
          this.emailPhase.set('code');
          this.resendCount.set(0);
          this.startCooldown();
          this.submitting.set(false);
        },
        error: (err: unknown) => {
          this.formError.set(onboardingErrorMessage(err));
          this.submitting.set(false);
        },
      });
  }

  verifyCode(): void {
    const challengeId = this.challengeId();
    this.codeForm.get('code')?.markAsTouched();
    if (!challengeId || this.codeForm.invalid) {
      this.formError.set('Enter the 6-digit code we sent you.');
      return;
    }
    this.formError.set(null);
    this.submitting.set(true);

    const code = (this.codeForm.value.code as string).trim();

    this.onboarding
      .verifyEmailChallenge(challengeId, { code })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.verifiedEmail.set((this.emailForm.value.email as string).trim());
          this.emailPhase.set('verified');
          this.stopCooldown();
          this.submitting.set(false);
          this.currentStep.set(3);
        },
        error: (err: unknown) => {
          const error = toOnboardingError(err);
          this.formError.set(error.message);
          // Reto agotado o vencido: no tiene sentido seguir tipeando códigos.
          if (error.code === 'Onboarding.OtpLocked' || error.code === 'Onboarding.ChallengeNotFound') {
            this.resetEmailChallenge();
          }
          this.submitting.set(false);
        },
      });
  }

  resendCode(): void {
    const challengeId = this.challengeId();
    if (!challengeId || !this.canResend()) {
      return;
    }
    this.formError.set(null);
    this.submitting.set(true);

    this.onboarding
      .resendEmailChallenge(challengeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.resendCount.update(n => n + 1);
          this.codeForm.reset({ code: '' });
          this.startCooldown();
          this.submitting.set(false);
        },
        error: (err: unknown) => {
          const error = toOnboardingError(err);
          // El backend rechaza reenviar un reto ya verificado: eso no es un
          // error para el usuario, simplemente ya puede seguir.
          if (error.code === 'Onboarding.AlreadyVerified') {
            this.verifiedEmail.set((this.emailForm.value.email as string).trim());
            this.emailPhase.set('verified');
            this.stopCooldown();
            this.currentStep.set(3);
          } else {
            this.formError.set(error.message);
          }
          this.submitting.set(false);
        },
      });
  }

  /** Al volver atrás desde el paso 3 el email ya está verificado: no se re-verifica. */
  continueAfterVerification(): void {
    this.formError.set(null);
    this.currentStep.set(3);
  }

  /** "Use a different email": descarta el reto y vuelve a pedir el correo. */
  resetEmailChallenge(): void {
    this.challengeId.set(null);
    this.verifiedEmail.set(null);
    this.emailPhase.set('email');
    this.resendCount.set(0);
    this.codeForm.reset({ code: '' });
    this.stopCooldown();
  }

  private startCooldown(): void {
    this.stopCooldown();
    this.cooldownSeconds.set(RESEND_COOLDOWN_SECONDS);
    this.cooldownTimer = setInterval(() => {
      this.cooldownSeconds.update(s => {
        if (s <= 1) {
          this.stopCooldown();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  private stopCooldown(): void {
    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }

  // ── Paso 3 ────────────────────────────────────────────────────────────────

  submitDetails(): void {
    this.detailsForm.markAllAsTouched();
    if (this.detailsForm.invalid) {
      this.formError.set('Please complete all required fields.');
      return;
    }
    const planId = this.selectedPlanId();
    const challengeId = this.challengeId();
    const email = this.verifiedEmail();
    if (!planId || !challengeId || !email) {
      this.formError.set('Something went wrong. Please start again.');
      return;
    }

    // El onboarding ya existe (el usuario volvió atrás y siguió): no se re-crea,
    // crearía un segundo agregado huérfano en PendingPayment.
    if (this.onboardingId()) {
      this.formError.set(null);
      this.currentStep.set(4);
      return;
    }

    this.formError.set(null);
    this.submitting.set(true);

    const { firstName, lastName, phone } = this.detailsForm.value as Record<string, string>;

    this.onboarding
      .createOnboarding({
        email,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone?.trim() || null,
        planId,
        emailVerificationChallengeId: challengeId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          this.onboardingId.set(res.onboardingId);
          this.sessionStore.save({ onboardingId: res.onboardingId, email: res.email, planId: res.planId });
          this.submitting.set(false);
          this.currentStep.set(4);
        },
        error: (err: unknown) => {
          this.formError.set(onboardingErrorMessage(err));
          this.submitting.set(false);
        },
      });
  }

  // ── Paso 4 ────────────────────────────────────────────────────────────────

  payWithStripe(): void {
    const onboardingId = this.onboardingId();
    const email = this.verifiedEmail();
    if (!onboardingId || !email) {
      this.formError.set('Something went wrong. Please start again.');
      return;
    }
    this.formError.set(null);
    this.submitting.set(true);

    const origin = window.location.origin;

    this.onboarding
      .startCheckout({
        onboardingId,
        payerEmail: email,
        // `{CHECKOUT_SESSION_ID}` es un placeholder literal que expande Stripe;
        // no hay endpoint que lo canjee, viaja solo para diagnóstico.
        successUrl: `${origin}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/onboarding/cancelled`,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          // Checkout hospedado por Stripe: se sale de la app por completo.
          window.location.href = res.checkoutUrl;
        },
        error: (err: unknown) => {
          const error = toOnboardingError(err);
          this.formError.set(error.message);
          // El plan dejó de estar disponible entre la selección y el pago.
          if (error.code.startsWith('Subscription.Plan.')) {
            this.startOver();
            this.loadPlans();
          }
          this.submitting.set(false);
        },
      });
  }

  /** Descarta la compra en curso y vuelve al paso 1 desde cero. */
  startOver(): void {
    this.sessionStore.clear();
    this.onboardingId.set(null);
    this.selectedPlanId.set(null);
    this.resetEmailChallenge();
    this.emailForm.reset({ email: '' });
    this.detailsForm.reset({ firstName: '', lastName: '', phone: '' });
    this.formError.set(null);
    this.currentStep.set(1);
  }

  goBack(): void {
    this.formError.set(null);
    this.currentStep.update(step => Math.max(1, step - 1));
  }
}
