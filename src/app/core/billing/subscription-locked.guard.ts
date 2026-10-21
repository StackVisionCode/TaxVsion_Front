import { inject } from '@angular/core';
import { CanActivateChildFn, Router, UrlTree } from '@angular/router';
import { SubscriptionStatusStore } from './subscription-status.store';

/** Pantalla que tapa el CRM mientras la oficina no paga. Vive fuera del shell, en `/blocked/*`. */
export const SUBSCRIPTION_LOCKED_URL = '/blocked/subscription';

/**
 * Con la suscripción vencida no se navega por el CRM: toda ruta del shell lleva a la pantalla de pago.
 * Solo lee el estado del store (lo carga el shell y lo marca el interceptor); no pide nada por su cuenta.
 */
export const subscriptionLockedCanActivateChild: CanActivateChildFn = (): boolean | UrlTree => {
  const store = inject(SubscriptionStatusStore);
  return store.isLocked() ? inject(Router).createUrlTree([SUBSCRIPTION_LOCKED_URL]) : true;
};
