import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Sesión única — dispositivo NUEVO. Cuando el login (directo, MFA o handoff central) detecta una
 * sesión previa, devuelve un vale de takeover en vez de tokens; los componentes llaman a
 * {@link prompt} con ese vale y este servicio maneja el interstitial: confirmar canjea el vale
 * (cierra la anterior y crea la nueva) y enruta; cancelar aborta el ingreso.
 */
@Injectable({ providedIn: 'root' })
export class SessionTakeoverService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Vale pendiente (o null si no hay interstitial abierto). Lo consume el modal root-level. */
  readonly ticket = signal<string | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  prompt(ticket: string): void {
    this.error.set(null);
    this.busy.set(false);
    this.ticket.set(ticket);
  }

  cancel(): void {
    this.ticket.set(null);
    this.busy.set(false);
    this.error.set(null);
    // Vuelve al login: cubre tanto el login directo (ya está ahí) como el aterrizaje del handoff
    // central (que si no queda colgado en "signing in").
    void this.router.navigate(['/login']);
  }

  confirm(): void {
    const ticket = this.ticket();
    if (!ticket || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.auth.takeover(ticket).subscribe({
      next: outcome => {
        this.busy.set(false);
        this.ticket.set(null);
        void this.router.navigate([outcome.kind === 'mfa-setup-required' ? '/login/setup-mfa' : '/dashboard']);
      },
      error: () => {
        this.busy.set(false);
        this.error.set("We couldn't close your other session. Please try signing in again.");
      },
    });
  }
}
