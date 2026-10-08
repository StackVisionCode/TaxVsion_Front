import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { environment } from '@env/environment';
import { CentralLoginService } from '@core/auth/central-login.service';
import { AuthService } from '@core/auth/auth.service';
import { SessionTakeoverService } from '@core/auth/session-takeover.service';
import { LoginTransitionService } from '@core/auth/login-transition.service';
import { RoutePrefetchService } from '@core/performance/route-prefetch.service';

/**
 * Aterrizaje del login central en el subdominio de la oficina: canjea el vale (?ticket=) por
 * tokens de sesión de ESTE origen, hidrata el usuario y entra al dashboard. Sin sesión previa y
 * sin guard: es el punto donde nace la sesión. Un vale inválido/vencido muestra un mensaje plano
 * con vuelta al login central.
 *
 * Mientras canjea, la escena global de transición (`LoginTransitionService`) cubre la pantalla y
 * sigue hasta que el dashboard pintó; la tarjeta con spinner de abajo queda tapada y solo se ve si
 * la escena se retira por su tope de seguridad (respaldo, no pantalla en blanco).
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
  private readonly prefetch = inject(RoutePrefetchService);
  private readonly transition = inject(LoginTransitionService);

  /** Techo de espera por /auth/me antes de navegar (igual que el login de oficina). */
  private static readonly MAX_WAIT_MS = 2000;

  readonly failed = signal(false);

  ngOnInit(): void {
    const ticket = this.route.snapshot.queryParamMap.get('ticket');
    if (!ticket) {
      this.failed.set(true);
      return;
    }

    this.transition.start({ caption: 'Signing you in...' });

    // Esta pantalla SIEMPRE termina en el dashboard (o en returnUrl), así que el chunk se
    // baja mientras el canje del vale está en vuelo, en vez de después. Es tiempo de red
    // que ya estábamos gastando esperando al backend.
    const warm = this.prefetch.warmDashboard();

    this.centralLogin
      .exchangeTicket(ticket)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: session => {
          // Sesión única: ya hay una sesión activa en la oficina → interstitial, sin tokens todavía.
          if (session.takeoverRequired && session.takeoverTicket) {
            this.transition.cancel();
            this.takeover.prompt(session.takeoverTicket);
            return;
          }
          // Política de MFA sin método aún: marcar el enrolamiento y dejar que el authGuard desvíe
          // al setup. Si no, hidratar el perfil (GET /auth/me) y entrar al destino.
          if (session.mfaSetupRequired) {
            this.transition.cancel();
            this.auth.requireMfaEnrollment();
            void this.router.navigate(['/login/setup-mfa']);
            return;
          }
          // Igual que el login de oficina: el shell debe tener `currentUser` en su primer pintado,
          // así que se espera (acotado) a /auth/me junto con el chunk del dashboard antes de navegar.
          void this.enter(Promise.allSettled([firstValueFrom(this.auth.me()), warm]));
        },
        error: () => {
          this.transition.cancel();
          this.failed.set(true);
        },
      });
  }

  private async enter(ready: Promise<unknown>): Promise<void> {
    await Promise.race([ready, this.delay(AuthContinuePageComponent.MAX_WAIT_MS)]);
    const navigated = await this.router.navigateByUrl(this.returnUrl()).catch(() => false);
    if (!navigated) {
      this.transition.cancel(); // queda la tarjeta con spinner como respaldo
    }
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
