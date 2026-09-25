import { describe, expect, it } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { OVERLOADED_MESSAGE, RATE_LIMITED_MESSAGE } from '@core/errors/throttling';
import { toApiError } from './api-error.model';

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
