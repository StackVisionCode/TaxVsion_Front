import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  Input,
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
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { ApiError } from '@core/models/api-error.model';
import { environment } from '@env/environment';
import { OnboardingService } from '../../data-access/onboarding.service';
import {
  isTerminalTokenError,
  messageForCode,
  onboardingErrorMessage,
  toOnboardingError,
} from '../../data-access/onboarding-errors';
import {
  OnboardingStatusResponse,
  PreviewRegistrationResponse,
  TermsVersionResponse,
  isTerminalStatus,
} from '../../data-access/onboarding.model';
import {
  PASSWORD_MIN_LENGTH,
  passwordPolicyValidator,
  subdomainValidator,
  validateSubdomainSlug,
} from '../../data-access/onboarding.validators';
import { AuthShellComponent } from '../../ui/auth-shell/auth-shell.component';
import { TermsModalComponent } from '../../ui/terms-modal/terms-modal.component';
import { ProvisioningProgressComponent } from '../../ui/provisioning-progress/provisioning-progress.component';

type Phase = 'loading' | 'token-error' | 'form' | 'provisioning' | 'completed' | 'stalled' | 'timed-out';
type SubdomainState = 'idle' | 'checking' | 'available' | 'unavailable';

/** Cadencia de polling recomendada por el FlowSpec: 2s con backoff hasta 30s, corte total a 2min. */
const POLL_INITIAL_MS = 2000;
const POLL_MAX_MS = 30000;
const POLL_BACKOFF_FACTOR = 1.5;
const POLL_TOTAL_TIMEOUT_MS = 120000;

/** Espera antes de consultar disponibilidad mientras el usuario tipea el subdominio. */
const SUBDOMAIN_DEBOUNCE_MS = 500;

/**
 * Formulario final del flujo pago-primero, al que se llega por el link emailado
 * después del pago (`/register?token=...`).
 *
 * El `RegistrationToken` de la URL es la única llave: resuelve el comprador
 * (`preview`), reserva el subdominio (`subdomains/check`), canjea el registro
 * (`register/complete`) y sirve para seguir el provisioning (`status`). El
 * `onboardingId` nunca se expone ni hace falta acá.
 */
