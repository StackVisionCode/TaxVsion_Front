import { describe, expect, it } from 'vitest';
import {
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  SERVICE_UNAVAILABLE_MESSAGE,
  firstHumanFieldError,
  friendlyMessage,
  looksTechnical,
  messageForStatus,
} from './friendly-http-message';

describe('looksTechnical', () => {
  it.each([
    'Customer already exists.',
    'Too many attempts. Try again later.',
    'PayPal is not configured for this office.',
    'The invoice has already been paid.',
    "You can't delete a folder that has files on legal hold.",
  ])('keeps human backend text: %s', text => {
    expect(looksTechnical(text)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['angular message', 'Http failure response for https://api.x.com/customers: 500 Internal Server Error'],
    ['url', 'See https://tools.ietf.org/html/rfc9110#section-15.5.1'],
    ['exception name', 'System.InvalidOperationException: Sequence contains no elements'],
    ['bare exception', 'NullReferenceException'],
    ['object reference', 'Object reference not set to an instance of an object.'],
    ['.net stack', 'Boom\n   at TaxVision.Handlers.Foo.Handle() in Foo.cs:line 42'],
    ['js error', "Cannot read properties of undefined (reading 'id')"],
    ['sql', 'duplicate key value violates unique constraint "ix_customers_email"'],
    ['sql state', '23505: SQLSTATE error'],
    ['guid only', '3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    ['bare code', 'Customer.NotFound'],
    ['reason phrase', 'Internal Server Error'],
    ['aspnet validation title', 'One or more validation errors occurred.'],
    ['json binding', 'The JSON value could not be converted to System.Guid. Path: $.id'],
    ['correlation id', 'An unexpected error occurred. Use the Correlation ID to report the issue.'],
    ['json dump', '{"code":"X"}'],
    ['too long', 'a '.repeat(300)],
  ])('flags %s', (_label, text) => {
    expect(looksTechnical(text)).toBe(true);
  });

  it('treats non-strings as technical', () => {
    expect(looksTechnical(null)).toBe(true);
    expect(looksTechnical(undefined)).toBe(true);
  });
});

describe('messageForStatus', () => {
  it('has a catalog entry for every documented status', () => {
    for (const status of [0, 400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504]) {
      expect(messageForStatus(status)).not.toBe(GENERIC_ERROR_MESSAGE);
    }
    expect(messageForStatus(0)).toBe(NETWORK_ERROR_MESSAGE);
    expect(messageForStatus(503)).toBe(SERVICE_UNAVAILABLE_MESSAGE);
  });

  it('falls back by family', () => {
    expect(messageForStatus(418)).toBe(GENERIC_ERROR_MESSAGE);
    expect(messageForStatus(507)).toBe(messageForStatus(500));
    expect(messageForStatus(undefined)).toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe('friendlyMessage', () => {
  it('keeps human text and replaces technical text by status', () => {
    expect(friendlyMessage(409, ' Customer already exists. ')).toBe('Customer already exists.');
    expect(friendlyMessage(404, 'Not Found')).toBe(messageForStatus(404));
    expect(friendlyMessage(500, null)).toBe(messageForStatus(500));
  });
});

describe('firstHumanFieldError', () => {
  it('returns the first readable field message', () => {
    expect(
      firstHumanFieldError({
        $: ['The JSON value could not be converted to System.Guid. Path: $.id'],
        Email: ['Email is required.'],
      }),
    ).toBe('Email is required.');
  });

  it('returns null when nothing is presentable', () => {
    expect(firstHumanFieldError(null)).toBeNull();
    expect(firstHumanFieldError(['x'])).toBeNull();
    expect(firstHumanFieldError({ id: ['Path: $.id'] })).toBeNull();
  });
});
