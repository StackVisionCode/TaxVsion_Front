import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type {
  FormDefinition,
  FormPurpose,
} from '@shared/utils/data-collection/form-definition.model';
import type {
  DataCollectionAttachment,
  DataCollectionFieldComment,
} from '@shared/ui/data-collection/data-collection.models';

export type ClientFormRequestStatus =
  'Pending' | 'Submitted' | 'Returned' | 'Completed' | 'Cancelled';

export interface ClientFormActionRun {
  id: string;
  actionType: string;
  status: 'Requested' | 'Completed' | 'Rejected' | 'Failed' | 'Skipped';
  existingCustomerId: string | null;
  errorDetail: string | null;
  canRetry: boolean;
}

export interface ClientFormRequestRow {
  id: string;
  displayName: string;
  templateName: string;
  title: string;
  status: ClientFormRequestStatus;
  versionNumber: number;
  dueAtUtc: string | null;
  isOverdue: boolean;
  progressPercent: number;
  currentRevisionNumber: number;
  lastSubmittedAtUtc: string | null;
  requestedAtUtc: string;
  actionRuns: ClientFormActionRun[];
}

export interface ClientFormRequestValue {
  id: string;
  responsibleUserId: string | null;
  title: string;
  status: ClientFormRequestStatus;
  dueAtUtc: string | null;
  progressPercent: number;
  currentRevisionNumber: number;
  rowVersion: string;
}

export interface ClientFormRevisionSummary {
  number: number;
  submittedAtUtc: string;
  outcome: 'Pending' | 'Returned' | 'Completed';
  reviewMessage: string | null;
  fieldComments: DataCollectionFieldComment[];
}

export interface ClientFormRevision extends ClientFormRevisionSummary {
  answers: FormAnswers;
}

export interface ClientFormTimelineEntry {
  action: string;
  outcome: string;
  actorType: string;
  occurredAtUtc: string;
}

export interface ClientFormRequestDetail {
  request: ClientFormRequestValue;
  definition: FormDefinition;
  progressPercent: number;
  revisions: ClientFormRevisionSummary[];
  latestRevisionAnswers: FormAnswers | null;
  attachments: DataCollectionAttachment[];
  timeline: ClientFormTimelineEntry[];
  actionRuns: ClientFormActionRun[];
}

export interface AssignableClientFormTemplate {
  templateId: string;
  name: string;
  purpose: FormPurpose;
  latestVersionNumber: number;
  title: string;
}

export interface AssignClientFormInput {
  customerId: string;
  templateId: string;
  title: string | null;
  messageToClient: string | null;
  dueAtUtc: string | null;
  taxYear: number | null;
  taskId: string | null;
  prefillFromRequestId: string | null;
}

export interface ClientFormPage<T> {
  items: T[];
  page: number;
  size: number;
  totalCount: number;
}