@Component({
  selector: 'app-complete-registration',
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    AuthShellComponent,
    TermsModalComponent,
    ProvisioningProgressComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './complete-registration.component.html',
  styleUrl: './complete-registration.component.css',
})
export class CompleteRegistrationComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly onboarding = inject(OnboardingService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Dominio donde vivirá la oficina. Sale del entorno y NO se escribe a mano: estaba
   * hardcodeado como `taxprocore.com`, que no es el dominio real de la plataforma
   * (`taxproffice.com`), así que al comprador se le prometía una URL inexistente.
   */
  readonly baseDomain = environment.baseDomain;

  /** Token crudo del query param. Se reenvía tal cual, nunca se interpreta ni loguea. */
  @Input({ required: true }) token = '';

  readonly minPasswordLength = PASSWORD_MIN_LENGTH;

  readonly phase = signal<Phase>('loading');
  readonly formError = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly showPassword = signal(false);

  readonly preview = signal<PreviewRegistrationResponse | null>(null);
  readonly tokenError = signal<ApiError | null>(null);

  readonly terms = signal<TermsVersionResponse | null>(null);
  readonly termsModalOpen = signal(false);

  readonly subdomainState = signal<SubdomainState>('idle');
  readonly subdomainMessage = signal<string | null>(null);
  readonly subdomainReady = computed(() => this.subdomainState() === 'available');

  readonly status = signal<OnboardingStatusResponse | null>(null);

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollDelay = POLL_INITIAL_MS;
  private pollDeadline = 0;

  readonly form: FormGroup = this.fb.group({
    officeName: ['', Validators.required],
    subdomain: ['', [Validators.required, subdomainValidator]],
    password: ['', [Validators.required, passwordPolicyValidator]],
    confirmPassword: ['', Validators.required],
    acceptTerms: [false, Validators.requiredTrue],
  });

  ngOnInit(): void {
    this.loadPreview();
    this.loadTerms();
    this.watchSubdomain();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }

  // ── Carga inicial ─────────────────────────────────────────────────────────

  private loadPreview(): void {
    this.onboarding
      .previewRegistration(this.token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: preview => {
          this.preview.set(preview);
          this.phase.set('form');
        },
        error: (err: unknown) => {
          const error = toOnboardingError(err);
          // Si el token ya se canjeó, el registro puede estar provisionándose:
          // el status sigue resolviendo con el mismo token después de consumirlo.
          if (error.code === 'Onboarding.TokenUsed') {
            this.resumeFromStatus(error);
            return;
          }
          this.tokenError.set(error);
          this.phase.set('token-error');
        },
      });
  }

  /** El token ya se usó: mostramos el progreso real en vez de un callejón sin salida. */
  private resumeFromStatus(fallbackError: ApiError): void {
    this.onboarding
      .getStatus(this.token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: status => {
          this.applyStatus(status);
          if (!isTerminalStatus(status.status)) {
            this.startPolling();
          }
        },
        error: () => {
          this.tokenError.set(fallbackError);
          this.phase.set('token-error');
        },
      });
  }

  private loadTerms(): void {
    this.onboarding
      .getCurrentTerms()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: terms => this.terms.set(terms),
        error: (err: unknown) => this.formError.set(onboardingErrorMessage(err)),
      });
  }

  // ── Subdominio ────────────────────────────────────────────────────────────

  private watchSubdomain(): void {
    const control = this.form.get('subdomain');
    if (!control) {
      return;
    }

    control.valueChanges
      .pipe(
        map(value => ((value as string) ?? '').trim().toLowerCase()),
        // El backend solo acepta minúsculas: normalizamos mientras se tipea en
        // vez de rechazar después.
        map(slug => {
          if (slug !== control.value) {
            control.setValue(slug, { emitEvent: false });
          }
          return slug;
        }),
        distinctUntilChanged(),
        map(slug => {
          this.subdomainState.set(slug ? 'checking' : 'idle');
          this.subdomainMessage.set(null);
          return slug;
        }),
        debounceTime(SUBDOMAIN_DEBOUNCE_MS),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(slug => this.checkSubdomain(slug));
  }

  private checkSubdomain(slug: string): void {
    if (!slug) {
      this.subdomainState.set('idle');
      return;
    }

    // Espejo local de SubdomainSlug: evita una llamada que ya sabemos que falla.
    const localError = validateSubdomainSlug(slug);
    if (localError) {
      this.subdomainState.set('unavailable');
      this.subdomainMessage.set(messageForCode(localError, 'That address is not valid.'));
      return;
    }

    this.onboarding
      .checkSubdomain({ slug, token: this.token })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          // Slug ya tipeado distinto mientras la respuesta viajaba: la descartamos.
          if (((this.form.value.subdomain as string) ?? '') !== slug) {
            return;
          }
          if (res.available) {
            this.subdomainState.set('available');
            this.subdomainMessage.set(null);
            return;
          }
          this.subdomainState.set('unavailable');
          // `reason` es un código del backend, no un literal legible.
          this.subdomainMessage.set(
            res.reason ? messageForCode(res.reason, 'That address is not available.') : 'That address is not available.',
          );
        },
        error: (err: unknown) => {
          const error = toOnboardingError(err);
          if (isTerminalTokenError(error.code)) {
            this.tokenError.set(error);
            this.phase.set('token-error');
            return;
          }
          this.subdomainState.set('unavailable');
          this.subdomainMessage.set(error.message);
        },
      });
  }

  // ── Envío ─────────────────────────────────────────────────────────────────

  openTerms(event: Event): void {
    event.preventDefault();
    this.termsModalOpen.set(true);
  }

  onSubmit(): void {
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      const passwordError = this.form.get('password')?.errors?.['passwordPolicy'] as string | undefined;
      this.formError.set(passwordError ?? 'Please complete all fields correctly.');
      return;
    }
    if (this.form.value.password !== this.form.value.confirmPassword) {
      this.formError.set('Passwords do not match.');
      return;
    }
    if (!this.subdomainReady()) {
      this.formError.set('Please pick an available address for your office.');
      return;
    }
    const terms = this.terms();
    if (!terms) {
      this.formError.set('We could not load the current terms. Please reload the page.');
      return;
    }

    this.formError.set(null);
    this.submitting.set(true);

    const { password, officeName, subdomain } = this.form.value as Record<string, string>;

    this.onboarding
      .completeRegistration({
        token: this.token,
        password,
        officeName: officeName.trim(),
        subdomain,
        termsAccepted: true,
        termsVersionId: terms.termsVersionId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // El token se consume en esta misma transacción: no se reintenta nunca.
          // `submitting` queda en true a propósito, el botón no vuelve a habilitarse.
          this.phase.set('provisioning');
          this.startPolling();
        },
        error: (err: unknown) => {
          const error = toOnboardingError(err);

          if (error.code === 'Onboarding.TermsVersionNotCurrent') {
            // Se publicó una versión nueva mientras llenaba el formulario:
            // hay que volver a mostrarla y que la acepte de nuevo.
            this.form.patchValue({ acceptTerms: false });
            this.terms.set(null);
            this.loadTerms();
            this.formError.set(error.message);
            this.submitting.set(false);
            return;
          }

          if (isTerminalTokenError(error.code)) {
            this.tokenError.set(error);
            this.phase.set('token-error');
            return;
          }

          if (error.code === 'Onboarding.SubdomainNotReserved') {
            // La reserva de 60 min venció mientras completaba el formulario.
            this.subdomainState.set('idle');
            this.checkSubdomain(this.form.value.subdomain as string);
          }

          this.formError.set(error.message);
          this.submitting.set(false);
        },
      });
  }

  // ── Polling del provisioning ──────────────────────────────────────────────

  private startPolling(): void {
    this.pollDelay = POLL_INITIAL_MS;
    this.pollDeadline = Date.now() + POLL_TOTAL_TIMEOUT_MS;
    this.scheduleNextPoll();
  }

  private scheduleNextPoll(): void {
    this.stopPolling();
    this.pollTimer = setTimeout(() => this.poll(), this.pollDelay);
  }

  private poll(): void {
    this.onboarding
      .getStatus(this.token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: status => {
          this.applyStatus(status);
          if (isTerminalStatus(status.status)) {
            return;
          }
          if (Date.now() >= this.pollDeadline) {
            // El backend reintenta a 5min/15min/1h: el navegador no puede esperarlo.
            this.phase.set('timed-out');
            return;
          }
          this.pollDelay = Math.min(Math.round(this.pollDelay * POLL_BACKOFF_FACTOR), POLL_MAX_MS);
          this.scheduleNextPoll();
        },
        error: () => {
          // Un fallo puntual de red no debe tirar la pantalla: se reintenta.
          if (Date.now() >= this.pollDeadline) {
            this.phase.set('timed-out');
            return;
          }
          this.pollDelay = Math.min(Math.round(this.pollDelay * POLL_BACKOFF_FACTOR), POLL_MAX_MS);
          this.scheduleNextPoll();
        },
      });
  }

  private applyStatus(status: OnboardingStatusResponse): void {
    this.status.set(status);

    if (status.status === 'Completed') {
      this.phase.set('completed');
      this.stopPolling();
      return;
    }
    if (isTerminalStatus(status.status)) {
      this.phase.set('stalled');
      this.stopPolling();
      return;
    }
    this.phase.set('provisioning');
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Mensaje del estado terminal no exitoso, sin alarmar a quien ya pagó. */
  readonly stalledMessage = computed(() => {
    const status = this.status();
    if (!status) {
      return "We're finishing setting up your account and we'll email you as soon as it's ready.";
    }
    if (status.failureCode === 'User.EmailConflict') {
      return 'This email already has an account with us. Our team will reach out to sort it out — you were not charged twice.';
    }
    switch (status.status) {
      case 'ManualReview':
      case 'ProvisioningFailed':
        return "We're finishing setting up your account and we'll email you as soon as it's ready.";
      case 'Refunded':
        return 'This purchase was refunded. Reach out to support if that looks wrong.';
      case 'PaymentFailed':
        return 'The payment did not go through, so nothing was charged. You can start a new signup.';
      case 'Cancelled':
      case 'Expired':
        return 'This signup is no longer active. Please contact support and we will help you out.';
      default:
        return "We're finishing setting up your account and we'll email you as soon as it's ready.";
    }
  });
}
