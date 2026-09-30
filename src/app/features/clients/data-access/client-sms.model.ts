import type { ClientProfile } from '../models/client-profile.model';
import { formatPhoneForDisplay, toApiPhoneWithUsDefault } from '../utils/customer-form-normalizers';

/**
 * Réplica MÍNIMA del contrato de envío de Sms.Api (`POST /sms/messages`, MessagesController) para
 * el "Send SMS" del perfil. No se importa `features/sms` (regla: features no se importan entre sí);
 * solo se copia lo que este envío directo necesita.
 */

/** Tope del VO SmsBody del backend. */
export const CLIENT_SMS_MAX_LENGTH = 4096;

/** Contexto libre que viaja a auditoría: distingue el envío desde el perfil del de la página SMS. */
export const CLIENT_SMS_SOURCE_CONTEXT = 'crm-client-profile';

export type ClientSmsApiStatus = 'Pending' | 'Accepted' | 'Delivered' | 'Failed' | 'Undeliverable' | 'Suppressed';

export interface ClientSmsSendRequest {
  messages: {
    customerId: string;
    to: string;
    message: string;
    recipientName: string | null;
    media: null;
    /** UUID por click: con null el backend deduplica por (cliente, destino, texto) y no reenvía. */
    idempotencyKey: string;
    sourceContext: string;
  }[];
}

export interface ClientSmsSendResponse {
  batchId: string;
  correlationId: string;
  results: {
    messageId: string | null;
    customerId: string;
    to: string;
    status: ClientSmsApiStatus;
    providerMessageId: string | null;
    errorCode: string | null;
  }[];
}

/** Un número al que se le puede escribir, con su etiqueta para el selector del modal. */
export interface SmsPhoneOption {
  /** E.164. */
  value: string;
  label: string;
}

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Números SMS-ables del cliente, sin duplicados: primero el teléfono principal, luego los puntos
 * de contacto `Phone` — los etiquetados como móvil/celular primero. El backend no distingue móvil de
 * fijo (ContactPointType = Email|Phone), así que la etiqueta es la única pista.
 */
export function smsPhoneOptions(client: Pick<ClientProfile, 'phone' | 'contactPoints'>): SmsPhoneOption[] {
  const options: SmsPhoneOption[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined, label: string) => {
    const e164 = toApiPhoneWithUsDefault(raw);
    if (!E164.test(e164) || seen.has(e164)) {
      return;
    }
    seen.add(e164);
    options.push({ value: e164, label: `${formatPhoneForDisplay(e164)} · ${label}` });
  };

  push(client.phone, 'Primary');
  const phones = (client.contactPoints ?? []).filter(cp => cp.type === 'Phone');
  const isMobile = (label: string | null | undefined) => /mobile|cell|móvil|movil|celular/i.test(label ?? '');
  [...phones.filter(cp => isMobile(cp.label)), ...phones.filter(cp => !isMobile(cp.label))].forEach(cp =>
    push(cp.value, cp.label?.trim() || 'Phone'),
  );
  return options;
}

/** Resultado del envío en lenguaje simple, a partir del resultado POR ITEM del lote. */
export interface ClientSmsOutcome {
  ok: boolean;
  message: string;
}

export function smsOutcome(response: ClientSmsSendResponse): ClientSmsOutcome {
  const result = response.results[0];
  if (!result) {
    return { ok: false, message: "The message couldn't be sent. Please try again." };
  }
  switch (result.status) {
    case 'Accepted':
    case 'Delivered':
    case 'Pending':
      return { ok: true, message: 'Text message sent' };
    case 'Suppressed':
      return { ok: false, message: 'This client has opted out of text messages, so the message was not sent.' };
    default:
      return { ok: false, message: smsErrorMessage(result.errorCode) };
  }
}

/** Códigos canónicos de Sms.Api → mensaje amable (sin jerga). */
export function smsErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case 'sms.invalidDestination':
      return "This phone number can't receive text messages. Check the number and try again.";
    case 'sms.invalidBody':
      return 'The message is empty or too long.';
    case 'sms.customerNotAssigned':
      return "You're not assigned to this client, so you can't text them.";
    case 'sms.noProvider':
      return "Text messaging isn't set up for your office yet.";
    case 'sms.invalidCustomer':
      return "This client can't receive text messages right now.";
    default:
      return "The message couldn't be sent. Please try again.";
  }
}
