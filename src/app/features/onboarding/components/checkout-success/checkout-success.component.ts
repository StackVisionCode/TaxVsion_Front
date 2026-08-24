import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { OnboardingSessionStore } from '../../data-access/onboarding-session.store';
import { AuthShellComponent } from '../../ui/auth-shell/auth-shell.component';

/**
 * Aterrizaje tras un pago exitoso en Stripe (`successUrl`).
 *
 * Es deliberadamente informativa: no hay nada que llamar acá. El `session_id`
 * que Stripe expande en la URL no lo canjea ningún endpoint del backend, y el
 * `RegistrationToken` —la única llave del resto del flujo— recién existe cuando
 * el webhook de Stripe termina de procesarse, y viaja por email.
 *
 * Limpia la sesión de compra: el `onboardingId` ya no hace falta (todo lo
 * posterior al pago se resuelve con el token del email) y no debe sobrevivir.
 */
@Component({
  selector: 'app-checkout-success',
  imports: [CommonModule, RouterModule, AuthShellComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './checkout-success.component.html',
  styleUrl: './checkout-success.component.css',
})
export class CheckoutSuccessComponent implements OnInit {
  private readonly sessionStore = inject(OnboardingSessionStore);

  ngOnInit(): void {
    this.sessionStore.clear();
  }
}
