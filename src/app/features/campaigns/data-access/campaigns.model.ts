/**
 * Espejos del contrato HTTP de campañas de correo (EmailCampaignsController del servicio
 * Notification, ruta `/notifications/email/campaigns` vía Gateway) + view-model de la página.
 * Los enums viajan como STRING: `CampaignType` y `CampaignStatus` se comparan por nombre.
 *
 * Flujo real del backend: POST crea un Draft con destinatarios explícitos → POST {id}/schedule
 * captura la plantilla publicada y lo deja Scheduled (el scheduler hace el fan-out) → los
 * contadores sent/failed/opened/clicked se actualizan en background. No existe PUT (editar),
 * DELETE (borrar) ni pause/resume: la única transición manual es cancel.
 */

// ---------- Enums del backend (TaxVision.Notification.Domain.Emailing.Campaigns) ----------

/** Espejo de CampaignType. */
export type ApiCampaignType = 'Newsletter' | 'Notification' | 'Marketing' | 'Custom';

/** Espejo de CampaignStatus. Paused/Failed los pone el backend; no hay endpoint para pausar. */
export type ApiCampaignStatus =
  | 'Draft'
  | 'Scheduled'
  | 'Running'
  | 'Paused'
  | 'Completed'
  | 'Cancelled'
  | 'Failed';

export const CAMPAIGN_TYPES: ApiCampaignType[] = ['Newsletter', 'Notification', 'Marketing', 'Custom'];

// ---------- Respuestas ----------

/** Espejo de EmailCampaignResponse (camelCase). Ojo: NO incluye la lista de destinatarios. */
export interface EmailCampaignResponse {
  id: string;
  tenantId: string;
  name: string;
  type: ApiCampaignType;
  status: ApiCampaignStatus;
  templateId: string;
  templateVersionId: string | null;
  scheduledAtUtc: string | null;
  startedAtUtc: string | null;
  finishedAtUtc: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  openedCount: number;
  clickedCount: number;
  createdAtUtc: string;
}

/** Espejo de OutboundEmailResponse (subset que nos interesa del 202 de send-test). */
export interface OutboundEmailResponse {
  id: string;
  status: string;
}

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

// ---------- Requests (EmailCampaignsController) ----------

export interface CampaignRecipientInput {
  address: string;
  name?: string | null;
  variables?: Record<string, string | null> | null;
}

export interface CreateCampaignRequest {
  name: string;
  type: ApiCampaignType;
  templateId: string;
  recipients: CampaignRecipientInput[];
}

/** `scheduledAtUtc` null/omitido = programar para ahora (el backend usa UtcNow). */
export interface ScheduleCampaignRequest {
  scheduledAtUtc: string | null;
}

export interface SendTestRequest {
  toEmail: string;
  variables?: Record<string, string | null> | null;
}

// ---------- Réplicas mínimas de otros servicios (sin imports cross-feature) ----------

/**
 * Fila de GET /notifications/email/templates (EmailTemplateResponse). Programar una campaña
 * exige plantilla Active con versión publicada (currentVersionId != null): el picker solo
 * ofrece esas.
 */
export interface CampaignTemplateSummary {
  id: string;
  scope: string;
  templateKey: string;
  subject: string;
  description: string | null;
  category: string | null;
  status: string;
  currentVersionId: string | null;
}

/** Subset mínimo de GET /customers para armar destinatarios (réplica, patrón task/documents). */
export interface CampaignClientSummary {
  id: string;
  displayName: string;
  primaryEmail: string;
  status: 'Active' | 'Inactive' | 'Archived';
}

// ---------- View-model de la página ----------

/**
 * Estado visual de la tabla. Mapea 1:1 desde ApiCampaignStatus conservando el vocabulario
 * de chips original: Running → active y Completed → sent; se agregan cancelled y failed.
 */
export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'sent' | 'paused' | 'cancelled' | 'failed';

/** Fila/tarjeta de campaña: campos de presentación + los crudos que necesitan las acciones. */
export interface CampaignItem {
  id: string;
  name: string;
  type: ApiCampaignType;
  templateId: string;
  /** Nombre de la plantilla resuelto vía GET /notifications/email/templates ('' si no se pudo). */
  templateName: string;
  /** Subject de la plantilla (para el preview); '' si no se pudo resolver. */
  templateSubject: string;
  status: CampaignStatus;
  /** Estado real del backend — fuente de verdad para decidir acciones. */
  apiStatus: ApiCampaignStatus;
  /** YYYY-MM-DD (fecha UTC de programación) o null si sigue en borrador. */
  scheduledDate: string | null;
  scheduledAtUtc: string | null;
  startedAtUtc: string | null;
  finishedAtUtc: string | null;
  createdAtUtc: string;
  recipients: number;
  delivered: number;
  failed: number;
  opened: number;
  clicked: number;
}

/** Lo que emite el panel de creación; el store lo traduce a requests reales. */
export interface CampaignFormValue {
  name: string;
  type: ApiCampaignType;
  templateId: string;
  /** Fuente de destinatarios: clientes activos del tenant o lista manual de correos. */
  audience: 'active-clients' | 'custom';
  /** Correos crudos del textarea (solo audience === 'custom'). */
  customEmails: string;
  /** YYYY-MM-DD; '' = dejar la campaña en Draft (sin programar). */
  scheduledDate: string;
}

// ---------- Mapeos ----------

export function statusToUi(status: ApiCampaignStatus): CampaignStatus {
  switch (status) {
    case 'Draft':
      return 'draft';
    case 'Scheduled':
      return 'scheduled';
    case 'Running':
      return 'active';
    case 'Paused':
      return 'paused';
    case 'Completed':
      return 'sent';
    case 'Cancelled':
      return 'cancelled';
    case 'Failed':
      return 'failed';
  }
}

/** Tasa de apertura como % sobre los entregados (sentCount); 0 si todavía no se envió nada. */
export function openRate(campaign: CampaignItem): number {
  return campaign.delivered > 0 ? (campaign.opened / campaign.delivered) * 100 : 0;
}

/**
 * EmailCampaignResponse → fila. El nombre/subject de plantilla se resuelve contra el mapa
 * id→plantilla que arma el store (best-effort: sin permiso template.view queda vacío).
 */
export function toCampaignItem(
  response: EmailCampaignResponse,
  templateById: ReadonlyMap<string, CampaignTemplateSummary>,
): CampaignItem {
  const template = templateById.get(response.templateId);
  return {
    id: response.id,
    name: response.name,
    type: response.type,
    templateId: response.templateId,
    templateName: template?.templateKey ?? '',
    templateSubject: template?.subject ?? '',
    status: statusToUi(response.status),
    apiStatus: response.status,
    scheduledDate: response.scheduledAtUtc ? response.scheduledAtUtc.slice(0, 10) : null,
    scheduledAtUtc: response.scheduledAtUtc,
    startedAtUtc: response.startedAtUtc,
    finishedAtUtc: response.finishedAtUtc,
    createdAtUtc: response.createdAtUtc,
    recipients: response.totalRecipients,
    delivered: response.sentCount,
    failed: response.failedCount,
    opened: response.openedCount,
    clicked: response.clickedCount,
  };
}

/**
 * Parsea el textarea de correos manuales: separa por comas, punto y coma, espacios o saltos
 * de línea, exige un '@' (misma validación mínima que el dominio) y deduplica.
 */
export function parseCustomEmails(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of raw.split(/[\s,;]+/)) {
    const email = token.trim();
    const key = email.toLowerCase();
    if (email.includes('@') && !seen.has(key)) {
      seen.add(key);
      result.push(email);
    }
  }
  return result;
}
