import { Injectable, signal } from '@angular/core';

/** Plan que el usuario eligió en el alta y que debe pagar después de entrar. */
export interface CheckoutIntent {
  planCode: string;
  planName: string;
  billingCycle: 'Monthly' | 'Yearly';
  priceUsd: number;
}

/**
 * Puente entre el alta (features/signup) y el checkout (features/checkout): guarda el plan elegido
 * para retomar el pago tras el enrolamiento MFA. Root singleton — sobrevive el cambio de ruta y el
 * ciclo de vida de los stores route-scoped de cada feature (ver ARCHITECTURE.md: estado transversal
 * en core con providedIn:'root').
 */
@Injectable({ providedIn: 'root' })
export class CheckoutIntentService {
  private readonly _intent = signal<CheckoutIntent | null>(null);
  readonly intent = this._intent.asReadonly();

  set(intent: CheckoutIntent): void {
    this._intent.set(intent);
  }

  clear(): void {
    this._intent.set(null);
  }
}
