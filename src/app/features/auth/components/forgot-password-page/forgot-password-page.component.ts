import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';

type RequestStep = 'email' | 'sent';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Página "Forgot password" (mismo lenguaje visual que login/register: tarjeta
 * flotante con panel de gradiente). Llama a POST /auth/password/forgot, que
 * el backend responde siempre con 202 (anti-enumeración: nunca revela si el
 * email existe) — por eso acá no hay manejo de error de "email no encontrado",
 * solo errores de red/servidor. El backend manda un LINK por correo (no un
 * código): el flujo real de reset vive en /reset-password (ver
 * ResetPasswordPageComponent), no en esta página.
 */
@Component({
  selector: 'app-forgot-password-page',
  imports: [CommonModule, RouterModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './forgot-password-page.component.html',
  styleUrl: './forgot-password-page.component.css',
})
export class ForgotPasswordPageComponent {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly step = signal<RequestStep>('email');
  readonly email = signal('');
  readonly formError = signal<string | null>(null);
  readonly isBusy = signal(false);

  sendCode(): void {
    const value = this.email().trim();
    if (!EMAIL_PATTERN.test(value)) {
      this.formError.set('Please enter a valid email address.');
      return;
    }
    this.formError.set(null);
    this.isBusy.set(true);
    this.auth
      .forgotPassword(value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isBusy.set(false);
          this.step.set('sent');
        },
        error: () => {
          this.isBusy.set(false);
          // Solo llega acá por fallo de red/servidor — el backend nunca responde
          // "email no encontrado" (anti-enumeración), así que no hay mensaje específico que dar.
          this.formError.set('Something went wrong. Please try again in a moment.');
        },
      });
  }
}
