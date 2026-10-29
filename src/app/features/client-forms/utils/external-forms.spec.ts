import { HttpErrorResponse } from '@angular/common/http';
import type { ActiveConsentNotice } from '../data-access/client-forms.model';
import {
  customerEmailConflict,
  externalErrorMessage,
  intakeLinkUrl,
  isEntryNotice,
  isValidEmail,
} from './external-forms';

const notice = (patch: Partial<ActiveConsentNotice>): ActiveConsentNotice => ({
  id: 'n',
  key: 'k',
  title: 'T',
  purpose: 'IdentityVerification',
  versionNumber: 1,
  language: 'en',
  textSnapshot: 'text',
  contentHash: 'hash',
  publishedAtUtc: '2026-10-01T00:00:00',
  ...patch,
});

describe('external forms utils', () => {
  it('keeps only identity verification notices with a published version (defense over the endpoint)', () => {
    expect(isEntryNotice(notice({}))).toBe(true);
    expect(isEntryNotice(notice({ purpose: 'General' }))).toBe(false);
    expect(isEntryNotice(notice({ versionNumber: 0 }))).toBe(false);
  });

  it('validates emails', () => {
    expect(isValidEmail(' pat@example.com ')).toBe(true);
    expect(isValidEmail('pat@example')).toBe(false);
    expect(isValidEmail('pat example.com')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(250)}@b.co`)).toBe(false);
  });

  it('builds the public intake link on the tenant host', () => {
    expect(intakeLinkUrl('abc', 'https://office.taxoffix.test')).toBe(
      'https://office.taxoffix.test/intake/abc',
    );
  });

  it('translates known backend codes and keeps the backend message for unknown ones', () => {
    const error = (code: string, message = 'Backend says') =>
      new HttpErrorResponse({ status: 409, error: { code, message } });

    expect(externalErrorMessage(error('FormRequest.AlreadyOpenForTemplate'))).toContain(
      'already has an open request',
    );
    expect(externalErrorMessage(error('intake.entry_notice_required'))).toBe(
      'Choose a published identity verification notice.',
    );
    expect(externalErrorMessage(error('Something.Else', 'Plain backend text'))).toBe(
      'Plain backend text',
    );
  });
  it('reads the existing-client conflict with the customerId only when it comes back', () => {
    const conflict = (body: Record<string, unknown>, status = 409) =>
      customerEmailConflict(new HttpErrorResponse({ status, error: body }));
    const message = 'This email belongs to an existing client. Assign the form to the client instead.';

    expect(conflict({ code: 'FormParticipant.EmailBelongsToCustomer', message, customerId: 'c-1' })).toEqual({
      message,
      customerId: 'c-1',
    });
    expect(conflict({ code: 'FormParticipant.EmailBelongsToCustomer', message })).toEqual({ message, customerId: null });
    expect(conflict({ code: 'FormRequest.AlreadyOpenForTemplate', message })).toBeNull();
    expect(conflict({ code: 'FormParticipant.EmailBelongsToCustomer', message }, 400)).toBeNull();
  });
});
