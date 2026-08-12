import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import {
  CreateChallengeResponse,
  CreateOnboardingResponse,
  OnboardingCodes,
  OnboardingPlan,
  StartCheckoutResponse,
} from './onboarding.model';

/**
 * Llamadas HTTP del alta pago-primero (todas anónimas — el comprador no tiene sesión ni tenant).
 * Route-scoped (@Injectable sin providedIn): vive solo mientras la rama /onboarding está activa.
 * Base = gateway YARP (environment.apiUrl).
 */
@Injectable()
export class OnboardingService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Catálogo público de planes. */
  listPlans(): Observable<OnboardingPlan[]> {
    return this.http.get<OnboardingPlan[]>(`${this.base}/plans`);
  }

  /** Crea el desafío de verificación de email (envía el OTP). */
  createChallenge(email: string, firstNameHint?: string): Observable<CreateChallengeResponse> {
    return this.http.post<CreateChallengeResponse>(`${this.base}/onboarding/email-challenges`, {
      email,
      firstNameHint: firstNameHint ?? null,
    });
  }

  /** Verifica el código OTP. 204 No Content si es correcto. */
  verifyChallenge(challengeId: string, code: string): Observable<unknown> {
    return this.http.post(`${this.base}/onboarding/email-challenges/${challengeId}/verify`, { code });
  }

  /** Reenvía el OTP. 202 Accepted. */
  resendChallenge(challengeId: string): Observable<unknown> {
    return this.http.post(`${this.base}/onboarding/email-challenges/${challengeId}/resend`, {});
  }

  /** Crea el TenantOnboarding (pre-tenant). Requiere el challenge ya verificado. */
  createOnboarding(body: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    planId: string;
    emailVerificationChallengeId: string;
    billingCycle: 'Monthly' | 'Yearly';
  }): Observable<CreateOnboardingResponse> {
    return this.http.post<CreateOnboardingResponse>(`${this.base}/onboarding`, body);
  }

  /**
   * Aplica los códigos (apilados) y arranca el checkout. Devuelve `fullyCovered` (sin cobro) o un
   * `checkoutUrl` de Stripe. success/cancelUrl vuelven a esta misma página con ?status=.
   */
  startCheckout(body: {
    onboardingId: string;
    payerEmail: string;
    successUrl: string;
    cancelUrl: string;
    codes: OnboardingCodes;
  }): Observable<StartCheckoutResponse> {
    return this.http.post<StartCheckoutResponse>(`${this.base}/onboarding/checkout`, {
      onboardingId: body.onboardingId,
      payerEmail: body.payerEmail,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      referralCode: body.codes.referralCode?.trim() || null,
      promoCode: body.codes.promoCode?.trim() || null,
      giftCode: body.codes.giftCode?.trim() || null,
    });
  }
}
