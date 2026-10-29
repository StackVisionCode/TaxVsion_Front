import type { FormIntakeLink } from '../data-access/client-forms.model';

/** Forma real de `FormIntakeLinkResponse` (enums como texto por `JsonStringEnumConverter`). */
export function intakeLinkResponse(patch: Partial<FormIntakeLink> = {}): FormIntakeLink {
  return {
    id: 'link-1',
    name: 'Website intake',
    formTemplateId: 'template-1',
    formTemplateVersionId: 'version-2',
    entryNoticeId: 'notice-1',
    entryNoticeVersionNumber: 1,
    status: 'Active',
    tokenLast4: 'aB3d',
    expiresAtUtc: null,
    maxSubmissions: 50,
    submissionCount: 3,
    responsibleUserId: 'user-1',
    createdAtUtc: '2026-10-20T12:00:00',
    rowVersion: 'AAAAAAAAB9E=',
    ...patch,
  };
}
