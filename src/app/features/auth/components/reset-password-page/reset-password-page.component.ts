import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';

type ResetStep = 'form' | 'done';

/** Espejo de PasswordPolicy.MinLength en el backend (Auth.Application/Common/PasswordPolicy.cs). */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Página que resuelve el link emailado por POST /auth/password/forgot
 * (`{portal}/reset-password?token=...`). El token viaja en la URL, no lo
 * tipea el usuario — no hay paso de "verificar código" porque el backend no
 * lo tiene. Sin token en la URL (link roto/copiado mal) se muestra un error
 * directo en vez del formulario.
 */
import { BrandLogoComponent } from '@core/theme/brand-logo.component';

@Component({
  selector: 'app-reset-password-page',
  imports: [BrandLogoComponent, CommonModule, RouterModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './reset-password-page.component.html',
  styleUrl: './reset-password-page.component.css',
})
export class ResetPasswordPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly token = this.route.snapshot.queryParamMap.get('token');

  readonly step = signal<ResetStep>('form');
  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly showPassword = signal(false);
  readonly formError = signal<string | null>(null);
  readonly isBusy = signal(false);

  readonly minLength = MIN_PASSWORD_LENGTH;

  readonly canSubmit = computed(
    () => this.password().length >= MIN_PASSWORD_LENGTH && this.password() === this.confirmPassword(),
  );

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }

  resetPassword(): void {
    if (!this.token) {
      return;
    }
    if (this.password().length < MIN_PASSWORD_LENGTH) {
      this.formError.set(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (this.password() !== this.confirmPassword()) {
      this.formError.set('Passwords do not match.');
      return;
    }
    this.formError.set(null);
    this.isBusy.set(true);
    this.auth
      .resetPassword(this.token, this.password())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isBusy.set(false);
          this.step.set('done');
        },
        error: err => {
          this.isBusy.set(false);
          this.formError.set(this.messageFor(err));
        },
      });
  }

  private messageFor(err: unknown): string {
    const apiError = toApiError(err);
    if (apiError.code === 'Auth.InvalidResetToken') {
      return 'This link is invalid or has expired. Request a new one below.';
    }
    // User.Password (contraseña débil) y cualquier otro código: el backend ya manda un mensaje legible.
    return apiError.message || 'Could not reset your password. Please try again.';
  }
}
