import { describe, expect, it } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { isRefreshRejected } from './refresh-failure';

describe('isRefreshRejected', () => {
  it('ends the session only when the refresh token itself was rejected', () => {
    expect(isRefreshRejected(new HttpErrorResponse({ status: 401 }))).toBe(true);
    expect(isRefreshRejected(new HttpErrorResponse({ status: 400 }))).toBe(true);
    expect(isRefreshRejected(new Error('No refresh token available.'))).toBe(true);
  });

  it('keeps the session on rate limits, overload and network failures', () => {
    expect(isRefreshRejected(new HttpErrorResponse({ status: 429 }))).toBe(false);
    expect(isRefreshRejected(new HttpErrorResponse({ status: 503 }))).toBe(false);
    expect(isRefreshRejected(new HttpErrorResponse({ status: 0 }))).toBe(false);
    expect(isRefreshRejected(new HttpErrorResponse({ status: 500 }))).toBe(false);
  });
});
