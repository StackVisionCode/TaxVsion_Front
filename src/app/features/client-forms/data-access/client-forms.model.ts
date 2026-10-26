import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type {
  FormDefinition,
  FormPresentation,
  FormPurpose,
} from '@shared/utils/data-collection/form-definition.model';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';

export type FormTemplateStatus = 'Active' | 'Archived';

export interface PagedResult<T> {
  items: T[];
  page: number;
  size: number;
  totalCount: number;
}

export interface ClientFormsAvailability {
  enabled: boolean;
  /** Código de causa (hoy solo `ClientForms.ModuleUnavailable`); nunca se muestra crudo. */
  reason: string | null;
  /** Sub-flags efectivos de la oficina; null cuando el módulo no está disponible. */
  capabilities?: ClientFormsCapabilities | null;
}

export interface ClientFormsCapabilities {
  externalParticipantsEnabled: boolean;
  intakeLinksEnabled: boolean;
  autoCustomerCreationEnabled: boolean;
  signatureStepEnabled: boolean;
  pushNotificationsEnabled: boolean;
}

export interface FormTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  purpose: FormPurpose;
  status: FormTemplateStatus;
  latestVersionNumber: number;
  draftUpdatedAtUtc: string;
}

export interface FormTemplateVersionSummary {
  id: string;
  versionNumber: number;
  title: string;
  componentCount: number;
  publishedAtUtc: string;
  publishedByUserId: string;
}

export interface FormTemplateDetail extends FormTemplateSummary {
  draft: string;
  draftHash: string;
  rowVersion: string;
  latestVersionId: string | null;
  draftUpdatedByUserId: string;
  versions: FormTemplateVersionSummary[];
}

export interface FormTemplateVersion {
  id: string;
  templateId: string;
  versionNumber: number;
  schemaVersion: number;
  title: string;
  purpose: FormPurpose;
  presentation: FormPresentation;
  definition: string;
  contentHash: string;
  componentCount: number;
  publishedAtUtc: string;
  publishedByUserId: string;
  targetCatalogVersion: number;
}

export interface DraftUpdateOutcome {
  updated: boolean;
  rowVersion: string | null;
  draftHash: string | null;
  issues: ValidationIssue[];
}

export interface PublishOutcome {
  published: boolean;
  version: FormTemplateVersion | null;
  issues: ValidationIssue[];
}

export interface TemplateValidationResponse {
  issues: ValidationIssue[];
}

export interface CreateFormTemplateInput {
  name: string;
  description: string | null;
  purpose: FormPurpose;
  presentation: FormPresentation;
}

