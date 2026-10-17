import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { PasswordResetTenantBrand } from '@core/auth/auth.model';
import { ApiConfigService, tenantSlugFromHost } from '@core/config/api-config.service';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { platformConfig } from '@core/config/platform-config';
import { toApiError } from '@core/models/api-error.model';
import { environment } from '@env/environment';

type ResetStep = 'form' | 'done';

/** Estado del enlace del correo: se comprueba al abrir la página, antes de pedir la contraseña. */
type LinkState = 'checking' | 'valid' | 'invalid';

const INVALID_LINK_CODE = 'Auth.InvalidResetToken';

/** Espejo de PasswordPolicy.MinLength en el backend (Auth.Application/Common/PasswordPolicy.cs). */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Página que resuelve el link emailado por POST /auth/password/forgot
 * (`{portal}/reset-password?token=...`). El token viaja en la URL, no lo
 * tipea el usuario — no hay paso de "verificar código" porque el backend no
 * lo tiene. Al abrirse comprueba el enlace: si falta, caducó, ya se usó o fue
 * anulado, avisa directamente en vez de mostrar el formulario.
 *
 * Cross-tenant: el validate devuelve la oficina REAL del token; si el enlace se
 * abrió en otro subdominio (p. ej. clic desde otra pestaña con oficina distinta
 * cargada), se rebota al host correcto. Espejo del patrón de accept-invitation.
 * El backend también valida en el canje final (defense in depth).
 */
import { BrandLogoComponent } from '@core/theme/brand-logo.component';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';

@Component({
  selector: 'app-reset-password-page',
  imports: [InfinityLoaderComponent, BrandLogoComponent, CommonModule, RouterModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './reset-password-page.component.html',
  styleUrl: './reset-password-page.component.css',
})
export class ResetPasswordPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiConfigService);
  private readonly branding = inject(TenantBrandingService);
  private readonly destroyRef = inject(DestroyRef);

  readonly token = this.route.snapshot.queryParamMap.get('token');
  readonly linkState = signal<LinkState>(this.token ? 'checking' : 'invalid');

  readonly step = signal<ResetStep>('form');
  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly showPassword = signal(false);
  readonly formError = signal<string | null>(null);
  readonly isBusy = signal(false);

  readonly minLength = MIN_PASSWORD_LENGTH;

  readonly canSubmit = computed(
    () => this.password().length >= MIN_PASSWORD_LENGTH && this.password() === this.confirmPassword(),
  );

  constructor() {
    if (this.token) {
      this.auth
        .validateResetToken(this.token)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: result => {
            if (result.status !== 'Valid') {
              this.linkState.set('invalid');
              return;
            }
            if (result.tenant && this.redirectIfOtherSubdomain(result.tenant)) {
              return;
            }
            if (result.tenant) {
              // Pintar el branding de la oficina del token (por su slug), no el del host de la URL.
              this.api.setSlug(result.tenant.subDomain);
              this.branding.applyForSurface('Crm');
            }
            this.linkState.set('valid');
          },
          // Solo un rechazo del enlace lo marca inválido; un fallo de red deja el formulario, que se vuelve a comprobar al enviar.
          error: err => this.linkState.set(toApiError(err).code === INVALID_LINK_CODE ? 'invalid' : 'valid'),
        });
    }
  }

  /** El enlace se abrió en otro subdominio: rebotar al de la oficina real del token (branding + URL + el canje
   * posterior quedan coherentes). Solo en prod (en dev hay un solo host). Devuelve true si rebotó. */
  private redirectIfOtherSubdomain(office: PasswordResetTenantBrand): boolean {
    if (!environment.production) return false;
    const hostSlug = tenantSlugFromHost();
    if (!hostSlug || hostSlug === office.subDomain) return false;
    window.location.href =
      `https://${office.subDomain}.${platformConfig().baseDomain}/reset-password` +
      `?token=${encodeURIComponent(this.token ?? '')}`;
    return true;
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }

  resetPassword(): void {
    if (!this.token) {
      return;
    }
    if (this.password().length < MIN_PASSWORD_LENGTH) {
      this.formError.set(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (this.password() !== this.confirmPassword()) {
      this.formError.set('Passwords do not match.');
      return;
    }
    this.formError.set(null);
    this.isBusy.set(true);
    this.auth
      .resetPassword(this.token, this.password())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isBusy.set(false);
          this.step.set('done');
        },
        error: err => {
          this.isBusy.set(false);
          const apiError = toApiError(err);
          if (apiError.code === INVALID_LINK_CODE) {
            this.linkState.set('invalid');
            return;
          }
          // Contraseña débil u otro rechazo: el backend ya manda un mensaje legible.
          this.formError.set(apiError.message || 'Could not reset your password. Please try again.');
        },
      });
  }
}
