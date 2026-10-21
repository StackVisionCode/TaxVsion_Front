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
  {
    // Oficina sin pagar: la ven el admin (para pagar) y los empleados (sesión abierta o rechazados en el login).
    path: 'subscription',
    data: { preload: false },
    loadComponent: () =>
      import('./subscription-locked/subscription-locked.component').then(m => m.SubscriptionLockedComponent),
    title: 'Subscription inactive',
  },
];
