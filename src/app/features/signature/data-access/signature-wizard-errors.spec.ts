import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { DocumentRejectedError, SendNotReadyError, toWizardError } from './signature.store';

function httpError(status: number, code: string, message: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { code, message } });
}

describe('toWizardError', () => {
  it('turns a server rejection of a PDF into a DocumentRejectedError with its message', () => {
    const error = toWizardError(
      httpError(400, 'Signature.DocumentValidation.Corrupted', "'Return' can't be used: The PDF is damaged."),
    );

    expect(error).toBeInstanceOf(DocumentRejectedError);
    expect(error.message).toBe("'Return' can't be used: The PDF is damaged.");
  });

  it('keeps other failures retryable', () => {
    const error = toWizardError(httpError(500, 'Internal', 'Something went wrong.'));

    expect(error).not.toBeInstanceOf(DocumentRejectedError);
    expect(error.message).toBe('Something went wrong.');
  });

  it('passes through errors the wizard already classified', () => {
    const notReady = new SendNotReadyError('still scanning');
    const rejected = new DocumentRejectedError('rejected');

    expect(toWizardError(notReady)).toBe(notReady);
    expect(toWizardError(rejected)).toBe(rejected);
  });
});
