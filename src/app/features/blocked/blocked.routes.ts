import { Routes } from '@angular/router';

/**
 * SG-8 — rutas de bloqueo fuera del shell. Se montan en `/blocked/*` para que la pantalla pueda
 * abrirse sin pasar por el `authGuard` ni por `seatSlotGatedCanActivateChild` (de lo contrario el
 * guard la bloquearía a sí misma y entraría en bucle).
 */
export const BLOCKED_ROUTES: Routes = [
  {
    path: 'seat-suspended',
    data: { preload: false },
    loadComponent: () =>
      import('./seat-suspended/seat-suspended.component').then(m => m.SeatSuspendedComponent),
    title: 'Seat suspended',
  },
];
