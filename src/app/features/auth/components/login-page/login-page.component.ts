import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
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
import { LoginTransitionService } from '@core/auth/login-transition.service';
import { TokenService } from '@core/auth/token.service';
import { ApiConfigService, tenantSlugFromHost } from '@core/config/api-config.service';
import { landingUrl } from '@core/config/landing';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { RoutePrefetchService } from '@core/performance/route-prefetch.service';
import { loginNoticeFor } from '@core/auth/session-notice';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';
import { prefersReducedMotion } from '@shared/utils/reduced-motion.util';
import {
  PlanChoice,
  PlanPickerModalComponent,
} from '../../ui/plan-picker-modal/plan-picker-modal.component';

type LoginPhase = 'idle' | 'verifying' | 'sinking';

/**
 * Login conectado al backend TaxPro Office vía AuthService. Al enviar: se llama a
 * POST /auth/login; si hay tokens se reproduce la coreografía de salida (la tarjeta
 * se hunde, arranca la escena de transición global —`LoginTransitionService`, montada
 * en la raíz— y se navega al dashboard/returnUrl); si el backend pide MFA se enruta a
 * /login/verify o /login/setup-mfa. En modo mock (`environment.authMock`) el login es
 * sintético y entra directo.
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
  private readonly prefetch = inject(RoutePrefetchService);
  private readonly transition = inject(LoginTransitionService);

  /**
   * Duraciones de la coreografía de salida. La espera previa a navegar dura lo que dure el
   * trabajo REAL (perfil + código del dashboard), con techo. El piso visible y el fade final
   * ya no viven acá: los gobierna `LoginTransitionService`, que además sigue cubriendo la
   * pantalla hasta que el shell pintó.
   */
  private static readonly SINK_MS = 180;
  /** Techo: un backend lento no debe retrasar la navegación más que esto. */
  private static readonly MAX_LOADER_MS = 2000;

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

    const reason = this.route.snapshot.queryParamMap.get('reason');
    if (reason) {
      this.notice.set(loginNoticeFor(reason));
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

  /**
   * Por qué se volvió a login. Se llega acá con la sesión ya cerrada y sin explicación: sin este
   * aviso, al usuario le parece que la aplicación se cayó sola. No es un error suyo, así que no se
   * pinta como el `formError`.
   */
  readonly notice = signal<string | null>(null);

  readonly isTyping = signal(false);

  /** Fase de la coreografía de salida del login. */
  readonly phase = signal<LoginPhase>('idle');
  readonly isLoggingIn = computed(() => this.phase() !== 'idle');
  /** La tarjeta queda hundida desde 'sinking' en adelante. */
  readonly isSunk = computed(() => this.phase() === 'sinking');

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
   * El alta vive en el Landing (otro origen), así que se sale con `window.location` y no con el Router.
   */
  startSignup(choice: PlanChoice): void {
    this.closePlanPicker();
    const params = new URLSearchParams({ plan: choice.plan.id, cycle: choice.cycle });
    window.location.assign(landingUrl(`/register?${params}`));
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
      case 'authenticated': {
        // El trabajo REAL que hay que tener listo antes de entrar al shell: el perfil de
        // sesión (GET /auth/me, que el navbar y el shell leen) y el CÓDIGO del dashboard.
        // Arrancan los dos YA, en paralelo, y la coreografía de salida dura lo que duren
        // ellos — no 2300 ms de setTimeout. Al llegar al router, el chunk del dashboard ya
        // está en memoria, así que desaparece también su waterfall de carga.
        const ready = Promise.allSettled([
          firstValueFrom(this.auth.me()),
          this.prefetch.warmDashboard(),
        ]);
        void this.playExitSequence(ready);
        break;
      }
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

  /**
   * Coreografía de salida gobernada por el trabajo real, no por el reloj: la tarjeta se
   * hunde, arranca la escena global y se navega cuando `ready` (perfil + chunk del dashboard)
   * resuelve.
   *
   * `MAX_LOADER_MS` evita retrasar la navegación si /auth/me no responde — el shell tolera
   * `currentUser()` nulo (`app-shell.component.ts` lo lee con `?.`). La escena es global
   * (root) y sobrevive al cambio de ruta: ella decide cuándo desvanecerse (tras el primer
   * pintado del destino), así que acá ya no hay fases "loading"/"fading".
   */
  private async playExitSequence(ready: Promise<unknown>): Promise<void> {
    this.phase.set('sinking');
    if (!prefersReducedMotion()) {
      await this.delay(LoginPageComponent.SINK_MS);
    }
    this.transition.start();
    await Promise.race([ready, this.delay(LoginPageComponent.MAX_LOADER_MS)]);

    // Si la navegación no termina (guard rechazado, /auth/me/access colgado), la escena se
    // retira sola a MAX_VISIBLE_MS: devolver la tarjeta para no dejar la pantalla en blanco.
    const navigated = await Promise.race([
      this.router.navigateByUrl(this.returnUrl()),
      this.delay(LoginTransitionService.MAX_VISIBLE_MS).then(() => false),
    ]).catch(() => false);
    if (!navigated) {
      this.transition.cancel();
      this.phase.set('idle');
    }
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
