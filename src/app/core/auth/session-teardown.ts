import { Injectable } from '@angular/core';

/**
 * Registro de "qué apagar al cerrar la sesión" (F3): la reunión activa y la llamada 1:1 deben salir
 * (y soltar cámara/micrófono) ANTES de navegar al login, tanto en `logout()` como en `session.revoked`.
 *
 * Es un registro y no una inyección directa a propósito: `AuthService` vive en el bundle inicial y
 * `ActiveMeetingService`/`ActiveCallService` dependen de él (ciclo de DI) y pesan (R3/R5). Cada
 * servicio se anota al construirse; si nunca se construyó, no hay nada que apagar.
 */
@Injectable({ providedIn: 'root' })
export class SessionTeardownRegistry {
  private readonly teardowns = new Set<() => void | Promise<unknown>>();

  /** Devuelve la función para des-registrarse. */
  register(teardown: () => void | Promise<unknown>): () => void {
    this.teardowns.add(teardown);
    return () => this.teardowns.delete(teardown);
  }

  /** Ejecuta todos (best-effort, sin esperar ni propagar errores): el estado local se limpia en sincrónico. */
  runAll(): void {
    for (const teardown of this.teardowns) {
      try {
        void Promise.resolve(teardown()).catch(() => undefined);
      } catch {
        /* un teardown roto no bloquea el cierre de sesión */
      }
    }
  }
}
