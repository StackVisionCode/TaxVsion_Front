import { HttpErrorResponse } from '@angular/common/http';
import { toApiError } from '@core/models/api-error.model';
import { formatPhoneForDisplay, isValidPhone } from '@shared/utils/phone.util';
import type { ContactPointResponse } from './clients.model';
import { toApiPhoneUsDefault } from '../utils/customer-form-normalizers';

/**
 * Réplica MÍNIMA del contrato de envío de SMS (TaxVision.Sms.Api, `POST /sms/messages`) para el
 * envío directo desde el perfil del cliente. No se importa `features/sms` (regla: una feature no
 * importa otra); si el contrato cambia allá, cambia acá.
 */

/** Tope del VO SmsBody del backend (sms.invalidBody por encima). */
export const CLIENT_SMS_MAX_LENGTH = 4096;

/** Estados del resultado por item (SmsMessageStatus, serializado como string). */
export type ClientSmsStatus = 'Pending' | 'Accepted' | 'Delivered' | 'Failed' | 'Undeliverable' | 'Suppressed';

export interface ClientSmsSendRequest {
  messages: {
    customerId: string;
    /** E.164. */
    to: string;
    message: string;
    recipientName: string | null;
    media: null;
    /** UUID por click: sin él el backend deduplica por (cliente, destino, cuerpo). */
    idempotencyKey: string;
    sourceContext: string;
  }[];
}

export interface ClientSmsItemResult {
  messageId: string | null;
  customerId: string;
  to: string;
  status: ClientSmsStatus;
  providerMessageId: string | null;
  errorCode: string | null;
}

export interface ClientSmsSendResponse {
  batchId: string;
  correlationId: string;
  results: ClientSmsItemResult[];
}

/** Un teléfono del cliente ofrecido como destino. */
export interface ClientSmsPhoneOption {
  /** E.164 — lo que viaja como `to`. */
  value: string;
  /** "+1 (809) 555-1234 · Primary". */
  label: string;
}

/**
 * Teléfonos válidos del cliente para el selector del SMS: el principal primero y luego los puntos
 * de contacto de tipo Phone (el primario de la lista antes). Se normalizan a E.164 con la misma
 * conveniencia US del formulario, se descartan los que el backend rechazaría y se deduplican.
 */
export function clientSmsPhoneOptions(
  primaryPhone: string | null | undefined,
  contactPoints: readonly ContactPointResponse[],
): ClientSmsPhoneOption[] {
  const candidates: { raw: string; tag: string }[] = [];
  if (primaryPhone) {
    candidates.push({ raw: primaryPhone, tag: 'Primary' });
  }
  const phones = contactPoints
    .filter(cp => cp.type === 'Phone')
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  for (const cp of phones) {
    candidates.push({ raw: cp.value, tag: cp.label?.trim() || (cp.isPrimary ? 'Primary contact' : 'Phone') });
  }

  const seen = new Set<string>();
  const options: ClientSmsPhoneOption[] = [];
  for (const { raw, tag } of candidates) {
    const e164 = toApiPhoneUsDefault(raw);
    if (!e164 || !isValidPhone(e164) || seen.has(e164)) {
      continue;
    }
    seen.add(e164);
    options.push({ value: e164, label: `${formatPhoneForDisplay(e164)} · ${tag}` });
  }
  return options;
}

/** Resultado del envío ya traducido para el usuario. */
export type ClientSmsOutcome = { ok: true; message: string } | { ok: false; message: string };

/** Códigos canónicos del backend → texto claro (en inglés, sin jerga). */
function failureText(code: string | null): string {
  switch (code) {
    case 'sms.invalidDestination':
      return "That phone number can't receive text messages. Check the number and try again.";
    case 'sms.invalidBody':
      return 'The message is empty or too long.';
    case 'sms.invalidCustomer':
      return "This client can't receive messages right now.";
    case 'sms.noProvider':
      return "SMS isn't set up for your office yet. Ask an administrator to configure it.";
    case 'providerRejected':
    case 'sms.providerRejected':
      return 'The carrier rejected the message. Check the number and try again.';
    default:
      return "The message couldn't be delivered. Please try again.";
  }
}

/** Traduce el resultado del único item enviado (200 con estado por item). */
export function clientSmsOutcome(response: ClientSmsSendResponse | null | undefined): ClientSmsOutcome {
  const result = response?.results?.[0];
  if (!result) {
    return { ok: false, message: "The message couldn't be sent. Please try again." };
  }
  switch (result.status) {
    case 'Suppressed':
      return {
        ok: false,
        message: 'This client opted out of text messages (replied STOP), so the message was not sent.',
      };
    case 'Failed':
    case 'Undeliverable':
      return { ok: false, message: failureText(result.errorCode) };
    default:
      return { ok: true, message: 'Text message sent' };
  }
}

/** Errores HTTP del envío (permiso, límite de envío, saldo, red…) → texto claro. */
export function clientSmsErrorMessage(err: unknown): string {
  const status = err instanceof HttpErrorResponse ? err.status : -1;
  if (status === 403) {
    return "You don't have permission to send text messages.";
  }
  if (status === 429) {
    return 'Too many messages in a short time. Wait a moment and try again.';
  }
  const apiError = toApiError(err);
  // Cobro F6: cada SMS se cobra al monedero del tenant. 402 = saldo insuficiente, 503 = PEP no disponible.
  if (apiError.code === 'sms.insufficientFunds') {
    return 'Not enough wallet balance to send this message. Top up your wallet and try again.';
  }
  if (apiError.code === 'sms.walletUnavailable') {
    return "Couldn't authorize the charge right now. Please try again in a few seconds.";
  }
  if (apiError.code.startsWith('sms.') || apiError.code === 'providerRejected') {
    return failureText(apiError.code);
  }
  return apiError.message;
}
