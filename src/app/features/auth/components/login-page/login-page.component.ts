import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { environment } from '@env/environment';
import { AuthService, LoginOutcome } from '@core/auth/auth.service';
import { SessionTakeoverService } from '@core/auth/session-takeover.service';
import { TokenService } from '@core/auth/token.service';
import { ApiConfigService, tenantSlugFromHost } from '@core/config/api-config.service';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';
import {
  PlanChoice,
  PlanPickerModalComponent,
} from '../../ui/plan-picker-modal/plan-picker-modal.component';

type LoginPhase = 'idle' | 'verifying' | 'sinking' | 'loading' | 'fading';

/**
 * Login conectado al backend TaxPro Office vía AuthService. Al enviar: se llama a
 * POST /auth/login; si hay tokens se reproduce la coreografía de salida (la tarjeta
 * se hunde, aparece el loader y se navega al dashboard/returnUrl); si el backend
 * pide MFA se enruta a /login/verify o /login/setup-mfa. En modo mock
 * (`environment.authMock`) el login es sintético y entra directo.
 */
@Component({
  selector: 'app-login-page',
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule, PlanPickerModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css',
})
export class LoginPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly takeover = inject(SessionTakeoverService);
  private readonly tokenService = inject(TokenService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(ApiConfigService);
  private readonly branding = inject(TenantBrandingService);

  /**
   * Estamos en el subdominio de una oficina (manfer.taxproffice.com) y no en el apex/app.
   * Sign-up y "encuentra tu oficina" son acciones de sistema (viven en app.<baseDomain>): en una
   * oficina concreta no tienen sentido y se ocultan. Se mira el HOST, no el slug guardado.
   */
  readonly isOfficeSubdomain = tenantSlugFromHost() !== null;

  /** Logo del tenant (o null → cae al asterisco de marca). Se llena tras el fetch pre-login. */
  readonly logoUrl = this.branding.logoUrl;
  readonly showLogoFallback = signal(false);

  constructor() {
    // En prod el tenant se resuelve por el subdominio: el slug llega por ?office=<slug>
    // (link del correo "encuentra tu oficina" o redirect post-signup) y lo fijamos antes
    // del login, para que la request vaya a https://<slug>.taxproffice.com. En dev es no-op
    // (tenantBase cae al gateway local y el tenant va por tenantId en el body).
    const office = this.route.snapshot.queryParamMap.get('office');
    if (office) {
      this.api.setSlug(office);
    }

    // Marca pre-login: en el subdominio de una oficina, pinta el tema/logo/favicon de ESA oficina
    // antes de autenticar (endpoint anónimo). Sin slug (app.*) no hace nada → marca del sistema.
    this.branding.applyForSurface('Crm');
  }

  form: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(3)]],
  });

  readonly showPassword = signal(false);
  readonly formError = signal<string | null>(null);
  readonly isTyping = signal(false);

  /** Fase de la coreografía de salida del login. */
  readonly phase = signal<LoginPhase>('idle');
  readonly isLoggingIn = computed(() => this.phase() !== 'idle');
  /** La tarjeta queda hundida desde 'sinking' en adelante. */
  readonly isSunk = computed(() => this.phase() !== 'idle' && this.phase() !== 'verifying');
  readonly showLoader = computed(() => this.phase() === 'loading' || this.phase() === 'fading');

  readonly loaderDots = Array.from({ length: 8 });

  /** Catálogo de planes: se elige antes de arrancar el alta. */
  readonly isPlanPickerOpen = signal(false);

  private typingTimeout: ReturnType<typeof setTimeout> | undefined;

  openPlanPicker(): void {
    this.isPlanPickerOpen.set(true);
  }

  closePlanPicker(): void {
    this.isPlanPickerOpen.set(false);
  }

  /**
   * Plan elegido → alta con ese plan ya seleccionado. El id y el ciclo viajan por query
   * params (no por estado en memoria) para que el enlace sea compartible y sobreviva a
   * un refresco a mitad del alta.
   *
   * El alta vive en el SITIO PÚBLICO (`{landingUrl}/register`), no en esta app, así que
   * se sale con `window.location` en vez del Router: son dominios distintos y el Router
   * solo enruta dentro del SPA. Sin `landingUrl` configurado (dev) se usa la ruta
   * interna, para no obligar a saltar a un sitio externo mientras se desarrolla.
   */
  startSignup(choice: PlanChoice): void {
    this.closePlanPicker();
    const params = new URLSearchParams({ plan: choice.plan.id, cycle: choice.cycle });

    const landing = environment.landingUrl?.trim().replace(/\/$/, '');
    if (landing) {
      window.location.assign(`${landing}/register?${params}`);
      return;
    }
    void this.router.navigate(['/onboarding'], {
      queryParams: { plan: choice.plan.id, cycle: choice.cycle },
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  onTyping(): void {
    this.isTyping.set(true);
    clearTimeout(this.typingTimeout);
    // La animación fluida sigue viva un momento después de la última tecla y luego se asienta.
    this.typingTimeout = setTimeout(() => this.isTyping.set(false), 800);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Please complete all fields correctly.');
      return;
    }

    this.formError.set(null);
    // No se desvía a /find-office por no tener oficina resuelta: el login funciona
    // igual contra el host de sistema (ver AuthService.base) y desviar aquí impedía
    // entrar desde la portada, que es justo donde se sirve el SPA.
    // 'verifying' = spinner en el botón mientras el backend responde.
    this.phase.set('verifying');

    const { email, password } = this.form.getRawValue();
    this.auth
      .login({
        tenantId: environment.tenantId,
        email,
        password,
        deviceToken: this.tokenService.getDeviceToken(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (outcome) => this.handleOutcome(outcome),
        error: (err) => this.handleError(err),
      });
  }

  private handleOutcome(outcome: LoginOutcome): void {
    switch (outcome.kind) {
      case 'authenticated':
        // Hidratar el usuario de sesión (GET /auth/me) antes de entrar al shell —
        // corre durante la animación de salida, así el perfil ya está cargado.
        this.auth
          .me()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({ error: () => {} });
        void this.playExitSequence();
        break;
      case 'mfa-required':
        void this.router.navigate(['/login/verify']);
        break;
      case 'mfa-setup-required':
        void this.router.navigate(['/login/setup-mfa']);
        break;
      case 'takeover-required':
        // Sesión única: ya hay sesión activa. El interstitial (modal root) toma el control.
        this.phase.set('idle');
        this.takeover.prompt(outcome.ticket);
        break;
      case 'wrong-portal':
        // Un cliente intentó entrar al CRM. Aviso neutral (sin revelar cliente/staff) y sin tocar su
        // sesión. No se redirige a propósito: el destino delataría el tipo de cuenta.
        this.phase.set('idle');
        this.formError.set("You can't sign in here.");
        break;
    }
  }

  private handleError(err: unknown): void {
    this.phase.set('idle');
    this.formError.set(this.messageFor(err));
  }

  /**
   * Mensajes en inglés, como el resto de la pantalla. `Auth.Invalid` es el 401 que
   * devuelve el backend tanto si el email no existe como si la contraseña es
   * incorrecta (es deliberado, no revela cuál de los dos), así que el texto tiene que
   * cubrir ambos casos y ofrecer una salida útil en vez de dejar al usuario atascado.
   */
  private messageFor(err: unknown): string {
    const apiError = toApiError(err);
    switch (apiError.code) {
      case 'Auth.Invalid':
        return "That email and password don't match. Check them and try again.";
      case 'Auth.LockedOut':
        return 'Your account is temporarily locked after too many attempts. Try again in a few minutes.';
      case 'Auth.TooManyAttempts':
        return 'Too many attempts. Please wait a moment before trying again.';
      // El backend no logró resolver la oficina por el Host y tampoco recibió un
      // TenantId: el subdominio no está registrado como dominio activo del tenant
      // (o el middleware de resolución no está activo). El usuario no puede hacer
      // nada al respecto, así que no se le pide "reintentar".
      case 'Auth.TenantIdRequired':
      case 'Tenant.NotFound':
        return "This office isn't set up for sign-in yet. Please contact support so they can finish configuring it.";
      case NETWORK_ERROR_CODE:
        return "We couldn't reach the server. Check your connection and try again.";
      default:
        return apiError.message || "We couldn't sign you in. Please try again.";
    }
  }

  /** Coreografía de salida: la tarjeta se hunde, el loader aparece y se navega. */
  private async playExitSequence(): Promise<void> {
    this.phase.set('sinking');
    await this.delay(500);
    this.phase.set('loading');
    await this.delay(1400);
    this.phase.set('fading');
    await this.delay(400);
    await this.router.navigateByUrl(this.returnUrl());
  }

  private returnUrl(): string {
    const url = this.route.snapshot.queryParamMap.get('returnUrl');
    if (!url || !url.startsWith('/') || url.startsWith('/login')) {
      return '/dashboard';
    }
    return url;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
