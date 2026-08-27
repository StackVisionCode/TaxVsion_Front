import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Sesión única: reacciona a que la sesión fue cerrada en otro dispositivo. El shell autenticado
 * escucha el evento `session.revoked` del socket de Communication y llama a {@link handleRevoked};
 * este servicio cierra la sesión local. Vive en `core` sin depender del socket (el shell hace de
 * puente) para no acoplar la autenticación a la feature de chat.
 *
 * El signal {@link revoked} lo consume el modal full-screen (fase de UX): cuando pasa a `true` se
 * muestra el aviso "your session was closed on another device" antes de volver al login.
 */
@Injectable({ providedIn: 'root' })
export class SessionRevocationService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly revoked = signal(false);

  handleRevoked(): void {
    if (this.revoked()) {
      return;
    }
    this.revoked.set(true);
    this.auth.logoutLocal();
    void this.router.navigate(['/login']);
  }

  /** Cierra el modal full-screen (el usuario queda en /login, listo para reingresar). */
  dismiss(): void {
    this.revoked.set(false);
  }
}
