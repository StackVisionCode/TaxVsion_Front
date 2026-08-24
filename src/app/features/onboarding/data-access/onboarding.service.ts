import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  CompleteRegistrationResponse,
  CreateChallengeResponse,
  CreateOnboardingResponse,
  OnboardingCodes,
  OnboardingPlan,
  OnboardingStatusResponse,
  PreviewRegistrationResponse,
  StartCheckoutResponse,
  SubdomainReservationResponse,
  TermsVersionResponse,
} from './onboarding.model';

/**
 * Llamadas HTTP del alta pago-primero (todas anónimas — el comprador no tiene sesión ni tenant).
 * Route-scoped (@Injectable sin providedIn): vive solo mientras la rama /onboarding o /register
 * está activa. Base = systemBase (api.taxproffice.com en prod): el onboarding es pre-tenant.
 */
@Injectable()
export class OnboardingService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  // Sistema: el onboarding es pre-tenant (aún no existe el subdominio).
  private get base(): string {
    return this.api.systemBase();
  }

  /** Catálogo público de planes. */
  listPlans(): Observable<OnboardingPlan[]> {
    return this.http.get<OnboardingPlan[]>(`${this.base}/plans`);
  }

  /** Alias del catálogo para el wizard nuevo. */
  getPlans(): Observable<OnboardingPlan[]> {
    return this.listPlans();
  }

  /** Crea el desafío de verificación de email (envía el OTP). */
  createChallenge(email: string, firstNameHint?: string): Observable<CreateChallengeResponse> {
    return this.http.post<CreateChallengeResponse>(`${this.base}/onboarding/email-challenges`, {
      email,
      firstNameHint: firstNameHint ?? null,
    });
  }

  /** Variante con body del wizard nuevo. */
  createEmailChallenge(body: { email: string; firstNameHint?: string }): Observable<CreateChallengeResponse> {
    return this.createChallenge(body.email, body.firstNameHint);
  }

  /** Verifica el código OTP. 204 No Content si es correcto. */
  verifyChallenge(challengeId: string, code: string): Observable<unknown> {
    return this.http.post(`${this.base}/onboarding/email-challenges/${challengeId}/verify`, { code });
  }

  /** Variante con body del wizard nuevo. */
  verifyEmailChallenge(challengeId: string, body: { code: string }): Observable<unknown> {
    return this.verifyChallenge(challengeId, body.code);
  }

  /** Reenvía el OTP. 202 Accepted. */
  resendChallenge(challengeId: string): Observable<unknown> {
    return this.http.post(`${this.base}/onboarding/email-challenges/${challengeId}/resend`, {});
  }

  /** Alias para el wizard nuevo. */
  resendEmailChallenge(challengeId: string): Observable<unknown> {
    return this.resendChallenge(challengeId);
  }

  /**
   * Crea el TenantOnboarding (pre-tenant). Requiere el challenge ya verificado.
   * `billingCycle` ausente = Monthly (default del backend).
   */
  createOnboarding(body: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    planId: string;
    emailVerificationChallengeId: string;
    billingCycle?: 'Monthly' | 'Yearly';
  }): Observable<CreateOnboardingResponse> {
    return this.http.post<CreateOnboardingResponse>(`${this.base}/onboarding`, {
      ...body,
      billingCycle: body.billingCycle ?? null,
    });
  }

  /**
   * Aplica los códigos (apilados, opcionales) y arranca el checkout. Devuelve `fullyCovered`
   * (sin cobro) o un `checkoutUrl` de Stripe hosted al que se redirige con salto de página.
   */
  startCheckout(body: {
    onboardingId: string;
    payerEmail: string;
    successUrl: string;
    cancelUrl: string;
    codes?: OnboardingCodes;
  }): Observable<StartCheckoutResponse> {
    return this.http.post<StartCheckoutResponse>(`${this.base}/onboarding/checkout`, {
      onboardingId: body.onboardingId,
      payerEmail: body.payerEmail,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      referralCode: body.codes?.referralCode?.trim() || null,
      promoCode: body.codes?.promoCode?.trim() || null,
      giftCode: body.codes?.giftCode?.trim() || null,
    });
  }

  // ── Post-pago: canje del RegistrationToken emailado ───────────────────────

  /** Resuelve al comprador desde el token del email, antes de mostrar el formulario final. */
  previewRegistration(token: string): Observable<PreviewRegistrationResponse> {
    return this.http.post<PreviewRegistrationResponse>(`${this.base}/onboarding/register/preview`, { token });
  }

  /** Chequea y reserva (TTL 60 min) el subdominio elegido para este onboarding. */
  checkSubdomain(body: { slug: string; token: string }): Observable<SubdomainReservationResponse> {
    return this.http.post<SubdomainReservationResponse>(`${this.base}/onboarding/subdomains/check`, body);
  }

  /** Canjea el token y arranca el provisioning. 202 Accepted; el token se consume acá. */
  completeRegistration(body: {
    token: string;
    password: string;
    officeName: string;
    subdomain: string;
    termsAccepted: boolean;
    termsVersionId: string;
  }): Observable<CompleteRegistrationResponse> {
    return this.http.post<CompleteRegistrationResponse>(`${this.base}/onboarding/register/complete`, body);
  }

  /** Polling público del provisioning. El mismo token sigue resolviendo tras consumirse. */
  getStatus(token: string): Observable<OnboardingStatusResponse> {
    return this.http.get<OnboardingStatusResponse>(`${this.base}/onboarding/status`, { params: { token } });
  }

  /** Versión legal vigente que el comprador debe aceptar en el formulario final. */
  getCurrentTerms(kind = 'TermsOfService', locale = 'en-US'): Observable<TermsVersionResponse> {
    return this.http.get<TermsVersionResponse>(`${this.base}/auth/onboarding/terms/current`, {
      params: { kind, locale },
    });
  }

  /** HTML del documento legal, para renderizarlo inline en el modal de términos. */
  getTermsContent(termsVersionId: string): Observable<string> {
    return this.http.get(`${this.base}/auth/onboarding/terms/${termsVersionId}/content`, {
      responseType: 'text',
    });
  }
}
