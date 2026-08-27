import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { environment } from '@env/environment';
import { CentralLoginService } from '@core/auth/central-login.service';
import { AuthService } from '@core/auth/auth.service';
import { SessionTakeoverService } from '@core/auth/session-takeover.service';

/**
 * Aterrizaje del login central en el subdominio de la oficina: canjea el vale (?ticket=) por
 * tokens de sesión de ESTE origen, hidrata el usuario y entra al dashboard. Sin sesión previa y
 * sin guard: es el punto donde nace la sesión. Un vale inválido/vencido muestra un mensaje plano
 * con vuelta al login central.
 */
@Component({
  selector: 'app-auth-continue-page',
  imports: [CommonModule],
  templateUrl: './auth-continue-page.component.html',
})
export class AuthContinuePageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly centralLogin = inject(CentralLoginService);
  private readonly auth = inject(AuthService);
  private readonly takeover = inject(SessionTakeoverService);
  private readonly destroyRef = inject(DestroyRef);

  readonly failed = signal(false);

  ngOnInit(): void {
    const ticket = this.route.snapshot.queryParamMap.get('ticket');
    if (!ticket) {
      this.failed.set(true);
      return;
    }

    this.centralLogin
      .exchangeTicket(ticket)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: session => {
          // Sesión única: ya hay una sesión activa en la oficina → interstitial, sin tokens todavía.
          if (session.takeoverRequired && session.takeoverTicket) {
            this.takeover.prompt(session.takeoverTicket);
            return;
          }
          // Política de MFA sin método aún: marcar el enrolamiento y dejar que el authGuard desvíe
          // al setup. Si no, hidratar el perfil (GET /auth/me) y entrar al destino.
          if (session.mfaSetupRequired) {
            this.auth.requireMfaEnrollment();
            void this.router.navigate(['/login/setup-mfa']);
            return;
          }
          this.auth.me().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ error: () => {} });
          void this.router.navigateByUrl(this.returnUrl());
        },
        error: () => this.failed.set(true),
      });
  }

  /** Vuelve al login central (app.*), cruzando de origen en prod. */
  backToLogin(): void {
    if (!environment.production) {
      void this.router.navigate(['/login']);
      return;
    }
    window.location.assign(`https://app.${environment.baseDomain}/login`);
  }

  private returnUrl(): string {
    const url = this.route.snapshot.queryParamMap.get('returnUrl');
    if (!url || !url.startsWith('/') || url.startsWith('/login') || url.startsWith('/auth/continue')) {
      return '/dashboard';
    }
    return url;
  }
}
