import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { SeatSlotGatedStore } from '@core/auth/seat-slot-gated.store';

/**
 * SG-8 — pantalla a la que lleva el interceptor cuando el asiento del usuario está bloqueado por
 * add-on impago. El `SeatSlotGatedStore` ya tiene el `slotIndex`, el `effectiveCap` y la URL del
 * admin: todo lo pinta de ahí, sin un segundo round-trip.
 *
 * Guardrails:
 * - G-C3: botón "Sign out" visible y funcional (quien quedó bloqueado tiene que poder salir).
 * - "Try again": limpia el estado local y manda al dashboard — si el admin ya pagó, el próximo
 *   request viajará limpio y no volverá a dar 403.
 * - "Contact admin": `mailto:` con subject prellenado (sin suponer el email del dueño; el usuario
 *   suele conocerlo o puede abrir "To:" en su cliente de correo).
 */
@Component({
  selector: 'app-seat-suspended',
  standalone: true,
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './seat-suspended.component.html',
})
export class SeatSuspendedComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  protected readonly store = inject(SeatSlotGatedStore);

  /** Nombre de la oficina — solo para el subject del mailto, no afecta la decisión del bloqueo. */
  private readonly officeName = computed(() => this.auth.currentUser()?.tenant?.name ?? '');

  readonly state = this.store.state;
  readonly hasSlotInfo = computed(() => {
    const current = this.state();
    return current !== null && Number.isFinite(current.slotIndex) && Number.isFinite(current.effectiveCap);
  });

  /** mailto: con el asunto prellenado. Si no se conoce la oficina, cae a un asunto genérico. */
  readonly mailtoHref = computed(() => {
    const office = this.officeName();
    const subject = office
      ? `Please free my seat on ${office}`
      : 'Please free my seat';
    return `mailto:?subject=${encodeURIComponent(subject)}`;
  });

  /** El admin ya pagó o reordenó: limpiar el estado local y reintentar la navegación normal. */
  tryAgain(): void {
    this.store.clear();
    void this.router.navigateByUrl('/dashboard');
  }

  signOut(): void {
    this.store.clear();
    this.auth.logout().subscribe({
      next: () => this.redirectToLogin(),
      error: () => this.redirectToLogin(),
    });
  }

  private redirectToLogin(): void {
    // Recarga dura (igual que el `errorInterceptor`): limpia los stores providedIn:'root' para que
    // el próximo usuario de esta pestaña no herede estado del saliente.
    window.location.assign('/login');
  }
}
