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

import { parseUtcDate } from '@shared/utils/utc-date.util';

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
  /**
   * Buzón de OFICINA (compartido) vs PERSONAL. `isOffice` lo calcula el backend a partir de
   * `ownerUserId` (null = oficina, con valor = personal de ese usuario). El list del backend ya
   * scopea a oficina + propios, así que un buzón no-oficina de esta lista es siempre el del usuario.
   */
  isOffice: boolean;
  ownerUserId: string | null;
  /** Permisos que el servicio pide hoy y la conexión OAuth no aceptó: no vacío = "Update permissions". */
  missingScopes: string[];
  /** Buzón de oficina ligado a alguien que dejó la oficina (lo marca el retiro; se quita al reconectar). */
  needsReview?: boolean;
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
/** Una prueba del alta manual (IMAP o SMTP): bien, o el código y el mensaje del fallo. */
export interface ManualConnectionCheck {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
}

/** POST /connectors/accounts/manual/test: las dos pruebas, siempre ambas (sin guardar nada). */
export interface TestManualConnectionResult {
  imap: ManualConnectionCheck;
  smtp: ManualConnectionCheck;
}

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
  /**
   * true = buzón de OFICINA (compartido): el backend salta el guard de identidad, así que
   * `emailAddress` puede ser distinto del email de login. false = personal: el guard exige que sea
   * el propio email de login. Default backend = false (personal).
   */
  asOffice: boolean;
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

/** Fila de GET /correspondence/threads (inbox de la oficina, también filtrado a un cliente). */
export interface ThreadSummary {
  threadId: string;
  subject: string;
  status: ThreadStatus;
  messageCount: number;
  firstMessageAtUtc: string;
  lastMessageAtUtc: string;
  /** Correos inbound no leídos del hilo (estado compartido por el tenant). 0 = todo leído. */
  unreadCount: number;
  /** Cliente del hilo; null = "Not a client" (hilo nacido de un aviso de no entrega). */
  customerId?: string | null;
  /** Último remitente entrante y su vista previa; null si el hilo solo tiene enviados. */
  lastSenderAddress?: string | null;
  lastSenderName?: string | null;
  snippet?: string | null;
  hasAttachments?: boolean;
  /** Aviso de entrega más reciente del hilo; null si no hay. */
  latestDeliveryNotice?: DeliveryNoticeSummary | null;
}

// ---------- Avisos y estado de entrega ----------

/** Resultado de un aviso: Delayed (sigue intentando) o NotDelivered. */
export type DeliveryNoticeOutcome = 'Delayed' | 'NotDelivered';

/** Estado de entrega de un enviado / destinatario. null en la API = enviado, sin noticias. */
export type DeliveryStatus = 'Delivered' | 'Delayed' | 'NotDelivered';

/** Motivo estable del aviso (Postmaster): decide el texto y las acciones de la tarjeta. */
export type DeliveryReasonCode =
  | 'invalid_address'
  | 'domain_not_found'
  | 'mailbox_full'
  | 'rejected'
  | 'too_large'
  | 'delayed'
  | 'other';

/** Tarjeta de aviso de entrega (en la conversación y en la fila del Inbox). */
export interface DeliveryNoticeSummary {
  deliveryNoticeId: string;
  /** Borrador (enviado) original que no se entregó. */
  draftId: string;
  recipient: string;
  outcome: DeliveryNoticeOutcome;
  category: string | null;
  reasonCode: DeliveryReasonCode | string;
  statusCode: string | null;
  /** Respuesta técnica del servidor: oculta por defecto. */
  diagnostic: string | null;
  /** La dirección quedó bloqueada para futuros envíos (rebote duro). */
  suppressed: boolean;
  /** Se puede pedir el aviso original (GET /delivery-notices/{id}/original). */
  canViewOriginal: boolean;
  isRead: boolean;
  occurredAtUtc: string;
  receivedAtUtc: string;
}

