import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { SignupWizardComponent } from '../signup-wizard/signup-wizard.component';
import { CompleteRegistrationComponent } from '../complete-registration/complete-registration.component';

/**
 * `/register` sirve dos momentos distintos del mismo flujo:
 *
 * - sin `?token=` → el wizard de compra (plan → OTP → datos → Stripe).
 * - con `?token=` → el formulario final que llega por email después del pago.
 *
 * Comparten ruta porque el backend construye el link del email como
 * `{RegistrationUrlBase}/register?token=...` (`OnboardingOptions`), así que la
 * URL no es negociable. Se ramifica acá en vez de redirigir para no cambiar la
 * URL del link ni provocar un parpadeo de navegación.
 */
@Component({
  selector: 'app-register-entry',
  imports: [CommonModule, SignupWizardComponent, CompleteRegistrationComponent],
  template: `
    @if (token(); as registrationToken) {
      <app-complete-registration [token]="registrationToken" />
    } @else {
      <app-signup-wizard />
    }
  `,
})
export class RegisterEntryComponent {
  private readonly route = inject(ActivatedRoute);

  readonly token = toSignal(
    this.route.queryParamMap.pipe(map(params => params.get('token')?.trim() || null)),
    { initialValue: null },
  );
}
