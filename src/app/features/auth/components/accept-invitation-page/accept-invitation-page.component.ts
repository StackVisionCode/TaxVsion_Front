import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { toApiError } from '@core/models/api-error.model';
import { AuthShellComponent } from '../../../onboarding/ui/auth-shell/auth-shell.component';
import { InvitationService } from '../../data-access/invitation.service';

type Phase = 'form' | 'submitting' | 'done';

/**
 * Canje de una invitación de equipo: `/accept-invitation?token=…`.
 *
 * Es la pantalla a la que apunta el correo que emite Notification
 * (`{tenantPortalUrl}/accept-invitation?token=…`, ver AuthEventConsumers). El invitado
 * no tiene cuenta todavía: pone nombre, apellido y contraseña, y `POST
 * /auth/invitations/accept` crea el usuario dentro de la oficina que invitó.
 *
 * El backend NO expone un endpoint para inspeccionar el token antes de canjearlo, así
 * que no se puede precargar el email ni validar el enlace por adelantado: si el token
 * está vencido o ya se usó, se descubre al enviar (400 `Auth.InvalidInvitation`) y se
 * muestra ahí. Por eso tampoco se promete nada sobre la invitación en la cabecera.
 */
import { BrandLogoComponent } from '@core/theme/brand-logo.component';

@Component({
  selector: 'app-accept-invitation-page',
  imports: [BrandLogoComponent, CommonModule, ReactiveFormsModule, RouterLink, AuthShellComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './accept-invitation-page.component.html',
})
export class AcceptInvitationPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly invitations = inject(InvitationService);
  private readonly destroyRef = inject(DestroyRef);

  /** Token del enlace. Sin él no hay nada que canjear. */
  readonly token = signal(this.route.snapshot.queryParamMap.get('token') ?? '');
  readonly hasToken = computed(() => this.token().trim().length > 0);

  readonly phase = signal<Phase>('form');
  readonly formError = signal<string | null>(null);
  readonly showPassword = signal(false);

  readonly isSubmitting = computed(() => this.phase() === 'submitting');

  readonly form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  togglePasswordVisibility(): void {
    this.showPassword.update(visible => !visible);
  }

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      this.formError.set('Please complete all fields.');
      return;
    }

    const { name, lastName, password } = this.form.getRawValue();
    this.phase.set('submitting');
    this.formError.set(null);

    this.invitations
      .accept({ invitationToken: this.token().trim(), name, lastName, password })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.phase.set('done'),
        error: err => {
          this.phase.set('form');
          this.formError.set(this.messageFor(err));
        },
      });
  }

  goToLogin(): void {
    void this.router.navigateByUrl('/login');
  }

  private messageFor(err: unknown): string {
    const apiError = toApiError(err);
    switch (apiError.code) {
      case 'Auth.InvalidInvitation':
        return 'This invitation is no longer valid. Ask your office to send a new one.';
      case 'Auth.TooManyAttempts':
        return 'Too many attempts. Please try again in a few minutes.';
      default:
        return apiError.message || 'We could not complete your invitation. Please try again.';
    }
  }
}
