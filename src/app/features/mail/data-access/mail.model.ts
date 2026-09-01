/**
 * DTOs del módulo Mail contra el backend real:
 *
 * - Connectors.Api (`/connectors` vía Gateway): cuentas de buzón externo del tenant
 *   (OAuth Gmail/Microsoft Graph o IMAP manual). Sin cuenta conectada no hay correo.
 * - Correspondence.Api (`/correspondence` vía Gateway): el inbox real. Es
 *   CUSTOMER-CÉNTRICO — los hilos (`EmailThread`) cuelgan de un customer, no hay un
 *   listado global de "bandeja de entrada" del tenant. Por eso la UI pide elegir
 *   cliente antes de listar conversaciones.
 *
 * Enums del backend serializan como STRING; fechas como ISO UTC; ids como GUID string.
 */

import { parseUtcDate } from '../../../shared/utils/utc-date.util';

// ---------- Compartido ----------

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

/** Subset mínimo de GET /customers para el picker de cliente (réplica, no import de features/clients). */
export interface MailCustomerSummary {
  id: string;
  displayName: string;
  primaryEmail: string;
  status: 'Active' | 'Inactive' | 'Archived';
}

// ---------- Connectors (`/connectors`) ----------

/** Espejo de TaxVision.Connectors.Domain.Shared.ProviderCode. `Imap` solo llega vía /accounts/manual. */
export type MailProviderCode = 'Gmail' | 'Graph' | 'Imap';

/** Espejo de TenantEmailAccountStatus. `Active` = watch/subscription corriendo; `Error` admite reauth. */
export type MailAccountStatus = 'Draft' | 'Connected' | 'Active' | 'Disconnected' | 'Error';

/** GET /connectors/accounts — nunca incluye nada del token. */
export interface MailAccount {
  id: string;
  emailAddress: string;
  providerCode: MailProviderCode;
  displayName: string | null;
  status: MailAccountStatus;
  connectedAtUtc: string | null;
  createdAtUtc: string;
}

/** POST /connectors/accounts — el frontend REDIRIGE el navegador a authorizationUrl (no es fetch). */
export interface InitiateOAuthConnectResult {
  authorizationUrl: string;
}

/**
 * POST /connectors/accounts/manual — alta de buzón por IMAP+SMTP (sin OAuth). Espejo de
 * ConnectManualAccountRequest. El backend valida conectividad real contra ambos servidores antes
 * de persistir, y exige que `emailAddress` sea el email de login del usuario (guard de identidad).
 */
export interface ConnectManualAccountRequest {
  emailAddress: string;
  displayName: string | null;
  imapHost: string;
  imapPort: number;
  imapUseSsl: boolean;
  imapUsername: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: number;
  smtpUseStartTls: boolean;
  smtpUsername: string;
  smtpPassword: string;
}

/** POST /connectors/accounts/manual — a diferencia de OAuth NO redirige: la cuenta queda creada al 200. */
export interface ConnectManualAccountResult {
  accountId: string;
  emailAddress: string;
}

/** Cuenta utilizable para leer/enviar (Draft/Disconnected no sirven; Error se reautoriza). */
export function isUsableAccount(account: MailAccount): boolean {
  return account.status === 'Connected' || account.status === 'Active';
}

// ---------- Correspondence: hilos y mensajes ----------

/** Espejo de EmailThreadStatus. */
export type ThreadStatus = 'Active' | 'Archived';

/** Fila de GET /correspondence/customers/{customerId}/threads. */
export interface ThreadSummary {
  threadId: string;
  subject: string;
  status: ThreadStatus;
  messageCount: number;
  firstMessageAtUtc: string;
  lastMessageAtUtc: string;
}

/** Espejo de MessageDirection: Inbound = recibido por el tenant, Outbound = draft ya enviado. */
export type MessageDirection = 'Inbound' | 'Outbound';

/** "¿Se abrió alguna vez?" — NO es cache: el body siempre se pide en vivo. Solo inbound. */
export type MessageBodyStatus = 'BodyPending' | 'BodyReady';

/**
 * Fila de GET /correspondence/threads/{threadId}/messages (inbound+outbound mezclados,
 * cronológico ascendente) y de GET /correspondence/messages/{id} (siempre inbound).
 * Campos nulos según dirección: from/fromDisplayName/snippet/bodyStatus solo inbound;
 * toAddresses solo outbound. En outbound `messageId` es el id del Draft enviado.
 */
export interface MessageSummary {
  messageId: string;
  direction: MessageDirection;
  from: string | null;
  fromDisplayName: string | null;
  subject: string;
  snippet: string | null;
  toAddresses: string[] | null;
  occurredAtUtc: string;
  hasAttachments: boolean;
  attachmentCount: number;
  bodyStatus: MessageBodyStatus | null;
}

/** GET /correspondence/messages/{id}/body — pedido en vivo a Connectors, nunca persistido. */
export interface MessageBody {
  htmlBody: string | null;
  textBody: string | null;
  headers: Record<string, string>;
}

