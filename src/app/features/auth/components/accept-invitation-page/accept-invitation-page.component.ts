import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { toApiError } from '@core/models/api-error.model';
import { ApiConfigService, tenantSlugFromHost } from '@core/config/api-config.service';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { environment } from '@env/environment';
import { AuthShellComponent } from '../../../onboarding/ui/auth-shell/auth-shell.component';
import { InvitationService, InvitationValidation } from '../../data-access/invitation.service';
import { BrandLogoComponent } from '@core/theme/brand-logo.component';

type Phase = 'validating' | 'form' | 'submitting' | 'done' | 'invalid';

/**
 * Canje de una invitación (equipo o cliente): `/accept-invitation?token=…`.
 *
 * Es la pantalla a la que apunta el correo que emite Notification (mismo enlace para empleado y cliente).
 * En load valida el token contra `GET /auth/invitations/validate` para: (a) pintar el branding de la OFICINA
 * REAL del token — no la del subdominio de la URL; (b) si se abrió en otro subdominio, rebotar al correcto;
 * (c) si la invitación ya se usó/venció/canceló, mostrar un mensaje profesional en vez del formulario (antes
 * el canje idempotente devolvía "You're all set" al reusar el enlace). Solo con estado `Pending` se muestra
 * el formulario. Al terminar, el "Sign in" lleva al login correcto según el tipo de invitado (portal vs CRM).
 */
@Component({
  selector: 'app-accept-invitation-page',
  imports: [BrandLogoComponent, CommonModule, ReactiveFormsModule, RouterLink, AuthShellComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './accept-invitation-page.component.html',
})
export class AcceptInvitationPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly invitations = inject(InvitationService);
  private readonly api = inject(ApiConfigService);
  private readonly branding = inject(TenantBrandingService);
  private readonly destroyRef = inject(DestroyRef);

  /** Token del enlace. Sin él no hay nada que canjear. */
  readonly token = signal(this.route.snapshot.queryParamMap.get('token') ?? '');
  readonly hasToken = computed(() => this.token().trim().length > 0);

  readonly phase = signal<Phase>('validating');
  readonly formError = signal<string | null>(null);
  readonly showPassword = signal(false);

  /** Estado devuelto por validate — decide el copy de la pantalla "ya no es válida". */
  private readonly validationStatus = signal<string>('');
  private readonly actorType = signal<string | null>(null);
  private readonly tenant = signal<InvitationValidation['tenant']>(null);

  readonly isSubmitting = computed(() => this.phase() === 'submitting');

  /** Copy de la pantalla de invitación no hábil, según el estado real del token. */
  readonly invalidMessage = computed(() => {
    switch (this.validationStatus()) {
      case 'Accepted':
        return "This invitation has already been used. If that was you, sign in with your email and password.";
      case 'Expired':
        return 'This invitation has expired. Ask your office to send you a new one.';
      case 'Cancelled':
        return 'This invitation was cancelled by your office. Ask them to send you a new one.';
      default:
        return "This invitation link is invalid or incomplete. Ask your office to send you a new one.";
    }
  });

  /** Solo una invitación ya aceptada ofrece "Sign in" (la cuenta existe); el resto no. */
  readonly showSignIn = computed(() => this.validationStatus() === 'Accepted');

  readonly form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  ngOnInit(): void {
    const token = this.token().trim();
    if (!token) {
      this.validationStatus.set('Invalid');
      this.phase.set('invalid');
      return;
    }

    this.invitations
      .validate(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => this.onValidated(result),
        // Un fallo transitorio de validate no debe impedir un canje legítimo: se cae al formulario y el
        // propio POST /accept vuelve a validar el token del lado del servidor.
        error: () => this.phase.set('form'),
      });
  }

  private onValidated(result: InvitationValidation): void {
    this.validationStatus.set(result.status);
    this.actorType.set(result.actorType);
    this.tenant.set(result.tenant);

    const office = result.tenant;
    if (office) {
      // El enlace se abrió en otro subdominio: rebotar al de la oficina real del token (branding + URL + el
      // login posterior quedan coherentes). Solo en prod (en dev hay un solo host).
      if (environment.production) {
        const hostSlug = tenantSlugFromHost();
        if (hostSlug && hostSlug !== office.subDomain) {
          window.location.href =
            `https://${office.subDomain}.${environment.baseDomain}/accept-invitation` +
            `?token=${encodeURIComponent(this.token().trim())}`;
          return;
        }
      }
      // Pintar el branding de la oficina del token (por su slug), no el del host de la URL.
      this.api.setSlug(office.subDomain);
      this.branding.applyForSurface('Crm');
    }

    this.phase.set(result.status === 'Pending' ? 'form' : 'invalid');
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(visible => !visible);
  }

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      this.formError.set('Please complete all fields.');
      return;
    }

    const { name, lastName, password } = this.form.getRawValue();
    this.phase.set('submitting');
    this.formError.set(null);

    this.invitations
      .accept({ invitationToken: this.token().trim(), name, lastName, password })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.phase.set('done'),
        error: err => {
          this.phase.set('form');
          this.formError.set(this.messageFor(err));
        },
      });
  }

  /** Un cliente de portal firma en el Portal, no en el CRM; el staff, en el CRM. */
  goToLogin(): void {
    if (this.actorType() === 'CustomerPortal') {
      const portalUrl = this.portalLoginUrl();
      if (portalUrl) {
        window.location.href = portalUrl;
        return;
      }
    }
    void this.router.navigateByUrl('/login');
  }

  private portalLoginUrl(): string | null {
    const office = this.tenant();
    if (environment.production && office) {
      return `https://${office.subDomain}.${environment.baseDomain}/portal/`;
    }
    return environment.portalDevUrl ?? null;
  }

  private messageFor(err: unknown): string {
    const apiError = toApiError(err);
    switch (apiError.code) {
      case 'Auth.InvalidInvitation':
        return 'This invitation is no longer valid. Ask your office to send a new one.';
      case 'Auth.TooManyAttempts':
        return 'Too many attempts. Please try again in a few minutes.';
      default:
        return apiError.message || 'We could not complete your invitation. Please try again.';
    }
  }
}
