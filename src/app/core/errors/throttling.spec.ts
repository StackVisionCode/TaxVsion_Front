import { describe, expect, it } from 'vitest';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import {
  OVERLOADED_MESSAGE,
  RATE_LIMITED_MESSAGE,
  formatWait,
  isSocketRateLimited,
  isThrottled,
  readThrottle,
  socketErrorCode,
  throttleCountdownMessage,
  throttleMessageOr,
} from './throttling';

function httpError(status: number, error: unknown, headers?: Record<string, string>): HttpErrorResponse {
  return new HttpErrorResponse({ status, error, headers: new HttpHeaders(headers ?? {}) });
}

describe('readThrottle', () => {
  it('reads the rate-limit contract and its wait from the body', () => {
    const throttle = readThrottle(httpError(429, { code: 'RateLimit.Exceeded', retryAfterSeconds: 30 }));

    expect(throttle).toEqual({ kind: 'rate-limited', retryAfterSeconds: 30 });
  });

  it('falls back to the Retry-After header for an empty 429 from an old limiter', () => {
    const throttle = readThrottle(httpError(429, null, { 'Retry-After': '12' }));

    expect(throttle).toEqual({ kind: 'rate-limited', retryAfterSeconds: 12 });
  });

  it('recognizes gateway load shedding as "overloaded"', () => {
    const throttle = readThrottle(httpError(503, { code: 'LoadShedding.Active', retryAfterSeconds: 5 }));

    expect(throttle).toEqual({ kind: 'overloaded', retryAfterSeconds: 5 });
  });

  it('leaves domain throttles (with their own business code) to the screen', () => {
    expect(readThrottle(httpError(429, { code: 'Auth.LockedOut', message: 'Too many attempts.' }))).toBeNull();
    expect(readThrottle(httpError(503, { code: 'PayPal.ConfigurationMissing' }))).toBeNull();
    expect(readThrottle(httpError(400, { code: 'RateLimit.Exceeded' }))).toBeNull();
  });

  it('returns a null wait when the backend did not send one', () => {
    expect(readThrottle(httpError(429, { code: 'RateLimit.Exceeded' }))?.retryAfterSeconds).toBeNull();
  });
});

describe('messages', () => {
  it('formats short and long waits in human units', () => {
    expect(formatWait(1)).toBe('1 second');
    expect(formatWait(45)).toBe('45 seconds');
    expect(formatWait(61)).toBe('2 minutes');
    expect(formatWait(3600)).toBe('1 hour');
    expect(formatWait(7200)).toBe('2 hours');
  });

  it('writes the countdown in a professional, user-facing way', () => {
    expect(throttleCountdownMessage('rate-limited', 30)).toBe(
      "You're making requests too quickly. Please try again in 30 seconds.",
    );
    expect(throttleCountdownMessage('overloaded', 5)).toBe(
      "We're receiving an unusually high number of requests. Please try again in 5 seconds.",
    );
  });

  it('throttleMessageOr uses the throttle text only for throttling errors', () => {
    expect(throttleMessageOr(httpError(429, { code: 'RateLimit.Exceeded' }), 'fallback')).toBe(RATE_LIMITED_MESSAGE);
    expect(throttleMessageOr(httpError(503, { code: 'LoadShedding.Active' }), 'fallback')).toBe(OVERLOADED_MESSAGE);
    expect(throttleMessageOr(httpError(500, { code: 'Boom' }), 'fallback')).toBe('fallback');
  });
});

describe('isThrottled', () => {
  it('stops ad-hoc retries on any 429 (domain throttles too) and on load shedding', () => {
    expect(isThrottled(httpError(429, { code: 'Auth.InvitationAcceptThrottled' }))).toBe(true);
    expect(isThrottled(httpError(503, { code: 'LoadShedding.Active' }))).toBe(true);
    expect(isThrottled(httpError(403, { code: 'Auth.Forbidden' }))).toBe(false);
    expect(isThrottled(new Error('boom'))).toBe(false);
  });
});

describe('socket acks', () => {
  it('detects rate-limited acks from chat, calls and meeting chat', () => {
    expect(isSocketRateLimited('Chat.RateLimited')).toBe(true);
    expect(isSocketRateLimited('Call.RateLimited')).toBe(true);
    expect(isSocketRateLimited('Meeting.Chat.RateLimited')).toBe(true);
    expect(isSocketRateLimited('Chat.NotAssignedPreparer')).toBe(false);
    expect(isSocketRateLimited(undefined)).toBe(false);
  });

  it('reads the code attached to a rejected ack error', () => {
    const err = Object.assign(new Error('Too many call attempts'), { code: 'Call.RateLimited' });

    expect(socketErrorCode(err)).toBe('Call.RateLimited');
    expect(socketErrorCode(new Error('plain'))).toBeNull();
  });
});