/** Estado de entrega de UN destinatario de un enviado. */
export interface RecipientDelivery {
  address: string;
  type: 'To' | 'Cc' | 'Bcc' | string;
  status: DeliveryStatus | null;
  category: string | null;
  updatedAtUtc: string | null;
}

/** GET /correspondence/delivery-notices/{id}/original — el aviso tal cual llegó (en vivo). */
export interface DeliveryNoticeOriginal {
  htmlBody: string | null;
  textBody: string | null;
  headers: Record<string, string>;
}

/** Tipo de fila del hilo: correo normal o tarjeta de aviso de entrega. */
export type ThreadMessageKind = 'Email' | 'DeliveryNotice';

/** Tono de la píldora de estado (filas y conversación). */
export type DeliveryTone = 'green' | 'red' | 'amber' | 'gray';

/** Copia en inglés por motivo: titular, motivo y qué hacer. */
export interface DeliveryNoticeCopy {
  title: string;
  reason: string;
  hint: string;
  /** Acción principal sugerida. */
  primary: 'fix' | 'resend' | 'view' | 'edit' | 'none';
  /** Etiqueta corta para la fila del Inbox. */
  chip: string;
  tone: DeliveryTone;
}

/** Texto claro por motivo del aviso (lo que ve el preparador, sin jerga técnica). */
export function deliveryNoticeCopy(notice: Pick<DeliveryNoticeSummary, 'reasonCode' | 'outcome' | 'recipient'>): DeliveryNoticeCopy {
  if (notice.outcome === 'Delayed' || notice.reasonCode === 'delayed') {
    return {
      title: 'Delayed — still trying',
      reason: 'Delivery is delayed. The server will keep trying.',
      hint: 'Nothing to do yet. If it fails, you will see it here.',
      primary: 'none',
      chip: 'Delayed',
      tone: 'gray',
    };
  }
  const domain = notice.recipient.includes('@') ? notice.recipient.slice(notice.recipient.indexOf('@')) : 'this domain';
  switch (notice.reasonCode) {
    case 'invalid_address':
      return {
        title: "Not delivered — the address doesn't exist",
        reason: "This email address doesn't exist.",
        hint: 'Check the address for typos, fix it and resend.',
        primary: 'fix',
        chip: 'Not delivered',
        tone: 'red',
      };
    case 'domain_not_found':
      return {
        title: "Not delivered — the domain doesn't exist",
        reason: `The domain ${domain} doesn't exist. Check for typos.`,
        hint: 'Fix the part after the @ and resend.',
        primary: 'fix',
        chip: 'Not delivered',
        tone: 'red',
      };
    case 'mailbox_full':
      return {
        title: 'Mailbox full — try again later',
        reason: "The recipient's mailbox is full.",
        hint: 'Wait a while and resend. The address is not blocked.',
        primary: 'resend',
        chip: 'Mailbox full',
        tone: 'amber',
      };
    case 'rejected':
      return {
        title: 'Not delivered — rejected by the recipient',
        reason: "The recipient's server rejected the email.",
        hint: 'Look at the original notice for the reason, or ask the recipient for another address.',
        primary: 'view',
        chip: 'Not delivered',
        tone: 'red',
      };
    case 'too_large':
      return {
        title: 'Not delivered — the email is too large',
        reason: 'The email is too large for the recipient.',
        hint: 'Remove or shrink the attachments and resend.',
        primary: 'edit',
        chip: 'Not delivered',
        tone: 'red',
      };
    default:
      return {
        title: "Not delivered",
        reason: "The email couldn't be delivered.",
        hint: 'Check the address and resend, or look at the original notice.',
        primary: 'fix',
        chip: 'Not delivered',
        tone: 'red',
      };
  }
}

/** Píldora de un enviado según su peor estado (null = sin noticias → "Sent"). */
export function deliveryStatusPill(status: DeliveryStatus | null | undefined): { label: string; tone: DeliveryTone } {
  switch (status) {
    case 'Delivered':
      return { label: 'Delivered', tone: 'green' };
    case 'NotDelivered':
      return { label: 'Not delivered', tone: 'red' };
    case 'Delayed':
      return { label: 'Delayed', tone: 'amber' };
    default:
      return { label: 'Sent', tone: 'gray' };
  }
}

