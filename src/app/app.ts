import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { SessionExpiryService } from '@core/services/session-expiry.service';
import { SessionExpiryModalComponent } from '@core/auth/session-expiry-modal.component';
import { SessionRevokedModalComponent } from '@core/auth/session-revoked-modal.component';
import { SessionTakeoverModalComponent } from '@core/auth/session-takeover-modal.component';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    SessionExpiryModalComponent,
    SessionRevokedModalComponent,
    SessionTakeoverModalComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('TaxVsion_Front');

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly sessionExpiry = inject(SessionExpiryService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // El usuario eligió mantener la sesión → intentar refresh; si falla, cerrar sesión.
    this.sessionExpiry.sessionExtended$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.auth.refresh().subscribe({
        next: () => this.sessionExpiry.resetWarning(),
        error: () => this.forceLogout(),
      });
    });

    // Se acabó el tiempo sin respuesta, o el usuario eligió cerrar.
    this.sessionExpiry.sessionExpired$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.forceLogout());
  }

  private forceLogout(): void {
    this.auth.logoutLocal();
    void this.router.navigate(['/login'], { queryParams: { reason: 'session_expired' } });
  }
}
