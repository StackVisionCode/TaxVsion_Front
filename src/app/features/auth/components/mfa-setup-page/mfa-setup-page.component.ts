import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { toDataURL } from 'qrcode';
import { AuthService } from '@core/auth/auth.service';
import { MfaService } from '@core/auth/mfa.service';
import { CheckoutIntentService } from '@core/billing/checkout-intent.service';
import { SetupTotpResponse } from '@core/auth/mfa.model';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';

/**
 * Enrolamiento TOTP forzado (login devolvió mfaSetupRequired). Flujo: setup
 * (secret + otpAuthUri) → el usuario escanea el QR (o registra la clave a mano) →
 * confirma el primer código (activa MFA) → guarda los códigos de recuperación →
 * entra al dashboard. El QR se genera en el cliente desde otpAuthUri; si falla,
 * queda la clave manual como respaldo.
 */
@Component({
  selector: 'app-mfa-setup-page',
  imports: [CommonModule, ReactiveFormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mfa-setup-page.component.html',
  styleUrl: './mfa-setup-page.component.css',
})
export class MfaSetupPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly mfa = inject(MfaService);
  private readonly checkoutIntent = inject(CheckoutIntentService);
  private readonly destroyRef = inject(DestroyRef);

  readonly setup = signal<SetupTotpResponse | null>(null);
  readonly loadingSetup = signal(true);
  readonly setupError = signal<string | null>(null);
  /** Data URL del QR generado desde otpAuthUri; null si aún no está o si falló (se cae a la clave). */
  readonly qrDataUrl = signal<string | null>(null);

  readonly recoveryCodes = signal<string[] | null>(null);
  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);

  readonly form: FormGroup = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  ngOnInit(): void {
    this.mfa
      .setupTotp()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          this.setup.set(res);
          this.loadingSetup.set(false);
          // El QR se dibuja en el cliente; si la generación falla, el usuario usa la clave manual.
          toDataURL(res.otpAuthUri, { width: 200, margin: 1 })
            .then(url => this.qrDataUrl.set(url))
            .catch(() => this.qrDataUrl.set(null));
        },
        error: err => {
          this.loadingSetup.set(false);
          this.setupError.set(toApiError(err).message);
        },
      });
  }

  onConfirm(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Enter the 6-digit code.');
      return;
    }

    this.formError.set(null);
    this.submitting.set(true);

    const { code } = this.form.getRawValue();
    this.mfa
      .confirmTotp(code)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          this.recoveryCodes.set(res.recoveryCodes);
          this.submitting.set(false);
        },
        error: err => {
          this.submitting.set(false);
          this.formError.set(this.messageFor(err));
        },
      });
  }

  onFinish(): void {
    this.auth.completeMfaEnrollment();
    // Si el usuario venía del alta con un plan elegido, va al checkout a pagarlo; si no, al dashboard.
    const target = this.checkoutIntent.intent() ? '/checkout' : '/dashboard';
    void this.router.navigateByUrl(target);
  }

  /** Descarga los 10 códigos de recuperación como .txt para que el usuario los guarde offline. */
  downloadCodes(): void {
    const codes = this.recoveryCodes();
    if (!codes) {
      return;
    }
    const body =
      'TaxPro Office — Recovery codes\n\n' +
      'Keep these somewhere safe. Each code can be used once to sign in if you lose your device.\n\n' +
      codes.join('\n') +
      '\n';
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'taxproffice-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  private messageFor(err: unknown): string {
    const apiError = toApiError(err);
    switch (apiError.code) {
      case 'Auth.MfaInvalid':
        return 'Invalid code. Check your device clock and try again.';
      case 'Mfa.NotSetUp':
        return 'Setup expired. Reload the page to start over.';
      case NETWORK_ERROR_CODE:
        return "We couldn't reach the server.";
      default:
        return apiError.message || "We couldn't confirm the code.";
    }
  }
}
