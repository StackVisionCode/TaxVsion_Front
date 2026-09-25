import { Injectable, inject } from '@angular/core';
import { ToastService } from '@shared/ui/toast/toast.service';
import {
  OVERLOADED_MESSAGE,
  RATE_LIMITED_MESSAGE,
  Throttle,
  throttleCountdownMessage,
  throttleMessage,
} from './throttling';

const THROTTLE_TOAST_KEY = 'throttle';

/**
 * Aviso global único ante un rate limit o load shedding: un solo toast (aunque fallen varios requests
 * a la vez) que dice cuánto esperar y cuenta hacia atrás. Mientras está visible, absorbe los toasts que
 * las pantallas levantan con el mismo texto (`toApiError(err).message`), así el usuario no ve el aviso
 * repetido.
 */
@Injectable({ providedIn: 'root' })
export class ThrottleNoticeService {
  /** Más allá de esto no se cuenta segundo a segundo: se avisa cuánto falta y el toast se va solo. */
  private static readonly MAX_COUNTDOWN_SECONDS = 120;
  private static readonly STATIC_NOTICE_SECONDS = 6;

  private readonly toast = inject(ToastService);

  notify(throttle: Throttle): void {
    const absorbs = [RATE_LIMITED_MESSAGE, OVERLOADED_MESSAGE];
    const seconds = throttle.retryAfterSeconds;

    if (seconds === null) {
      const message = throttleMessage(throttle);
      this.toast.countdown(THROTTLE_TOAST_KEY, 'info', ThrottleNoticeService.STATIC_NOTICE_SECONDS, () => message, absorbs);
      return;
    }
    if (seconds > ThrottleNoticeService.MAX_COUNTDOWN_SECONDS) {
      const message = throttleCountdownMessage(throttle.kind, seconds);
      this.toast.countdown(THROTTLE_TOAST_KEY, 'info', ThrottleNoticeService.STATIC_NOTICE_SECONDS, () => message, absorbs);
      return;
    }
    this.toast.countdown(
      THROTTLE_TOAST_KEY,
      'info',
      seconds,
      secondsLeft => throttleCountdownMessage(throttle.kind, secondsLeft),
      absorbs,
    );
  }
}
