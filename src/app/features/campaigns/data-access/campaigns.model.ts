/**
 * Espejos del contrato HTTP del NUEVO servicio orquestador `TaxVision.Campaigns` (vía Gateway,
 * prefijos `/campaigns`, `/contacts`, `/contact-lists`, `/sender-profiles`). Reemplaza al viejo
 * módulo email-only de Notification (`/notifications/email/campaigns`, superseded).
 *
 * Principio del backend: Campaign es un ORQUESTADOR agnóstico de canal, SIN dinero. Define la
 * campaña + audiencia, hace fan-out por unidad (destinatario × canal) y agrega resultados; los
 * canales (Email/SMS…) entregan. Los enums viajan como STRING (se comparan por nombre).
 */

// ---------- Enums ----------

/** Espejo de CampaignChannel ([Flags] en el back; acá lista de nombres). */
export type ApiChannel = 'Email' | 'Sms' | 'WhatsApp' | 'Push' | 'InApp';
export const CHANNELS: ApiChannel[] = ['Email', 'Sms', 'WhatsApp', 'Push', 'InApp'];

/** Espejo de CampaignStatus. */
export type ApiCampaignStatus = 'Draft' | 'Ready' | 'Scheduled' | 'Archived';

/** Espejo de CampaignRunStatus. */
export type ApiRunStatus = 'Dispatching' | 'Completed' | 'PartiallyFailed' | 'Failed' | 'Cancelled' | 'Rejected';

/** Espejo de DispatchState (estado de una unidad destinatario/canal). */
export type ApiUnitState = 'Pending' | 'Dispatched' | 'Accepted' | 'Delivered' | 'Failed' | 'Skipped' | 'Unknown';

/** Espejo de ContactSource. */
export type ApiContactSource = 'Manual' | 'Import' | 'FromCustomer';

/** Espejo de SenderProfileStatus. */
export type ApiSenderStatus = 'Active' | 'Disabled';

/** Espejo de ScheduleKind / ScheduleStatus. */
export type ApiScheduleKind = 'OneTime' | 'Recurring';
export type ApiScheduleStatus = 'Active' | 'Paused' | 'Cancelled' | 'Completed';

// ---------- PagedResult ----------

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

// ---------- Campaign ----------

export interface CampaignSenderSelection {
  channel: ApiChannel;
  senderProfileId: string;
}

