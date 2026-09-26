import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import { landingUrl } from '@core/config/landing';

/**
 * Salida al Account del Landing con ESTA misma sesión: pide un vale de un solo uso y navega, porque es otro
 * origen. El vale dura 60 s y se canjea al llegar; no hay takeover, es la misma sesión.
 *
 * Vive acá y no en una pantalla porque ya son varias las que mandan al Account —el banner del ciclo de vida
 * y las acciones que dejaron de hacerse en el CRM—, y todas necesitan el mismo estado de "abriendo" y el
 * mismo mensaje si el vale no sale.
 */
@Injectable({ providedIn: 'root' })
export class AccountHandoffStore {
  private readonly auth = inject(AuthService);

  readonly opening = signal(false);
  readonly error = signal<string | null>(null);

  /** `section` es la ruta del Account donde aterrizar, p.ej. `/account/seats`. */
  open(section = '/account'): void {
    if (this.opening()) {
      return;
    }
    this.opening.set(true);
    this.error.set(null);
    this.auth.requestAccountHandoff().subscribe({
      next: handoff =>
        window.location.assign(
          landingUrl(`/account/continue?ticket=${handoff.ticket}&returnUrl=${encodeURIComponent(section)}`)
        ),
      error: () => {
        this.opening.set(false);
        this.error.set('Could not open your account. Please try again.');
      },
    });
  }
}