/** Detalle por destinatario para el tooltip de la píldora ("ana@x.com: Delivered"). */
export function deliveryDetail(deliveries: readonly RecipientDelivery[] | null | undefined): string {
  return (deliveries ?? [])
    .map(item => `${item.address}: ${deliveryStatusPill(item.status).label}`)
    .join('\n');
}

/**
 * El aviso sigue siendo lo último del hilo (nada se envió ni llegó después): solo entonces la fila
 * lo muestra. Un rebote viejo seguido de una respuesta no debe marcar el hilo para siempre.
 */
export function isCurrentDeliveryNotice(thread: Pick<ThreadSummary, 'lastMessageAtUtc' | 'latestDeliveryNotice'>): boolean {
  const notice = thread.latestDeliveryNotice;
  if (!notice) {
    return false;
  }
  const noticeAt = Math.max(parseUtcDate(notice.occurredAtUtc).getTime() || 0, parseUtcDate(notice.receivedAtUtc).getTime() || 0);
  const last = parseUtcDate(thread.lastMessageAtUtc).getTime() || 0;
  // Margen de 1 s: el hilo sube con la hora del aviso y las fechas pueden venir truncadas.
  return noticeAt + 1000 >= last;
}

// ---------- Búsqueda unificada (`GET /correspondence/search`) ----------

export type MailSearchFolder = 'Inbox' | 'Archived' | 'Sent' | 'Drafts' | 'Trash';

/** Un correo que coincide. `messageId` null = solo coincidió el asunto de la conversación. */
export interface EmailSearchHit {
  source: 'Thread' | 'Incoming' | 'Outgoing';
  folder: MailSearchFolder;
  threadId: string | null;
  messageId: string | null;
  customerId: string | null;
  subject: string;
  matchedField: 'Subject' | 'From' | 'Snippet' | 'To' | string;
  occurredAtUtc: string;
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string[];
  snippet: string | null;
  hasAttachments: boolean;
  /** Conversación con algo sin leer / entrante sin leer; enviados y borradores = false. */
  isUnread?: boolean;
  /** Solo enviados/borradores: copia y copia oculta. */
  ccAddresses?: string[] | null;
  bccAddresses?: string[] | null;
}

/** Un adjunto cuyo nombre coincide. Entrante: se baja por mensaje+adjunto; saliente: `fileId` en CloudStorage. */
export interface FileSearchHit {
  source: 'Incoming' | 'Outgoing';
  attachmentId: string;
  messageId: string;
  threadId: string | null;
  customerId: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  occurredAtUtc: string;
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string[];
  fileId: string | null;
  downloadStatus: AttachmentDownloadStatus | string | null;
}

/** Grupos que puede calcular `GET /search` (`groups=`); sin el parámetro, el backend da los tres. */
export type MailSearchGroup = 'emails' | 'files' | 'people';

/**
 * Corresponsal que coincide (remitentes de entrantes y destinatarios de enviados visibles), uno por
 * dirección. `customerId` si la conversación está ligada a un cliente. Excluye los buzones de la oficina.
 */
export interface PersonSearchHit {
  address: string;
  displayName: string | null;
  customerId: string | null;
  messageCount: number;
  lastContactAtUtc: string | null;
  direction: 'From' | 'To' | 'Both' | string;
}

export interface MailSearchResult {
  emails: EmailSearchHit[];
  files: FileSearchHit[];
  /** Ausente en un backend sin el grupo `people` (o si no se pidió). */
  people?: PersonSearchHit[];
}

/** Respuesta de `/search` con los tres grupos siempre presentes (tolera un backend viejo o grupos no pedidos). */
export function normalizeMailSearchResult(
  raw: Partial<MailSearchResult> | null | undefined,
): Required<MailSearchResult> {
  return {
    emails: Array.isArray(raw?.emails) ? raw.emails : [],
    files: Array.isArray(raw?.files) ? raw.files : [],
    people: Array.isArray(raw?.people) ? raw.people : [],
  };
}

