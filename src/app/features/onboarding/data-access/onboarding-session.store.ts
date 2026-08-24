import { Injectable, signal } from '@angular/core';

/** Lo mínimo para poder reintentar el checkout tras volver de Stripe. */
export interface OnboardingSession {
  onboardingId: string;
  email: string;
  planId: string;
}

const STORAGE_KEY = 'tvf.onboarding.session';

/**
 * Retiene el `onboardingId` durante la sesión de compra.
 *
 * El invariante §5 del contrato pide que este id viva "en memoria, ni en
 * localStorage ni en la query string": redirigimos a Stripe con un cambio de
 * página completo, así que la memoria del componente se pierde y la pantalla de
 * "pago cancelado" no podría ofrecer un reintento sin rehacer el OTP entero.
 *
 * `sessionStorage` es el punto medio: acotado a la pestaña, muere al cerrarla, y
 * se limpia en cuanto volvemos de Stripe. Nunca `localStorage` (persiste entre
 * sesiones) ni la URL (queda en historial, referers y logs).
 *
 * La pantalla post-pago **no** lo usa: `subdomains/check` y `register/complete`
 * resuelven el onboarding server-side desde el RegistrationToken.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingSessionStore {
  private readonly _session = signal<OnboardingSession | null>(this.read());

  readonly session = this._session.asReadonly();

  save(session: OnboardingSession): void {
    this._session.set(session);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Modo privado o storage lleno: seguimos con el valor en memoria.
    }
  }

  clear(): void {
    this._session.set(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nada que hacer: el signal ya quedó limpio.
    }
  }

  private read(): OnboardingSession | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<OnboardingSession>;
      return parsed.onboardingId && parsed.email && parsed.planId
        ? { onboardingId: parsed.onboardingId, email: parsed.email, planId: parsed.planId }
        : null;
    } catch {
      return null;
    }
  }
}
