import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

/** Fases del flujo: pedir código → verificar OTP → nueva contraseña → éxito. */
type ResetStep = 'email' | 'otp' | 'password' | 'done';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Página "Forgot password" (mismo lenguaje visual que login/register:
 * tarjeta flotante con panel de gradiente). Adaptación del flujo multi-paso
 * del CRM original (password-reset-request + password-reset-validate):
 * email → código OTP → nueva contraseña → éxito. Sin backend: el envío y la
 * verificación son simulados (cualquier código de 6 dígitos es válido) con
 * spinners breves para que el flujo se sienta real.
 */
@Component({
  selector: 'app-forgot-password-page',
  imports: [CommonModule, RouterModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './forgot-password-page.component.html',
  styleUrl: './forgot-password-page.component.css',
})
export class ForgotPasswordPageComponent {
  readonly step = signal<ResetStep>('email');

  readonly email = signal('');
  readonly code = signal('');
  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly showPassword = signal(false);

  readonly formError = signal<string | null>(null);
  readonly isBusy = signal(false);
  /** Feedback transitorio del enlace "Resend code". */
  readonly resent = signal(false);

  /** Índice del paso activo para pintar el indicador (done cuenta como completado todo). */
  readonly stepIndex = computed(() => ['email', 'otp', 'password', 'done'].indexOf(this.step()));

  readonly stepLabels = ['Email', 'Code', 'New password'];

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }

  sendCode(): void {
    if (!EMAIL_PATTERN.test(this.email().trim())) {
      this.formError.set('Please enter a valid email address.');
      return;
    }
    this.formError.set(null);
    this.simulate(() => this.step.set('otp'));
  }

  verifyCode(): void {
    if (!/^\d{6}$/.test(this.code().trim())) {
      this.formError.set('Enter the 6-digit code we sent you.');
      return;
    }
    this.formError.set(null);
    this.simulate(() => this.step.set('password'));
  }

  resendCode(): void {
    this.resent.set(true);
    setTimeout(() => this.resent.set(false), 2500);
  }

  resetPassword(): void {
    if (this.password().length < 8) {
      this.formError.set('Password must be at least 8 characters.');
      return;
    }
    if (this.password() !== this.confirmPassword()) {
      this.formError.set('Passwords do not match.');
      return;
    }
    this.formError.set(null);
    this.simulate(() => this.step.set('done'));
  }

  /** Spinner breve antes de avanzar, para simular la llamada al backend. */
  private simulate(next: () => void): void {
    this.isBusy.set(true);
    setTimeout(() => {
      this.isBusy.set(false);
      next();
    }, 900);
  }
}
