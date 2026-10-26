import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';

export type PublicFormKind = 'directed' | 'intake';

/** Idioma de los avisos por email al participante externo (P-21.5). */
export type PublicFormLanguage = 'En' | 'Es';

export interface PublicEntryNotice {
  title: string;
  language: string;
  body: unknown;
  contentHash: string;
}

export interface PublicFormBotProtection {
  provider: 'turnstile';
  siteKey: string;
  action: string;
}

export interface PublicDirectedFormAccess {
  title: string;
  tenantBrandingKey: string;
  maskedEmail: string;
  entryNotice: PublicEntryNotice;
}

export interface PublicIntakeFormAccess {
  title: string;
  tenantBrandingKey: string;
  entryNotice: PublicEntryNotice;
  botProtection: PublicFormBotProtection;
}

export interface PublicFormSessionGrant {
  sessionToken: string;
  expiresAtUtc: string;
  requestId?: string;
}

export interface PublicFormAttachment {
  id: string;
  fileId: string;
  componentId: string;
  rowId: string | null;
  displayName: string;
  status: 'Pending' | 'Available' | 'Rejected' | 'Detached';
  rejectionCode: string | null;
}

export interface PublicFormConsentEvidence {
  outcome: 'Presented' | 'Accepted' | 'Declined';
  recordedAtUtc: string;
}

export interface PublicFormConsent {
  componentId: string;
  noticeKey: string;
  noticeVersionNumber: number;
  mode: 'noticeOnly' | 'acceptance';
  timing: 'beforeCollection' | 'beforeSubmit' | null;
  acceptanceText: string | null;
  blocking: boolean;
  language: string;
  body: unknown;
  contentHash: string;
  evidence: PublicFormConsentEvidence | null;
}

export interface PublicFormReview {
  message: string | null;
  fieldComments: { componentId: string; rowId: string | null; comment: string }[];
}

export interface PublicFormRequest {
  id: string;
  title: string;
  messageToClient: string | null;
  status: 'Pending' | 'Submitted' | 'Returned' | 'Completed' | 'Cancelled';
  readOnly: boolean;
  dueAtUtc: string | null;
  taxYear: number | null;
  definition: FormDefinition;
  answers: FormAnswers;
  rowVersion: string;
  attachments: PublicFormAttachment[];
  consents: PublicFormConsent[];
  review: PublicFormReview | null;
}

export interface DraftSaveResponse {
  saved: boolean;
  rowVersion: string | null;
  savedAtUtc: string | null;
  progress: number | null;
  issues: ValidationIssue[];
}

export interface SensitiveAnswerResponse {
  sensitiveRef: string;
  last4: string;
  kind: string;
  rowVersion: string;
}

export interface PresignedPost {
  url: string;
  formData: Record<string, string>;
  expiresAtUtc: string;
}

export interface AttachmentUploadResponse {
  fileId: string;
  attachmentId: string;
  presignedPost: PresignedPost;
  rowVersion: string;
}

export interface RowVersionResponse {
  rowVersion: string;
}

export interface SubmitResponse {
  submitted: boolean;
  status: string | null;
  revisionNumber: number | null;
  rowVersion: string | null;
  issues: ValidationIssue[];
}

export interface StoredPublicFormSession {
  sessionToken: string;
  expiresAtUtc: string;
  requestId: string | null;
}
