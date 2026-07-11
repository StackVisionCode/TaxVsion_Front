import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { environment } from '@env/environment';
import { AuthService, LoginOutcome } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';

type LoginPhase = 'idle' | 'verifying' | 'sinking' | 'loading' | 'fading';

/**
 * Login conectado al backend TaxVision vía AuthService. Al enviar: se llama a
 * POST /auth/login; si hay tokens se reproduce la coreografía de salida (la tarjeta
 * se hunde, aparece el loader y se navega al dashboard/returnUrl); si el backend
 * pide MFA se enruta a /login/verify o /login/setup-mfa. En modo mock
 * (`environment.authMock`) el login es sintético y entra directo.
 */
@Component({
  selector: 'app-login-page',
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css',
})
export class LoginPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly tokenService = inject(TokenService);
  private readonly destroyRef = inject(DestroyRef);

  form: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(3)]],
  });

  readonly showPassword = signal(false);
  readonly formError = signal<string | null>(null);
  readonly isTyping = signal(false);

  /** Fase de la coreografía de salida del login. */
  readonly phase = signal<LoginPhase>('idle');
  readonly isLoggingIn = computed(() => this.phase() !== 'idle');
  /** La tarjeta queda hundida desde 'sinking' en adelante. */
  readonly isSunk = computed(() => this.phase() !== 'idle' && this.phase() !== 'verifying');
  readonly showLoader = computed(() => this.phase() === 'loading' || this.phase() === 'fading');

  readonly loaderDots = Array.from({ length: 8 });

  private typingTimeout: ReturnType<typeof setTimeout> | undefined;

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }

  onTyping(): void {
    this.isTyping.set(true);
    clearTimeout(this.typingTimeout);
    // La animación fluida sigue viva un momento después de la última tecla y luego se asienta.
    this.typingTimeout = setTimeout(() => this.isTyping.set(false), 800);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Please complete all fields correctly.');
      return;
    }

    this.formError.set(null);
    // 'verifying' = spinner en el botón mientras el backend responde.
    this.phase.set('verifying');

    const { email, password } = this.form.getRawValue();
    this.auth
      .login({
        tenantId: environment.tenantId,
        email,
        password,
        deviceToken: this.tokenService.getDeviceToken(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: outcome => this.handleOutcome(outcome),
        error: err => this.handleError(err),
      });
  }

  private handleOutcome(outcome: LoginOutcome): void {
    switch (outcome.kind) {
      case 'authenticated':
        void this.playExitSequence();
        break;
      case 'mfa-required':
        void this.router.navigate(['/login/verify']);
        break;
      case 'mfa-setup-required':
        void this.router.navigate(['/login/setup-mfa']);
        break;
    }
  }

  private handleError(err: unknown): void {
    this.phase.set('idle');
    this.formError.set(this.messageFor(err));
  }

  private messageFor(err: unknown): string {
    const apiError = toApiError(err);
    switch (apiError.code) {
      case 'Auth.Invalid':
        return 'Credenciales inválidas.';
      case 'Auth.LockedOut':
        return 'Cuenta bloqueada temporalmente. Intenta más tarde.';
      case NETWORK_ERROR_CODE:
        return 'No se pudo conectar con el servidor.';
      default:
        return apiError.message || 'No se pudo iniciar sesión.';
    }
  }

  /** Coreografía de salida: la tarjeta se hunde, el loader aparece y se navega. */
  private async playExitSequence(): Promise<void> {
    this.phase.set('sinking');
    await this.delay(500);
    this.phase.set('loading');
    await this.delay(1400);
    this.phase.set('fading');
    await this.delay(400);
    await this.router.navigateByUrl(this.returnUrl());
  }

  private returnUrl(): string {
    const url = this.route.snapshot.queryParamMap.get('returnUrl');
    if (!url || !url.startsWith('/') || url.startsWith('/login')) {
      return '/dashboard';
    }
    return url;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
