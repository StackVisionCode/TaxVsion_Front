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
import { CentralLoginService } from '@core/auth/central-login.service';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { DiscoverOffice, DiscoverOutcome } from '@core/auth/central-login.model';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';
import {
  PlanChoice,
  PlanPickerModalComponent,
} from '../../ui/plan-picker-modal/plan-picker-modal.component';

type Step = 'credentials' | 'select';

/**
 * Login central de app.taxproffice.com: el usuario teclea email+password sin saber su subdominio.
 * discover-login lo autentica contra todas sus oficinas; con una sola sin MFA saltamos directo al
 * canje, con varias (o MFA) mostramos el selector. Al resolver, se redirige al subdominio de la
 * oficina para canjear el vale allí (CentralLoginService.continueUrl).
 */
@Component({
  selector: 'app-central-login-page',
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule, PlanPickerModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './central-login-page.component.html',
  styleUrl: './central-login-page.component.css',
})
export class CentralLoginPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly centralLogin = inject(CentralLoginService);
  private readonly branding = inject(TenantBrandingService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Modo portal (ruta `/client`): el destino tras autenticar es el portal del cliente
   * (`/portal/client/auth/continue`), no el CRM del staff. También oculta el alta (los clientes no
   * se auto-registran, llegan por invitación).
   */
  readonly portal = this.route.snapshot.data['portal'] === true;

  /** Logo del sistema (o null → cae al asterisco). Se llena tras el fetch de la marca del sistema. */
  readonly logoUrl = this.branding.logoUrl;
  readonly showLogoFallback = signal(false);

  constructor() {
    // El login central es agnóstico de oficina: aplica la marca del SISTEMA (plataforma) —
    // logo/colores/favicon — según la superficie (portal o CRM). Aditivo, con fallback total.
    this.branding.applyForSystem(this.portal ? 'Portal' : 'Crm');
  }

  form: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(3)]],
  });

  readonly step = signal<Step>('credentials');
  readonly showPassword = signal(false);
  readonly formError = signal<string | null>(null);
  readonly isBusy = signal(false);

  /** Oficinas devueltas por el selector y la referencia de la sesión de descubrimiento. */
  readonly offices = signal<DiscoverOffice[]>([]);
  private sessionRef = '';

  /**
   * Una sola oficina (que llegó por la rama de selección porque exige MFA): no tiene sentido pintar
   * un "elige tu oficina" de un solo ítem, se va directo al prompt del código.
   */
  readonly onlyOffice = computed(() => (this.offices().length === 1 ? this.offices()[0] : null));

  /** Oficina elegida que está pidiendo MFA (su tenantId), y el código tecleado. */
  readonly mfaOfficeId = signal<string | null>(null);
  readonly mfaCode = signal('');

  /** Catálogo de planes: se elige antes de arrancar el alta (mismo flujo que el login directo). */
  readonly isPlanPickerOpen = signal(false);

  openPlanPicker(): void {
    this.isPlanPickerOpen.set(true);
  }

  closePlanPicker(): void {
    this.isPlanPickerOpen.set(false);
  }

  /**
   * Plan elegido → alta con ese plan ya seleccionado (id y ciclo por query, para que el enlace sea
   * compartible). El alta vive en el sitio público (`{landingUrl}/register`); sin landingUrl (dev)
   * se queda en la ruta interna /onboarding.
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

  submitCredentials(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Please enter your email and password.');
      return;
    }
    this.formError.set(null);
    this.isBusy.set(true);

    const { email, password } = this.form.getRawValue();
    this.centralLogin
      .discover(email, password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (outcome) => this.handleDiscover(outcome),
        error: (err) => this.fail(err),
      });
  }

  /** El usuario elige una oficina en el selector. */
  chooseOffice(office: DiscoverOffice): void {
    this.formError.set(null);
    if (office.mfaRequired) {
      // Revela el campo de código para esta oficina; el canje espera al submit del MFA.
      this.mfaOfficeId.set(office.tenantId);
      this.mfaCode.set('');
      return;
    }
    this.requestHandoff(office.tenantId, null, office.isClientPortal);
  }

  /** Envía el código MFA de la oficina seleccionada. */
  submitMfa(office: DiscoverOffice): void {
    const code = this.mfaCode().trim();
    if (!code) {
      this.formError.set('Enter your verification code.');
      return;
    }
    this.requestHandoff(office.tenantId, code, office.isClientPortal);
  }

  cancelMfa(): void {
    this.mfaOfficeId.set(null);
    this.mfaCode.set('');
    this.formError.set(null);
  }

  /** Vuelve al paso de credenciales (en la vista de una sola oficina no hay selector al que volver). */
  backToCredentials(): void {
    this.step.set('credentials');
    this.offices.set([]);
    this.mfaOfficeId.set(null);
    this.mfaCode.set('');
    this.formError.set(null);
  }

  private handleDiscover(outcome: DiscoverOutcome): void {
    if (outcome.kind === 'direct') {
      this.redirectToOffice(outcome.subdomain, outcome.ticket, outcome.isClientPortal);
      return;
    }
    // Varias oficinas o MFA pendiente: mostrar el selector.
    this.isBusy.set(false);
    this.sessionRef = outcome.sessionRef;
    this.offices.set(outcome.offices);
    this.step.set('select');
  }

  private requestHandoff(
    chosenTenantId: string,
    mfaCode: string | null,
    isClientPortal: boolean,
  ): void {
    this.formError.set(null);
    this.isBusy.set(true);
    this.centralLogin
      .handoff(this.sessionRef, chosenTenantId, mfaCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (view) => this.redirectToOffice(view.subdomain, view.ticket, isClientPortal),
        error: (err) => this.fail(err),
      });
  }

  /**
   * Salta al subdominio de la oficina a canjear el vale (cruza de origen en prod). El destino lo
   * decide el ACTOR, no la página de entrada: un cliente (CustomerPortal) va al portal aunque haya
   * entrado por el login del staff; el staff va al CRM. Así un cliente nunca aterriza en el CRM.
   */
  private redirectToOffice(subdomain: string, ticket: string, isClientPortal: boolean): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    window.location.assign(
      this.centralLogin.continueUrl(subdomain, ticket, returnUrl, isClientPortal),
    );
  }

  private fail(err: unknown): void {
    this.isBusy.set(false);
    this.formError.set(this.messageFor(err));
  }

  private messageFor(err: unknown): string {
    const apiError = toApiError(err);
    switch (apiError.code) {
      case 'Auth.Invalid':
        return "That email and password don't match. Check them and try again.";
      case 'Auth.LockedOut':
        return 'Too many attempts. Please wait a few minutes before trying again.';
      case 'Auth.MfaInvalid':
        return "That code isn't valid or has expired. Enter a fresh one and try again.";
      case 'Auth.HandoffInvalid':
        return 'Your sign-in session expired. Please enter your details again.';
      case NETWORK_ERROR_CODE:
        return "We couldn't reach the server. Check your connection and try again.";
      default:
        return apiError.message || "We couldn't sign you in. Please try again.";
    }
  }
}
