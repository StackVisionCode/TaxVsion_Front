import { describe, expect, it } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { OVERLOADED_MESSAGE, RATE_LIMITED_MESSAGE } from '@core/errors/throttling';
import { SERVICE_UNAVAILABLE_MESSAGE, toApiError } from './api-error.model';

/**
 * Más de 200 pantallas muestran `toApiError(err).message` tal cual: para rate limit y load shedding el
 * texto del backend era técnico ("user rate limit exceeded…", "Fleet is overloaded…").
 */
describe('toApiError — throttling', () => {
  it('replaces the backend rate-limit text with a friendly message and keeps the code', () => {
    const err = new HttpErrorResponse({
      status: 429,
      error: { code: 'RateLimit.Exceeded', message: 'user rate limit exceeded. Retry after 60 seconds.' },
    });

    expect(toApiError(err)).toEqual({ code: 'RateLimit.Exceeded', message: RATE_LIMITED_MESSAGE });
  });

  it('never shows "Fleet is overloaded" for gateway load shedding', () => {
    const err = new HttpErrorResponse({
      status: 503,
      error: { code: 'LoadShedding.Active', message: 'Fleet is overloaded. Retry after 5 seconds.' },
    });

    expect(toApiError(err).message).toBe(OVERLOADED_MESSAGE);
  });

  it('keeps business messages for domain throttles', () => {
    const err = new HttpErrorResponse({
      status: 429,
      error: { code: 'Auth.LockedOut', message: 'Too many attempts. Try again later.' },
    });

    expect(toApiError(err)).toEqual({ code: 'Auth.LockedOut', message: 'Too many attempts. Try again later.' });
  });
});

describe('toApiError — service unavailable', () => {
  it('reads the code from `type` and hides the technical title of the session denylist', () => {
    const err = new HttpErrorResponse({
      status: 503,
      error: { type: 'Auth.SessionDenylistUnavailable', title: 'Session revocation status is unknown.' },
    });

    expect(toApiError(err)).toEqual({ code: 'Auth.SessionDenylistUnavailable', message: SERVICE_UNAVAILABLE_MESSAGE });
  });

  it('explains an empty 503 as a temporary outage', () => {
    expect(toApiError(new HttpErrorResponse({ status: 503 }))).toEqual({
      code: 'Http.503',
      message: SERVICE_UNAVAILABLE_MESSAGE,
    });
  });

  it('keeps the message of a business 503', () => {
    const err = new HttpErrorResponse({
      status: 503,
      error: { code: 'PayPal.ConfigurationMissing', message: 'PayPal is not configured for this office.' },
    });

    expect(toApiError(err)).toEqual({ code: 'PayPal.ConfigurationMissing', message: 'PayPal is not configured for this office.' });
  });

  it('never uses the URL `type` of an ASP.NET ProblemDetails as the code', () => {
    const err = new HttpErrorResponse({
      status: 500,
      error: { type: 'https://tools.ietf.org/html/rfc9110#section-15.6.1', title: 'An error occurred.' },
    });

    expect(toApiError(err).code).toBe('Http.500');
  });
});