export interface CampaignResponse {
  id: string;
  tenantId: string;
  name: string;
  createdByUserId: string;
  channels: ApiChannel[];
  subject: string | null;
  message: string;
  status: ApiCampaignStatus;
  senders: CampaignSenderSelection[];
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface CreateCampaignRequest {
  name: string;
  channels: ApiChannel[];
  message: string;
  subject?: string | null;
}

export interface SetCampaignSenderRequest {
  channel: ApiChannel;
  senderProfileId: string;
}

// ---------- Runs ----------

export interface RunRecipient {
  id: string;
  contactRef: string;
  channel: ApiChannel;
  email: string | null;
  phoneE164: string | null;
  state: ApiUnitState;
  reason: string | null;
  providerRef: string | null;
  dispatchId: string;
}

export interface CampaignRunResponse {
  id: string;
  tenantId: string;
  campaignId: string;
  status: ApiRunStatus;
  triggerKind: string;
  recipientCount: number;
  dispatched: number;
  accepted: number;
  delivered: number;
  failed: number;
  skipped: number;
  unknown: number;
  createdAtUtc: string;
  finishedAtUtc: string | null;
  recipients: RunRecipient[];
}

export interface SendNowRecipient {
  contactRef: string;
  email?: string | null;
  phoneE164?: string | null;
}
export interface SendNowRequest {
  recipients: SendNowRecipient[];
}

export interface ManualAudienceEntry {
  email?: string | null;
  phoneE164?: string | null;
}
export interface SendToAudienceRequest {
  contactListIds?: string[];
  manual?: ManualAudienceEntry[];
  includeCustomers?: boolean;
}

// ---------- Contacts ----------

export interface ContactResponse {
  id: string;
  tenantId: string;
  name: string | null;
  email: string | null;
  phoneE164: string | null;
  source: ApiContactSource;
  customerRef: string | null;
  optedOutChannels: ApiChannel[];
  createdAtUtc: string;
  updatedAtUtc: string;
}
export interface CreateContactRequest {
  name?: string | null;
  email?: string | null;
  phoneE164?: string | null;
}
export interface SetContactOptOutRequest {
  channels: ApiChannel[];
  optedOut: boolean;
}

// ---------- Contact lists ----------

export interface ContactListResponse {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAtUtc: string;
  updatedAtUtc: string;
}
export interface CreateContactListRequest {
  name: string;
  description?: string | null;
}
export interface ImportContactsRequest {
  csv: string;
}
export interface ImportContactsResponse {
  created: number;
  reused: number;
  invalid: number;
  membersAdded: number;
}

// ---------- Sender profiles ----------

export interface SenderProfileResponse {
  id: string;
  tenantId: string;
  channel: ApiChannel;
  name: string;
  senderRef: string;
  status: ApiSenderStatus;
  createdAtUtc: string;
  updatedAtUtc: string;
}
export interface CreateSenderProfileRequest {
  channel: ApiChannel;
  name: string;
  senderRef: string;
}

// ---------- Schedules ----------

export interface CampaignScheduleResponse {
  id: string;
  tenantId: string;
  campaignId: string;
  kind: ApiScheduleKind;
  status: ApiScheduleStatus;
  nextFireAtUtc: string | null;
  intervalMinutes: number | null;
  contactListIds: string[];
  includeCustomers: boolean;
  lastFiredAtUtc: string | null;
  activeRunId: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}
export interface ScheduleCampaignRequest {
  recurring: boolean;
  runAtUtc: string;
  intervalMinutes?: number | null;
  contactListIds?: string[];
  includeCustomers?: boolean;
}
export type ScheduleAction = 'pause' | 'resume' | 'cancel';

// ---------- Email templates (réplica de EmailTemplatesController, para el picker del body) ----------

/** Subset de EmailTemplateResponse que usa el picker de la campaña. */
export interface EmailTemplateSummary {
  id: string;
  templateKey: string;
  subject: string;
  description: string | null;
  category: string | null;
  status: string;
}

// ---------- View-model helpers ----------

/** Combina la lista de canales en el flag de estilo del chip. */
export const channelClass = (c: ApiChannel): string =>
  ({
    Email: 'bg-blue-50 text-blue-700',
    Sms: 'bg-teal-50 text-teal-700',
    WhatsApp: 'bg-green-50 text-green-700',
    Push: 'bg-purple-50 text-purple-700',
    InApp: 'bg-slate-100 text-slate-600',
  })[c] ?? 'bg-slate-100 text-slate-600';

/** Pill de estado de campaña. */
export const campaignStatusClass = (s: ApiCampaignStatus): string =>
  ({
    Draft: 'bg-slate-100 text-slate-600',
    Ready: 'bg-blue-50 text-blue-700',
    Scheduled: 'bg-blue-50 text-blue-700',
    Archived: 'bg-slate-100 text-slate-500',
  })[s] ?? 'bg-slate-100 text-slate-600';

/** Pill de estado de run. */
export const runStatusClass = (s: ApiRunStatus): string =>
  ({
    Completed: 'bg-green-50 text-green-700',
    Dispatching: 'bg-blue-50 text-blue-700',
    PartiallyFailed: 'bg-amber-50 text-amber-700',
    Failed: 'bg-red-50 text-red-700',
    Cancelled: 'bg-slate-100 text-slate-600',
    Rejected: 'bg-red-50 text-red-700',
  })[s] ?? 'bg-slate-100 text-slate-600';

/** Pill de estado de unidad. */
export const unitStateClass = (s: ApiUnitState): string =>
  ({
    Delivered: 'bg-green-50 text-green-700',
    Accepted: 'bg-blue-50 text-blue-700',
    Failed: 'bg-red-50 text-red-700',
    Skipped: 'bg-amber-50 text-amber-700',
    Unknown: 'bg-slate-100 text-slate-600',
    Pending: 'bg-slate-100 text-slate-500',
    Dispatched: 'bg-slate-100 text-slate-500',
  })[s] ?? 'bg-slate-100 text-slate-600';
