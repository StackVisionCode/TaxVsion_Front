import { Injectable, computed, inject, signal } from '@angular/core';
import { EMPTY, catchError, concatMap, of, retry, tap, timer } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { CheckoutIntentService } from '@core/billing/checkout-intent.service';
import { toApiError } from '@core/models/api-error.model';
import { SignupService } from './signup.service';
import { AccountDraft, SignupPlan, SignupStep } from './signup.model';

type SubdomainState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

/**
 * Estado del wizard de alta self-service + orquestación del aprovisionamiento real:
 * reservar subdominio → crear tenant (con ticket) → aceptar invitación → login → aceptar términos.
 * Al terminar deja la sesión lista con MFA pendiente (mfa-setup-required); el componente enruta a
 * la página de enrolamiento TOTP existente.
 */
@Injectable()
export class SignupStore {
  private readonly service = inject(SignupService);
  private readonly auth = inject(AuthService);
  private readonly checkoutIntent = inject(CheckoutIntentService);

  // Catálogo de planes
  readonly plans = signal<SignupPlan[]>([]);
  readonly loadingPlans = signal(false);
  readonly plansError = signal<string | null>(null);

  // Navegación del wizard
  readonly step = signal<SignupStep>('plan');
  readonly selectedPlan = signal<SignupPlan | null>(null);
  readonly billingCycle = signal<'Monthly' | 'Yearly'>('Monthly');

  // Disponibilidad de subdominio
  readonly subdomainState = signal<SubdomainState>('idle');

  // Aprovisionamiento
  readonly submitting = signal(false);
  readonly provisionError = signal<string | null>(null);
  /** Se pone true cuando el tenant quedó creado, la sesión iniciada y los términos aceptados. */
  readonly provisioned = signal(false);
  readonly createdTenantId = signal<string | null>(null);

  readonly hasPlans = computed(() => this.plans().length > 0);
  readonly canContinueFromPlan = computed(() => this.selectedPlan() !== null);

  loadPlans(): void {
    this.loadingPlans.set(true);
    this.plansError.set(null);
    this.service.list().subscribe({
      next: plans => {
        this.plans.set([...plans].sort((a, b) => a.monthlyPriceUsd - b.monthlyPriceUsd));
        this.loadingPlans.set(false);
      },
      error: err => {
        this.plansError.set(toApiError(err).message);
        this.loadingPlans.set(false);
      },
    });
  }

  selectPlan(plan: SignupPlan): void {
    this.selectedPlan.set(plan);
  }

  goToAccount(): void {
    if (this.canContinueFromPlan()) this.step.set('account');
  }

  goToPlan(): void {
    this.step.set('plan');
  }

  setBillingCycle(cycle: 'Monthly' | 'Yearly'): void {
    this.billingCycle.set(cycle);
  }

  checkSubdomain(slug: string): void {
    const clean = slug.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/.test(clean)) {
      this.subdomainState.set(clean.length === 0 ? 'idle' : 'invalid');
      return;
    }
    this.subdomainState.set('checking');
    this.service.checkSubdomain(clean).subscribe({
      next: res => this.subdomainState.set(res.available ? 'available' : 'taken'),
      error: () => this.subdomainState.set('idle'),
    });
  }

  /**
   * Aprovisiona la cuenta completa. Al terminar, la sesión queda iniciada con MFA pendiente y
   * `provisioned` en true — el componente enruta a /login/setup-mfa.
   */
  submitAccount(draft: AccountDraft): void {
    this.submitting.set(true);
    this.provisionError.set(null);

    const tz = this.resolveTimeZone();
    const slug = draft.subdomain.trim().toLowerCase();

    this.service
      .reserveSubdomain(slug, draft.email)
      .pipe(
        concatMap(reservation =>
          this.service.createTenant(reservation.registrationTicket, {
            name: draft.companyName,
            subdomain: slug,
            adminEmail: draft.email,
            defaultTimeZoneId: tz,
          })
        ),
        tap(tenant => this.createdTenantId.set(tenant.id)),
        // La invitación del admin la crea un consumer ASÍNCRONO al procesar TenantCreated, así que
        // puede no existir todavía apenas responde POST /tenants. Reintentamos con backoff (~1.2s x8)
        // hasta que aparezca — evita el 401 "Invitation is invalid or expired" por carrera.
        concatMap(tenant =>
          this.service
            .acceptInvitation({
              invitationToken: tenant.adminActivationToken,
              name: draft.firstName,
              lastName: draft.lastName,
              password: draft.password,
            })
            .pipe(
              retry({ count: 8, delay: () => timer(1200) }),
              concatMap(() => of(tenant))
            )
        ),
        // Login con el tenant recién creado (no environment.tenantId).
        concatMap(tenant =>
          this.auth.login({ tenantId: tenant.id, email: draft.email, password: draft.password })
        ),
        // Ya con sesión: aceptar términos del tenant (evita el 409 Terms.NotAccepted en /auth/me).
        concatMap(() => this.service.termsVersion().pipe(catchError(() => of({ currentVersion: '' })))),
        concatMap(status =>
          status.currentVersion
            ? this.service.acceptTerms(status.currentVersion).pipe(catchError(() => of(null)))
            : of(null)
        ),
        catchError(err => {
          this.provisionError.set(toApiError(err).message);
          this.submitting.set(false);
          return EMPTY;
        })
      )
      .subscribe(() => {
        this.submitting.set(false);
        this.provisioned.set(true);
        this.step.set('done');
        // Deja el plan elegido para retomar el pago tras el enrolamiento MFA (checkout).
        const plan = this.selectedPlan();
        if (plan) {
          this.checkoutIntent.set({
            planCode: plan.code,
            planName: plan.name,
            billingCycle: this.billingCycle(),
            priceUsd: plan.pricesUsdByCycle?.[this.billingCycle()] ?? plan.monthlyPriceUsd,
          });
        }
      });
  }

  private resolveTimeZone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    } catch {
      return 'America/New_York';
    }
  }
}
