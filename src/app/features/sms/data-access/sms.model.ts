/**
 * Espejos del contrato HTTP del servicio SMS (TaxVision.Sms.Api, ruta `/sms` vía Gateway)
 * + view-model de la bandeja. El servicio expone UN solo endpoint consumible desde el
 * front: POST /sms/messages (envío en lote de 1..N mensajes). NO hay endpoints de
 * lectura (historial, hilos, inbound, opt-outs): los webhooks del proveedor son
 * server-to-server y los estados de entrega viajan por eventos internos, no por HTTP.
 * Por eso el "hilo" del front solo puede mostrar lo enviado en la sesión actual.
 */

// ---------- Enums del backend (TaxVision.Sms.Domain) ----------

/**
 * Espejo de SmsMessageStatus (serializa como STRING vía JsonStringEnumConverter).
 * `Suppressed` significa que el destinatario hizo STOP (opt-out): el backend lo
 * persiste auditablemente pero NO envía.
 */
export type SmsApiStatus = 'Pending' | 'Accepted' | 'Delivered' | 'Failed' | 'Undeliverable' | 'Suppressed';

/** Tope del VO SmsBody del backend: cuerpos más largos se rechazan con sms.invalidBody. */
export const SMS_BODY_MAX_LENGTH = 4096;

// ---------- Requests (MessagesController.SendMessagesRequest) ----------

export interface SmsMediaItemRequest {
  url: string;
  contentType: string;
  fileName: string | null;
  sizeBytes: number | null;
}

export interface SmsMessageItemRequest {
  /** Obligatorio: el backend rechaza Guid.Empty (sms.invalidCustomer). */
  customerId: string;
  /** Destino E.164 (`+` y 7..15 dígitos); el backend normaliza espacios/guiones/paréntesis. */
  to: string;
  message: string;
  media: SmsMediaItemRequest[] | null;
  /**
   * OJO: si va null el backend DERIVA la clave de (tenant, customer, to, body, media),
   * así que reenviar el mismo texto al mismo cliente NO se reenvía (devuelve el mensaje
   * existente). Mandamos un UUID por click para que un reenvío intencional sí salga.
   */
  idempotencyKey: string | null;
  /** Contexto libre del caller (viaja a los eventos de auditoría). */
  sourceContext: string | null;
}

export interface SendSmsMessagesRequest {
  messages: SmsMessageItemRequest[];
}

// ---------- Respuestas (SendSmsBatchResponse) ----------

/**
 * Un resultado POR ITEM: un item inválido no aborta el lote. `status` llega como string
 * del enum; cuando la validación de entrada falla, messageId es null y errorCode trae
 * el código canónico (sms.invalidDestination, providerRejected, mediaTooLarge…).
 */
export interface SmsSendItemResult {
  messageId: string | null;
  customerId: string;
  to: string;
  status: SmsApiStatus;
  providerMessageId: string | null;
  errorCode: string | null;
}

export interface SendSmsBatchResponse {
  batchId: string;
  correlationId: string;
  results: SmsSendItemResult[];
}

// ---------- Réplicas mínimas de otros servicios (sin imports cross-feature) ----------

/** Espejo de BuildingBlocks.Common.PagedResult<T> (campo `size`, no `pageSize`). */
export interface PagedResult<T> {
  items: T[];
  page: number;
  size: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

/**
 * Subset de GET /customers (CustomerSummaryResponse) para el rail de contactos —
 * réplica local al estilo TaskClientSummary, no import de features/clients.
 * `primaryPhone` es nullable: un cliente sin teléfono no es texteable.
 */
export interface SmsCustomerSummary {
  id: string;
  status: 'Active' | 'Inactive' | 'Archived';
  displayName: string;
  primaryEmail: string;
  primaryPhone: string | null;
  createdAtUtc: string;
}

// ---------- View-model de la bandeja ----------

/** Estados que pintan los chips de las burbujas salientes. */
export type SmsUiStatus = 'sent' | 'delivered' | 'failed' | 'pending' | 'suppressed';

/**
 * Burbuja del hilo. Solo hay `outbound` con backend real (no existe endpoint de
 * lectura de inbound); se conserva `inbound` en el tipo por si el backend suma
 * un feed de entrantes más adelante.
 */
export interface SmsThreadMessage {
  id: string;
  direction: 'outbound' | 'inbound';
  text: string;
  time: string;
  status: SmsUiStatus;
  /** Código canónico del backend cuando el item falló (para el tooltip de la burbuja). */
  errorCode: string | null;
}

/** Contacto del rail = un cliente del despacho (GET /customers). */
export interface SmsContact {
  id: string;
  name: string;
  /** Teléfono tal cual está en la ficha ('' si no tiene). */
  phoneRaw: string;
  /** Normalizado a E.164 si es válido; null ⇒ no se puede textear (composer bloqueado). */
  phoneE164: string | null;
  avatarColor: string;
}

/** Fila del rail: contacto + vista previa del último mensaje de la sesión. */
export interface SmsContactListItem extends SmsContact {
  preview: string;
  lastTime: string;
}

// ---------- Mapeos / helpers ----------

/**
 * Misma normalización que el VO PhoneE164 del backend: quita espacios, guiones,
 * puntos y paréntesis; luego exige `+` + 7..15 dígitos sin cero inicial de país.
 * Devuelve null si el número guardado no puede viajar tal cual — preferimos
 * bloquear el composer a mandar un item que sabemos que fallará.
 */
export function toE164OrNull(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) {
    return null;
  }
  const normalized = raw.trim().replace(/[\s\-.()]/g, '');
  return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : null;
}

/**
 * SmsApiStatus → chip de la burbuja. `Accepted` = el proveedor aceptó el mensaje
 * (chip "Sent"); "Delivered" solo llegaría si el DLR del proveedor ya se procesó,
 * cosa que en la respuesta síncrona del envío casi nunca pasa. Sin endpoint de
 * consulta, el chip NO se auto-actualiza después (rareza real del contrato).
 */
export function apiStatusToUi(status: SmsApiStatus): SmsUiStatus {
  switch (status) {
    case 'Accepted':
      return 'sent';
    case 'Delivered':
      return 'delivered';
    case 'Pending':
      return 'pending';
    case 'Suppressed':
      return 'suppressed';
    case 'Failed':
    case 'Undeliverable':
      return 'failed';
  }
}

const AVATAR_COLORS = [
  'bg-brand-bold',
  'bg-sky-700',
  'bg-brand-ink',
  'bg-slate-500',
  'bg-indigo-400',
  'bg-cyan-800',
  'bg-slate-700',
  'bg-indigo-600',
];

/** Color estable por cliente: hash simple del id sobre la paleta de avatares. */
export function avatarColorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Hora local corta para las burbujas ("9:05 AM"). */
export function timeLabel(date: Date = new Date()): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** CustomerSummaryResponse → contacto del rail. */
export function toSmsContact(customer: SmsCustomerSummary): SmsContact {
  return {
    id: customer.id,
    name: customer.displayName,
    phoneRaw: customer.primaryPhone ?? '',
    phoneE164: toE164OrNull(customer.primaryPhone),
    avatarColor: avatarColorFor(customer.id),
  };
}
