import { Injectable, inject } from '@angular/core';
import { AccessStore } from './access.store';
import { moduleLabel } from './features';
import { ToastService } from '@shared/ui/toast/toast.service';

/** Ventana de silencio por módulo. Una pantalla dispara varias peticiones y todas fallan igual. */
const COOLDOWN_MS = 30_000;

/**
 * B7 — qué hace la aplicación cuando el backend contesta `403 Authz.ModuleUnavailable`.
 *
 * Ese 403 no significa "no tenés permiso": significa que la oficina no contrató el módulo. La
 * diferencia importa porque la salida es otra — a uno se le pide acceso al administrador, al otro
 * se le contrata el plan — y hasta acá los dos terminaban en el mismo error genérico.
 *
 * Y dice algo más: que lo que el cliente creía sobre el plan quedó viejo. Por eso lo primero que
 * hace es volver a pedir el bootstrap; con los módulos al día, B8 se encarga del resto (si la
 * pantalla actual dejó de estar disponible, saca al usuario de ahí). Acá solo queda el aviso para
 * el caso en que el 403 vino de un pedazo de una pantalla que SÍ sigue disponible.
 */
@Injectable({ providedIn: 'root' })
export class EntitlementsNoticeService {
  private readonly access = inject(AccessStore);
  private readonly toast = inject(ToastService);

  /** Último aviso por módulo, para no repetirlo con cada petición de la misma pantalla. */
  private readonly lastNotice = new Map<string, number>();

  /**
   * Lo llama el interceptor ante un `Authz.ModuleUnavailable`. `module` puede venir vacío si el
   * backend no lo nombró: se avisa igual, en genérico, porque el hecho importa más que el nombre.
   */
  notify(module: string | null): void {
    const key = module ?? '*';
    const at = Date.now();
    const last = this.lastNotice.get(key);
    if (last !== undefined && at - last < COOLDOWN_MS) {
      return;
    }
    this.lastNotice.set(key, at);

    // Nuestra lista de módulos quedó vieja: el servidor sabe algo que nosotros no.
    void this.access.reload();

    this.toast.info(this.message(module));
  }

  /**
   * El aviso, en inglés. Lo que cambia según quién sea no es el tono sino QUÉ HACER: a quien puede
   * contratar se le dice dónde, y a quien no, a quién pedírselo. Decirle a un empleado "upgrade
   * your plan" es mandarlo a una puerta que no puede abrir.
   */
  private message(module: string | null): string {
    // El nombre legible, no el código interno: "Client communication", no "comms".
    const what = module ? moduleLabel(module) : 'That section';
    return this.access.canManageBilling()
      ? `${what} is not in your plan. Open Manage subscription to add it.`
      : `${what} is not in your plan. Ask whoever manages billing in your office.`;
  }
}
