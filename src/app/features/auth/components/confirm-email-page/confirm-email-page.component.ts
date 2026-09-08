import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { defer } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { ApiConfigService, tenantSlugFromHost } from '@core/config/api-config.service';
import { environment } from '@env/environment';
import { AuthShellComponent } from '../../../onboarding/ui/auth-shell/auth-shell.component';

type Phase = 'confirming' | 'done' | 'error' | 'no-token';

/**
 * Confirmación de un cambio de email: `/confirm-email?token=…`.
 *
 * Es la pantalla del enlace que manda Notification al correo NUEVO
 * (`{Portal:BaseUrl}/confirm-email?token=…`, ver EmailChangeRequestedConsumer). Sin esta
 * ruta el enlace daba 404 y el cambio de email quedaba a medias.
 *
 * `POST /auth/me/email/confirm` es `[AllowAnonymous]` — el token de un solo uso (1 hora)
 * es toda la prueba —, así que NO se reutiliza `ProfileService`, que cuelga de la sesión:
 * quien abre el enlace puede estar en otro dispositivo o sin haber iniciado sesión.
 * Mismo criterio que los demás recorridos públicos: `HttpBackend` (sin interceptores),
 * base derivada del host y `defer` para que los fallos viajen por el Observable.
 */
import { BrandLogoComponent } from '@core/theme/brand-logo.component';

@Component({
  selector: 'app-confirm-email-page',
  imports: [BrandLogoComponent, CommonModule, RouterLink, AuthShellComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './confirm-email-page.component.html',
})
export class ConfirmEmailPageComponent implements OnInit {
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly api = inject(ApiConfigService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly phase = signal<Phase>('confirming');
  readonly errorMessage = signal<string | null>(null);

  private get base(): string {
    if (!environment.production) {
      return this.api.tenantUrl('/auth');
    }
    const slug = tenantSlugFromHost();
    if (slug) {
      return `https://${slug}.${environment.baseDomain}/auth`;
    }
    try {
      return this.api.tenantUrl('/auth');
    } catch {
      return this.api.systemUrl('/auth');
    }
  }

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token')?.trim();
    if (!token) {
      this.phase.set('no-token');
      return;
    }
    this.confirm(token);
  }

  private confirm(token: string): void {
    this.phase.set('confirming');
    this.errorMessage.set(null);

    defer(() => this.http.post<void>(`${this.base}/me/email/confirm`, { token }))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.phase.set('done'),
        error: err => {
          this.errorMessage.set(this.messageFor(err));
          this.phase.set('error');
        },
      });
  }

  private messageFor(err: unknown): string {
    const apiError = toApiError(err);
    switch (apiError.code) {
      case 'Auth.InvalidToken':
      case 'Auth.InvalidEmailChangeToken':
        return 'This confirmation link is invalid or has expired. Request the email change again from your profile.';
      case 'Auth.EmailAlreadyInUse':
        return 'That email address is already in use by another account.';
      default:
        return apiError.message || "We couldn't confirm your new email address. Please try again.";
    }
  }
}
