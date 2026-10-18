import { Injectable, computed, signal } from '@angular/core';

/**
 * SG-8 — payload que el backend adjunta al 403 `seats.user_slot_gated`.
 *
 * Lo emite el middleware de Auth cuando el empleado está por encima del cap efectivo del tenant
 * (el add-on del asiento quedó impago). La UI lo lee para pintar la pantalla `/blocked/seat-suspended`.
 */
export interface SeatSlotGatedPayload {
  slotIndex: number;
  effectiveCap: number;
  /** URL (del tenant) donde el admin resuelve el pago/reorden. Usada en el mailto como contexto. */
  contactAdminUrl: string;
}

/**
 * Estado "gated" del usuario actual. Lo setea el interceptor cuando atrapa el 403 estructurado,
 * y lo lee la pantalla + el guard. Vive en memoria: si el admin paga o reordena, el próximo
 * request limpio deja de dar 403 y `clear()` lo reinicia desde el `/blocked/seat-suspended` al
 * reintentar.
 */
@Injectable({ providedIn: 'root' })
export class SeatSlotGatedStore {
  private readonly _state = signal<SeatSlotGatedPayload | null>(null);

  readonly state = this._state.asReadonly();
  /** Hay un bloqueo activo: el guard global desvía toda navegación salvo las rutas exentas. */
  readonly isGated = computed(() => this._state() !== null);

  setGatedState(payload: SeatSlotGatedPayload): void {
    this._state.set(payload);
  }

  clear(): void {
    this._state.set(null);
  }
}
