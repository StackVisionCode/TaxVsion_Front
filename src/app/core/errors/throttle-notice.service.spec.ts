import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ThrottleNoticeService } from './throttle-notice.service';
import { RATE_LIMITED_MESSAGE } from './throttling';

describe('ThrottleNoticeService', () => {
  let notice: ThrottleNoticeService;
  let toasts: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    notice = TestBed.inject(ThrottleNoticeService);
    toasts = TestBed.inject(ToastService);
  });

  afterEach(() => vi.useRealTimers());

  it('counts down the wait the backend asked for', () => {
    notice.notify({ kind: 'rate-limited', retryAfterSeconds: 30 });

    expect(toasts.toasts()[0].message).toBe("You're making requests too quickly. Please try again in 30 seconds.");
    vi.advanceTimersByTime(1000);
    expect(toasts.toasts()[0].message).toBe("You're making requests too quickly. Please try again in 29 seconds.");
  });

  it('shows one notice even when many requests are throttled at once', () => {
    notice.notify({ kind: 'rate-limited', retryAfterSeconds: 10 });
    notice.notify({ kind: 'rate-limited', retryAfterSeconds: 12 });
    notice.notify({ kind: 'overloaded', retryAfterSeconds: 5 });

    expect(toasts.toasts()).toHaveLength(1);
  });

  it('absorbs the screen toast that repeats the same failure', () => {
    notice.notify({ kind: 'rate-limited', retryAfterSeconds: 20 });
    toasts.error(RATE_LIMITED_MESSAGE); // lo que muestra la pantalla con toApiError(err).message

    expect(toasts.toasts()).toHaveLength(1);
  });

  it('without a wait it still explains what happened', () => {
    notice.notify({ kind: 'rate-limited', retryAfterSeconds: null });

    expect(toasts.toasts()[0].message).toBe(RATE_LIMITED_MESSAGE);
  });

  it('long waits are stated in minutes instead of counting thousands of seconds', () => {
    notice.notify({ kind: 'rate-limited', retryAfterSeconds: 1800 });

    expect(toasts.toasts()[0].message).toBe("You're making requests too quickly. Please try again in 30 minutes.");
  });
});