/** Espejo de AttachmentDownloadStatus (descarga bajo demanda hacia CloudStorage). */
export type AttachmentDownloadStatus = 'NotRequested' | 'InProgress' | 'Downloaded' | 'Failed';

/** Fila de GET /correspondence/messages/{id}/attachments — metadata, cero bytes. */
export interface AttachmentSummary {
  attachmentId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  isInline: boolean;
  downloadStatus: AttachmentDownloadStatus;
  cloudStorageFileId: string | null;
}

/** POST /correspondence/messages/{id}/attachments/{attachmentId}/download — idempotente. */
export interface DownloadAttachmentResult {
  attachmentId: string;
  downloadStatus: AttachmentDownloadStatus;
  cloudStorageFileId: string;
}

/** GET .../attachments/{attachmentId}/download-url — 409 mientras la descarga no terminó. */
export interface AttachmentDownloadUrlResult {
  attachmentId: string;
  downloadUrl: string;
  expiresAtUtc: string;
}

// ---------- Correspondence: compose (drafts) ----------

/** Espejo de DraftStatus. `Sending` dura lo que la llamada síncrona a Postmaster. */
export type DraftStatus = 'Draft' | 'Sending' | 'Sent' | 'Failed' | 'Discarded';

/** Fila lean de GET /correspondence/drafts?customerId= ("retomar un autoguardado"). */
export interface DraftListItem {
  draftId: string;
  subject: string;
  status: DraftStatus;
  isReply: boolean;
  updatedAtUtc: string;
  lastAutoSavedAtUtc: string | null;
}

/** Destinatario dentro de DraftDetail — `type` serializa como string To/Cc/Bcc. */
export interface DraftRecipientSummary {
  address: string;
  type: 'To' | 'Cc' | 'Bcc';
  displayName: string | null;
}

/** Adjunto ya referenciado en el draft (el binario vive en CloudStorage). */
export interface DraftAttachmentSummary {
  fileId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/** Contexto de threading congelado por StartReply (RFC 2822/5322). Solo informativo para la UI. */
export interface ReplyContext {
  incomingEmailId: string;
  emailThreadId: string;
  inReplyToInternetMessageId: string | null;
  replyToProviderMessageId: string | null;
  references: string[];
}

/** GET /correspondence/drafts/{id} — vista completa para el composer. */
export interface DraftDetail {
  draftId: string;
  customerId: string;
  accountId: string;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  status: DraftStatus;
  recipients: DraftRecipientSummary[];
  attachments: DraftAttachmentSummary[];
  replyContext: ReplyContext | null;
  sentMessageId: string | null;
  failureReason: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  lastAutoSavedAtUtc: string | null;
}

/** POST /correspondence/messages/{id}/reply/draft — get-or-create del reply abierto. */
export interface StartReplyResult {
  draftId: string;
  subject: string;
  replyContext: ReplyContext;
}

/** Entrada de destinatario para el autosave (PATCH /drafts/{id}). */
export interface DraftRecipientInput {
  address: string;
  displayName: string | null;
}

/** PATCH /correspondence/drafts/{id} — parcial: campo ausente/null nunca pisa lo guardado. */
export interface AutoSaveDraftRequest {
  subject?: string | null;
  htmlBody?: string | null;
  textBody?: string | null;
  to?: DraftRecipientInput[] | null;
  cc?: DraftRecipientInput[] | null;
  bcc?: DraftRecipientInput[] | null;
}

/** POST /correspondence/drafts/{id}/attachments — el archivo ya subió a CloudStorage, viaja la referencia. */
export interface AttachFileToDraftRequest {
  fileId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/** Respuesta de POST /correspondence/drafts/{id}/send (síncrono contra Postmaster). */
export interface SendDraftResult {
  sentMessageId: string;
  providerMessageId: string;
}

// ---------- Helpers de presentación ----------

/** Paleta de avatares del diseño original — se asigna determinística por hash del texto. */
const AVATAR_COLORS = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];

export function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initialsFor(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(part => part.length > 0);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Hora tipo cliente de correo: hoy → "9:42 AM"; mismo año → "Jun 28"; si no → "Apr 18, 2024". */
export function formatMailTime(iso: string): string {
  const date = parseUtcDate(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * El textarea del composer es texto plano, pero SendDraft exige HtmlBody (además de Subject
 * y ≥1 To). Se serializa el texto escapado con <br> por salto de línea — sin inventar markup.
 */
export function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<p>${escaped.replace(/\r?\n/g, '<br>')}</p>`;
}

/** "a@b.com, C <c@d.com>" → entradas para el autosave. Ignora vacíos. */
export function parseRecipients(raw: string): DraftRecipientInput[] {
  return raw
    .split(/[,;]/)
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map(part => {
      const match = /^(.*)<([^<>]+)>$/.exec(part);
      if (match) {
        const displayName = match[1].trim().replace(/^"|"$/g, '');
        return { address: match[2].trim(), displayName: displayName || null };
      }
      return { address: part, displayName: null };
    });
}