/** GET /correspondence/unread-count: hilos con algo sin leer y mensajes sin leer (badges). */
export interface UnreadMailCount {
  threads: number;
  messages: number;
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
  /** Estado leído/no-leído compartido por el tenant. En outbound siempre true (no hay nada que leer). */
  isRead: boolean;
  /** Veredicto de autenticación del remitente. Solo inbound; null en outbound. */
  senderTrust: SenderTrust | null;
  /** "DeliveryNotice" = tarjeta de aviso (messageId = id del aviso). Ausente = Email (backend anterior). */
  kind?: ThreadMessageKind;
  /** Solo outbound: peor estado de entrega; null = sin noticias. */
  deliveryStatus?: DeliveryStatus | null;
  /** Solo outbound: estado por destinatario. */
  deliveries?: RecipientDelivery[] | null;
  /** Solo kind = DeliveryNotice. */
  deliveryNotice?: DeliveryNoticeSummary | null;
  /** Solo outbound: copia y copia oculta (la oficina ve el Bcc de lo que envió). */
  ccAddresses?: string[] | null;
  bccAddresses?: string[] | null;
}

/** Veredicto de autenticación del remitente (el front lo traduce a lenguaje simple). */
export type SenderTrust = 'Verified' | 'Unverified' | 'Unknown';

/** GET /correspondence/messages/{id}/body — pedido en vivo a Connectors, nunca persistido. */
export interface MessageBody {
  htmlBody: string | null;
  textBody: string | null;
  headers: Record<string, string>;
}

/** Espejo de AttachmentDownloadStatus (descarga bajo demanda hacia CloudStorage). */
export type AttachmentDownloadStatus = 'NotRequested' | 'InProgress' | 'Downloaded' | 'Failed' | 'Blocked' | 'UnderReview';

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

/**
 * De qué correo saliente se habla en Drafts/Sent/Trash: el archivado en un cliente, o el que se
 * mandó a alguien que no es cliente (proveedor, IRS, colega) y no se archivó en ninguno. Es un tipo
 * explícito y no un `customerId | null`: un id que falta por error no debe leerse como "sin cliente"
 * y mostrar otro correo. El backend exige lo mismo (`customerId` o `unlinked=true`).
 */
export type MailCustomerScope =
  | { readonly kind: 'customer'; readonly customerId: string }
  | { readonly kind: 'unlinked' }
  // Todo el correo saliente: a clientes visibles y a quien no es cliente (cada fila dice cuál).
  | { readonly kind: 'all' };

/**
 * Fila de la carpeta "Sent" (GET /correspondence/sent?customerId=): un mensaje ya enviado.
 * `emailThreadId` null = envío nuevo (compose) sin hilo → el front lo abre como mensaje suelto;
 * no-null = reply → abre el hilo completo. El body se pide con GET /drafts/{id} al abrirlo.
 */
export interface SentMessageListItem {
  messageId: string;
  emailThreadId: string | null;
  subject: string;
  toAddresses: string[];
  isReply: boolean;
  sentAtUtc: string;
  hasAttachments: boolean;
  attachmentCount: number;
  /** Cliente en el que se archivó; null = enviado a alguien que no es cliente. */
  customerId?: string | null;
  /** Peor estado de entrega (NotDelivered > Delayed > Delivered); null = sin noticias. */
  deliveryStatus?: DeliveryStatus | null;
  deliveries?: RecipientDelivery[] | null;
  ccAddresses?: string[] | null;
  bccAddresses?: string[] | null;
}

/** Fila lean de GET /correspondence/drafts?customerId= ("retomar un autoguardado"). */
export interface DraftListItem {
  draftId: string;
  subject: string;
  status: DraftStatus;
  isReply: boolean;
  updatedAtUtc: string;
  lastAutoSavedAtUtc: string | null;
  /** Cliente del borrador; null = para alguien que no es cliente. */
  customerId?: string | null;
  /** El borrador tiene adjuntos (para el clip de la fila). */
  hasAttachments?: boolean;
}

