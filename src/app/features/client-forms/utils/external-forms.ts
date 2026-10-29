import { HttpErrorResponse } from '@angular/common/http';
import { toApiError } from '@core/models/api-error.model';
import type { ActiveConsentNotice } from '../data-access/client-forms.model';

/** Defensa: el endpoint ya filtra, pero solo un aviso IdentityVerification publicado sirve de entrada (D-35). */
export function isEntryNotice(notice: ActiveConsentNotice): boolean {
  return notice.purpose === 'IdentityVerification' && notice.versionNumber > 0;
}

// Mismo tope que `ParticipantEmail` (≤ 254); el backend normaliza y valida de nuevo.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return email.length > 0 && email.length <= 254 && EMAIL_PATTERN.test(email);
}

/** El CRM corre en el host del tenant: el enlace público usa ese mismo origen. */
export function intakeLinkUrl(token: string, origin: string = window.location.origin): string {
  return `${origin}/intake/${token}`;
}

/** Códigos del backend (P-14) traducidos a copy; lo desconocido usa el mensaje del backend. */
const EXTERNAL_ERROR_MESSAGES: Record<string, string> = {
  'FormParticipant.InvalidEmail': 'Enter a valid email address.',
  'FormParticipant.InvalidContact': 'Check the recipient name.',
  'FormRequest.AlreadyOpenForTemplate':
    'This person already has an open request for this form. Resend the link from that request instead.',
  'FormRequest.TemplateNotPublished': 'This template has no published version.',
  'FormRequest.ResponsibleNotAuthorized':
    "The responsible staff member doesn't have the permissions this form's automations need.",
  'FormRequest.TextContainsSensitiveData':
    'Remove tax identifiers or card numbers from the title and message.',
  // Con externos apagados el backend responde "no existe" para no revelar nada.
  'FormRequest.NotFound': 'Sending forms to external emails is turned off for this office.',
  'intake.entry_notice_required': 'Choose a published identity verification notice.',
  'FormAccessGrant.IssueLimit':
    'This link was already resent the maximum number of times. Cancel this request and send a new one.',
  'FormAccessGrant.Invalid': "The link couldn't be resent. Try again.",
  'FormIntakeLink.Unavailable':
    'Intake links are turned off for this office. They need bot protection (Turnstile) to be configured first.',
  'FormIntakeLink.NotFound': 'This intake link no longer exists.',
  'FormIntakeLink.Invalid': "The template or version isn't valid for this link, or the link can't change state.",
  'FormIntakeLink.ConcurrencyConflict':
    'Someone else changed this link. The list was refreshed; try again.',
  'FormIntakeLink.ResponsibleUnavailable': 'The responsible staff member is not active.',
  'FormIntakeLink.InvalidRowVersion': 'This link is out of date. Refresh and try again.',
};

export function externalErrorMessage(error: unknown): string {
  const apiError = toApiError(error);
  return EXTERNAL_ERROR_MESSAGES[apiError.code] ?? apiError.message;
}

// Reenvío: "no existe" aquí no significa que la oficina apagó los externos.
const RESEND_ERROR_MESSAGES: Record<string, string> = {
  // 409: request de enlace de captación o sin acceso personal.
  'FormRequest.NoAccessLink': 'This request has no personal access link to resend.',
  // 409: fuera de Pending o Returned.
  'FormRequest.ResendNotAllowed': 'Links can only be resent while the request is pending or returned.',
  // 404: externos apagados para la oficina o la request dejó de ser visible.
  'FormRequest.NotFound':
    "This request can't be resent. Sending to external emails may be turned off, or you no longer have access to it.",
};

export function resendErrorMessage(error: unknown): string {
  const code = toApiError(error).code;
  return RESEND_ERROR_MESSAGES[code] ?? externalErrorMessage(error);
}

export function externalErrorCode(error: unknown): string {
  return toApiError(error).code;
}

/** 409 de envío externo a un email de cliente; `customerId` solo llega si el usuario ve al cliente. */
export interface CustomerEmailConflict {
  message: string;
  customerId: string | null;
}

export const EMAIL_BELONGS_TO_CUSTOMER = 'FormParticipant.EmailBelongsToCustomer';

export function customerEmailConflict(error: unknown): CustomerEmailConflict | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return null;
  const apiError = toApiError(error);
  if (apiError.code !== EMAIL_BELONGS_TO_CUSTOMER) return null;
  const body = (error.error ?? {}) as { customerId?: unknown; metadata?: { customerId?: unknown } };
  const customerId = body.customerId ?? body.metadata?.customerId;
  return {
    message: apiError.message,
    customerId: typeof customerId === 'string' && customerId ? customerId : null,
  };
}
