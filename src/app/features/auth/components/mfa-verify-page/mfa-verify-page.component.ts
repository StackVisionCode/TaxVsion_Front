import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, OnDestroy, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';

/**
 * Paso 2 del login (MFA): verifica el código TOTP/Email/SMS o un código de
 * recuperación contra POST /auth/mfa/verify usando el `loginTicket` que dejó el
 * paso 1 en AuthService.pendingMfa. Al verificar, se obtienen los tokens y se
 * navega al dashboard.
 */
@Component({
  selector: 'app-mfa-verify-page',
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mfa-verify-page.component.html',
  styleUrl: './mfa-verify-page.component.css',
})
export class MfaVerifyPageComponent implements OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly pending = this.auth.pendingMfa;

  readonly useRecovery = signal(false);
  readonly rememberDevice = signal(false);
  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);

  private readonly now = signal(Date.now());
  private readonly ticker = setInterval(() => this.now.set(Date.now()), 1000);

  readonly remainingSeconds = computed(() => {
    const p = this.pending();
    if (!p) {
      return 0;
    }
    return Math.max(0, Math.ceil((p.expiresAt - this.now()) / 1000));
  });
  readonly expired = computed(() => this.remainingSeconds() === 0);

  readonly methodsLabel = computed(() => {
    const methods = this.pending()?.methods ?? [];
    if (methods.includes('Totp')) {
      return 'Ingresa el código de tu app de autenticación.';
    }
    if (methods.includes('Email')) {
      return 'Ingresa el código que enviamos a tu correo.';
    }
    if (methods.includes('Sms')) {
      return 'Ingresa el código que enviamos por SMS.';
    }
    return 'Ingresa tu código de verificación.';
  });

  readonly form: FormGroup = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    recoveryCode: [''],
  });

  toggleRecovery(): void {
    this.useRecovery.update(v => !v);
    this.formError.set(null);
    const code = this.form.get('code');
    const recovery = this.form.get('recoveryCode');
    if (this.useRecovery()) {
      code?.clearValidators();
      recovery?.setValidators([Validators.required]);
    } else {
      code?.setValidators([Validators.required, Validators.pattern(/^\d{6}$/)]);
      recovery?.clearValidators();
    }
    code?.updateValueAndValidity();
    recovery?.updateValueAndValidity();
  }

  toggleRememberDevice(): void {
    this.rememberDevice.update(v => !v);
  }

  onSubmit(): void {
    const pending = this.pending();
    if (!pending) {
      void this.router.navigate(['/login']);
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Completa el código correctamente.');
      return;
    }

    this.formError.set(null);
    this.submitting.set(true);

    const { code, recoveryCode } = this.form.getRawValue();
    this.auth
      .verifyMfa({
        loginTicket: pending.loginTicket,
        code: this.useRecovery() ? null : code,
        recoveryCode: this.useRecovery() ? recoveryCode : null,
        rememberDevice: this.rememberDevice(),
        deviceName: 'Web',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          void this.router.navigateByUrl('/dashboard');
        },
        error: err => {
          this.submitting.set(false);
          this.formError.set(this.messageFor(err));
        },
      });
  }

  private messageFor(err: unknown): string {
    const apiError = toApiError(err);
    switch (apiError.code) {
      case 'Auth.MfaInvalid':
        return 'Código inválido o expirado.';
      case NETWORK_ERROR_CODE:
        return 'No se pudo conectar con el servidor.';
      default:
        return apiError.message || 'No se pudo verificar el código.';
    }
  }

  ngOnDestroy(): void {
    clearInterval(this.ticker);
  }
}