export interface TemplateFilters {
  status?: FormTemplateStatus;
  purpose?: FormPurpose;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface DefinitionSnapshot {
  definition: FormDefinition;
  rowVersion: string;
}

export type FormParticipantKind = 'Customer' | 'External';
export type FormRequestStatus = 'Pending' | 'Submitted' | 'Returned' | 'Completed' | 'Cancelled';
export type FormRequestOrigin = 'Directed' | 'IntakeLink';
export type FormRequestInboxView = 'All' | 'Clients' | 'External' | 'NeedsAction';
export type FormActionRunStatus = 'Requested' | 'Completed' | 'Rejected' | 'Failed' | 'Skipped';
export type CustomerLinkStatus = 'None' | 'Linked' | 'Blocked';
export type FormRevisionOutcome = 'Pending' | 'Returned' | 'Completed';
export type FormAttachmentStatus = 'Pending' | 'Available' | 'Rejected' | 'Detached';

export interface FormRequestParticipant {
  kind: FormParticipantKind;
  customerId: string | null;
  participantId: string | null;
}

export interface FormActionRun {
  id: string;
  revisionNumber: number;
  actionKey: string;
  actionType: string;
  status: FormActionRunStatus;
  attempt: number;
  requestedAtUtc: string;
  completedAtUtc: string | null;
  resultRefKind: string | null;
  resultRefId: string | null;
  existingCustomerId: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  warnings: string[];
  isLatestAttempt: boolean;
  canRetry: boolean;
}

export interface FormRequestListItem {
  id: string;
  participant: FormRequestParticipant;
  origin: FormRequestOrigin;
  customerLinkStatus: CustomerLinkStatus;
  responsibleUserId: string | null;
  displayName: string;
  templateName: string;
  maskedEmail: string | null;
  receivedAtUtc: string | null;
  title: string;
  status: FormRequestStatus;
  versionNumber: number;
  dueAtUtc: string | null;
  isOverdue: boolean;
  progressPercent: number;
  currentRevisionNumber: number;
  lastSubmittedAtUtc: string | null;
  requestedByUserId: string;
  requestedAtUtc: string;
  actionRuns: FormActionRun[];
}

export interface FormRequestFilters {
  customerId?: string;
  participantKind?: FormParticipantKind;
  responsibleUserId?: string;
  statuses?: readonly FormRequestStatus[];
  templateId?: string;
  overdue?: boolean;
  search?: string;
  view?: FormRequestInboxView;
  page?: number;
  pageSize?: number;
}

export interface FormRequest {
  id: string;
  participant: FormRequestParticipant;
  origin: FormRequestOrigin;
  customerLinkStatus: CustomerLinkStatus;
  responsibleUserId: string | null;
  formTemplateId: string;
  formTemplateVersionId: string;
  versionNumber: number;
  title: string;
  messageToClient: string | null;
  taxYear: number | null;
  taskId: string | null;
  dueAtUtc: string | null;
  status: FormRequestStatus;
  progressPercent: number;
  currentRevisionNumber: number;
  lastSubmittedAtUtc: string | null;
  rowVersion: string;
}

export interface FormFieldComment {
  componentId: string;
  rowId: string | null;
  comment: string;
}

export interface FormRequestRevisionSummary {
  number: number;
  submittedAtUtc: string;
  outcome: FormRevisionOutcome;
  reviewMessage: string | null;
  fieldComments: FormFieldComment[];
  pdfStatus: 'None' | 'Requested' | 'Ready' | 'Failed';
  pdfFileId: string | null;
}

export interface FormRequestRevision extends FormRequestRevisionSummary {
  answers: FormAnswers;
  consents: unknown[];
}

export interface StaffFormAttachment {
  id: string;
  componentId: string;
  rowId: string | null;
  fileId: string;
  displayName: string;
  status: FormAttachmentStatus;
  rejectionCode: string | null;
}

export interface FormRequestTimelineEntry {
  action: string;
  outcome: string;
  actorUserId: string | null;
  actorType: string;
  occurredAtUtc: string;
}

export interface FormCustomerLink {
  status: CustomerLinkStatus;
  customerId: string | null;
  reason: string | null;
  conflictingRequestId: string | null;
}

export interface StaffFormRequestDetail {
  request: FormRequest;
  definition: FormDefinition;
  progressPercent: number;
  revisions: FormRequestRevisionSummary[];
  latestRevisionAnswers: FormAnswers | null;
  attachments: StaffFormAttachment[];
  consents: unknown[];
  timeline: FormRequestTimelineEntry[];
  actionRuns: FormActionRun[];
  customerLink: FormCustomerLink;
  /** Mismo nombre y email enmascarado que la fila de la bandeja (deep link sin fila). */
  displayName: string;
  maskedEmail: string | null;
}

export interface AssignableFormTemplate {
  templateId: string;
  name: string;
  purpose: FormPurpose;
  latestVersionNumber: number;
  title: string;
}

export interface AssignFormRequestInput {
  customerId: string;
  templateId: string;
  title: string | null;
  messageToClient: string | null;
  dueAtUtc: string | null;
  taxYear: number | null;
  taskId: string | null;
  prefillFromRequestId: string | null;
}

export interface StaffMemberOption {
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
}

/** `AssignExternalFormRequestRequest` (P-14 flujo A); `entryNoticeKey` es obligatorio (D-35). */
export interface AssignExternalFormRequestInput {
  email: string;
  fullName: string | null;
  templateId: string;
  entryNoticeKey: string;
  title: string | null;
  messageToClient: string | null;
  dueAtUtc: string | null;
  taxYear: number | null;
}

export type ConsentNoticePurpose = 'General' | 'IdentityVerification';

/**
 * `ActiveConsentNoticeResponse` de `GET consent-notices/active`: solo avisos activos con su última
 * versión publicada.
 */
export interface ActiveConsentNotice {
  id: string;
  key: string;
  title: string;
  purpose: ConsentNoticePurpose;
  versionNumber: number;
  language: string;
  textSnapshot: string;
  contentHash: string;
  publishedAtUtc: string;
}

export type FormIntakeLinkStatus = 'Active' | 'Paused' | 'Revoked';

/** `FormIntakeLinkResponse` (P-14 flujo B). */
export interface FormIntakeLink {
  id: string;
  name: string;
  formTemplateId: string;
  formTemplateVersionId: string;
  entryNoticeId: string | null;
  entryNoticeVersionNumber: number | null;
  status: FormIntakeLinkStatus;
  tokenLast4: string;
  expiresAtUtc: string | null;
  maxSubmissions: number | null;
  submissionCount: number;
  responsibleUserId: string;
  createdAtUtc: string;
  rowVersion: string;
}

/** `FormIntakeLinkTokenResponse`: `token` llega al crear, al regenerar y en `GET {id}/token`; si no, null. */
export interface FormIntakeLinkTokenResponse {
  link: FormIntakeLink;
  token: string | null;
}

/** `CreateFormIntakeLinkRequest`; sin versión, el backend fija la última publicada. */
export interface CreateFormIntakeLinkInput {
  name: string;
  formTemplateId: string;
  formTemplateVersionId: string | null;
  entryNoticeKey: string;
  expiresAtUtc: string | null;
  maxSubmissions: number | null;
  responsibleUserId: string;
}

export type FormIntakeLinkAction = 'pause' | 'resume' | 'revoke' | 'regenerate-token';
