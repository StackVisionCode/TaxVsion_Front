import { ApiError, NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';

/**
 * Copy de usuario para los errores del módulo Onboarding.
 *
 * Regla del contrato (§4): **ramificar por `code`, nunca por status HTTP**. Casi
 * todos los errores de Onboarding —incluido el throttling de negocio
 * (`OtpRateLimited`, `ResendCooldown`, `ResendLimitExceeded`)— caen en el 400 por
 * defecto de `ErrorHttpMapping`, no en 429.
 *
 * La excepción es el rate limiter de ASP.NET, que corta antes del handler y
 * responde un **429 pelado, sin body JSON** — `toApiError()` lo normaliza a
 * `Http.429` y acá se le da su propio mensaje.
 */
const MESSAGES: Record<string, string> = {
  // Rate limiter de infraestructura (429 sin body) y red.
  'Http.429': 'Too many attempts. Please wait a moment and try again.',
  [NETWORK_ERROR_CODE]: "We couldn't reach the server. Check your connection and try again.",

  // OTP de email.
  'Onboarding.Email': 'Please enter a valid email address.',
  'Onboarding.OtpRateLimited': 'Too many codes requested. Please try again in an hour.',
  'Onboarding.ChallengeNotFound': 'This verification session expired. Please start again.',
  'Onboarding.OtpExpired': 'That code expired. Request a new one.',
  'Onboarding.OtpLocked': 'Too many incorrect attempts. Please start again with a new code.',
  'Onboarding.OtpMismatch': "That code doesn't match. Check it and try again.",
  'Onboarding.ResendCooldown': 'Please wait a moment before requesting another code.',
  'Onboarding.ResendLimitExceeded': "You've reached the resend limit. Please start again.",

  // Creación del onboarding.
  'Onboarding.ChallengeEmailMismatch': "The verified email doesn't match. Please start again.",
  'Onboarding.EmailNotVerified': 'Please verify your email before continuing.',
  'Onboarding.Name': 'Please check your first and last name.',
  'Onboarding.Plan': 'Please choose a plan.',

  // Checkout.
  'Onboarding.NotFound': "We couldn't find your signup. Please start again.",
  'Onboarding.InvalidState': 'This signup already moved past payment. Please start again.',
  'Subscription.Plan.NotFound': 'That plan is no longer available. Please choose another one.',
  'Subscription.Plan.NoMonthlyPrice': 'That plan is not available for purchase right now.',

  // RegistrationToken.
  'Onboarding.InvalidToken': 'This registration link is not valid.',
  'Onboarding.TokenUsed': 'This registration was already completed.',
  'Onboarding.TokenExpired': 'This registration link has expired.',
  'Onboarding.NoToken': 'This registration link is not valid.',

  // Subdominio.
  'Onboarding.SubdomainTaken': 'That address is already taken. Try another one.',
  'Onboarding.SubdomainReservedTemporarily': 'Someone is claiming that address right now. Try another one.',
  'Onboarding.SubdomainNotReserved': 'Please check your address availability before continuing.',
  'TenantDomain.SlugLength': 'Use between 3 and 63 characters.',
  'TenantDomain.SlugInvalid': 'Use only lowercase letters, numbers and hyphens.',
  'TenantDomain.SlugReserved': 'That address is reserved. Try another one.',

  // Términos.
  'Onboarding.TermsNotAccepted': 'You need to accept the terms to continue.',
  'Onboarding.TermsVersionNotCurrent': 'Our terms were just updated. Please review and accept them again.',
  'Onboarding.TermsContentHashMissing': 'We could not verify the terms. Please reload the page.',
  'TermsVersion.NotFound': 'We could not load the current terms. Please reload the page.',
};

/**
 * Copy de un código conocido. Se usa también para los códigos que llegan como
 * dato y no como error HTTP — el `reason` de `subdomains/check`, que viaja
 * dentro de un 200, y los del validador local de slug.
 */
export function messageForCode(code: string, fallback = 'Something went wrong. Please try again.'): string {
  return MESSAGES[code] ?? fallback;
}

/** Normaliza cualquier error HTTP y devuelve `{ code, message }` listo para mostrar. */
export function toOnboardingError(err: unknown): ApiError {
  const apiError = toApiError(err);
  const message = MESSAGES[apiError.code];
  return message ? { code: apiError.code, message } : apiError;
}

/** Atajo cuando solo hace falta el texto. */
export function onboardingErrorMessage(err: unknown): string {
  return toOnboardingError(err).message;
}

/** Errores del RegistrationToken que no tienen recuperación dentro del formulario. */
const TERMINAL_TOKEN_CODES = ['Onboarding.InvalidToken', 'Onboarding.TokenUsed', 'Onboarding.TokenExpired'];

export function isTerminalTokenError(code: string): boolean {
  return TERMINAL_TOKEN_CODES.includes(code);
}
