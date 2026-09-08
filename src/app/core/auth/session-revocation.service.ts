import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * Sesión única: reacciona a que la sesión fue cerrada en otro dispositivo. El shell autenticado
 * escucha `session.revoked` del socket y llama a {@link handleRevoked} con el sid revocado; este
 * servicio cierra la sesión local SOLO si ese sid es el de ESTA sesión.
 *
 * El evento viaja a la sala del usuario (todos sus dispositivos comparten `t:{tenant}:u:{user}`), así
 * que hay que filtrar por sid — de lo contrario el dispositivo que acaba de hacer takeover, o uno al
 * que se le cerró OTRA sesión, se desloguearía por error.
 *
 * El signal {@link revoked} lo consume el modal full-screen: al pasar a `true` se muestra el aviso.
 */
@Injectable({ providedIn: 'root' })
export class SessionRevocationService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly tokenService = inject(TokenService);

  readonly revoked = signal(false);

  /** Devuelve true si procesó la revocación (era ESTA sesión), para que el caller cierre el socket. */
  handleRevoked(revokedSessionId: string | null): boolean {
    const mySid = this.currentSid();
    // Si sabemos que la sesión revocada es OTRA (no la nuestra), se ignora.
    if (revokedSessionId && mySid && revokedSessionId !== mySid) {
      return false;
    }
    if (this.revoked()) {
      return false;
    }
    this.revoked.set(true);
    this.auth.logoutLocal();
    void this.router.navigate(['/login']);
    return true;
  }

  /** Cierra el modal full-screen (el usuario queda en /login, listo para reingresar). */
  dismiss(): void {
    this.revoked.set(false);
  }

  /** Lee el claim `sid` del JWT sin verificar la firma (la valida el backend en cada request). */
  private currentSid(): string | null {
    const token = this.tokenService.getAccessToken();
    if (!token) {
      return null;
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload.sid === 'string' ? payload.sid : null;
    } catch {
      return null;
    }
  }
}