/** Destinatario dentro de DraftDetail — `type` serializa como string To/Cc/Bcc. */
export interface DraftRecipientSummary {
  address: string;
  type: 'To' | 'Cc' | 'Bcc';
  displayName: string | null;
}

/** Fila de la papelera (GET /correspondence/trash) — entrante o enviado borrado. */
export interface TrashItem {
  messageId: string;
  kind: 'Incoming' | 'Sent';
  emailThreadId: string | null;
  subject: string;
  counterparty: string;
  deletedAtUtc: string;
  hasAttachments: boolean;
  attachmentCount: number;
  /** Cliente del correo; null = enviado a alguien que no es cliente. */
  customerId?: string | null;
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
  /** Cliente en cuya ficha queda el correo; null = correo a alguien que no es cliente. */
  customerId: string | null;
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

/**
 * Texto plano → HtmlBody. SendDraft exige HtmlBody (además de Subject y ≥1 To), así que la
 * respuesta rápida —que sí es un textarea— tiene que serializarse: se escapa y se pone un
 * <br> por salto de línea, sin inventar markup. El composer grande ya produce html propio.
 */
export function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<p>${escaped.replace(/\r?\n/g, '<br>')}</p>`;
}

/** Etiquetas que separan bloques: cada apertura y cada cierre corta línea. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'TR', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'PRE', 'TABLE',
]);

/**
 * Html → texto plano, para el `textBody` del draft: lo que leen los clientes de correo que
 * no pintan html, y lo que se indexa en muchas bandejas.
 *
 * Lo hace el PARSER del navegador, no una tanda de expresiones regulares. Con regex había
 * dos fallos de verdad, ambos visibles en el correo que recibe el destinatario:
 *
 *  1. Doble decodificación. Se resolvía `&amp;` y DESPUÉS `&lt;`, así que escribir
 *     literalmente `&lt;` llegaba como `<`. El parser decodifica una sola vez y ya.
 *  2. Líneas pegadas. Solo cortaban las etiquetas de CIERRE, y el contenteditable deja la
 *     primera línea suelta y mete las siguientes en `<div>`: `uno<div>dos</div>` salía como
 *     "unodos". Ahora corta también la apertura del bloque.
 *
 * `DOMParser` crea un documento INERTE: no ejecuta scripts ni descarga imágenes, cosa que
 * `innerHTML` sobre un div sí podría hacer.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  const source = (html ?? '').trim();
  if (!source) {
    return '';
  }
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const out: string[] = [];
  collectText(parsed.body, out);
  return (
    out
      .join('')
      // Los límites de bloque van marcados y no como '\n' directo: entre dos bloques
      // seguidos hay DOS (el cierre de uno y la apertura del otro) y son una sola línea.
      // Un <br> sí escribe '\n' de verdad, así que dos <br> siguen valiendo dos saltos.
      .replace(/\u0000+/g, '\n')
      // `&nbsp;` llega como espacio duro: en texto plano es un espacio normal.
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Marca de límite de bloque; se colapsa al final (ver `htmlToPlainText`). */
const BLOCK_BREAK = '\u0000';

function collectText(node: Node, out: string[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push(child.textContent ?? '');
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }
    const element = child as Element;
    const tag = element.tagName.toUpperCase();

    // El contenido de script/style NO es texto del mensaje: sin esto el CSS de un correo
    // pegado acababa dentro del cuerpo plano.
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD') {
      continue;
    }
    if (tag === 'BR') {
      out.push('\n');
      continue;
    }
    // Una imagen no tiene texto: se anuncia por su alt para no dejar un hueco mudo.
    if (tag === 'IMG') {
      const alt = element.getAttribute('alt')?.trim();
      out.push(alt ? `[${alt}]` : '[image]');
      continue;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) {
      out.push(BLOCK_BREAK);
    }
    if (tag === 'LI') {
      out.push('\u2022 ');
    }
    collectText(element, out);
    if (isBlock) {
      out.push(BLOCK_BREAK);
    }
  }
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
