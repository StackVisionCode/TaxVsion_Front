import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { MfaService } from '@core/auth/mfa.service';
import { SetupTotpResponse } from '@core/auth/mfa.model';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';

/**
 * Enrolamiento TOTP forzado (login devolvió mfaSetupRequired). Flujo: setup
 * (secret + otpAuthUri) → el usuario lo registra en su app → confirma el primer
 * código (activa MFA) → guarda los códigos de recuperación → entra al dashboard.
 *
 * Nota: el QR se muestra como clave manual + otpAuthUri; el render visual del QR
 * requeriría un paquete (pendiente de autorización).
 */
@Component({
  selector: 'app-mfa-setup-page',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './mfa-setup-page.component.html',
  styleUrl: './mfa-setup-page.component.css',
})
export class MfaSetupPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly mfa = inject(MfaService);
  private readonly destroyRef = inject(DestroyRef);

  readonly setup = signal<SetupTotpResponse | null>(null);
  readonly loadingSetup = signal(true);
  readonly setupError = signal<string | null>(null);

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
      this.formError.set('Ingresa el código de 6 dígitos.');
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
    void this.router.navigateByUrl('/dashboard');
  }

  private messageFor(err: unknown): string {
    const apiError = toApiError(err);
    switch (apiError.code) {
      case 'Auth.MfaInvalid':
        return 'Código inválido. Verifica la hora de tu dispositivo e intenta de nuevo.';
      case 'Mfa.NotSetUp':
        return 'La configuración expiró. Recarga la página para reiniciar el proceso.';
      case NETWORK_ERROR_CODE:
        return 'No se pudo conectar con el servidor.';
      default:
        return apiError.message || 'No se pudo confirmar el código.';
    }
  }
}
