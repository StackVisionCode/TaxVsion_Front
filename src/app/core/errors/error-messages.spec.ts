import { HttpErrorResponse } from '@angular/common/http';
import { SERVICE_UNAVAILABLE_MESSAGE } from '@core/models/api-error.model';
import { OVERLOADED_MESSAGE } from './throttling';
import { toUserMessage } from './error-messages';

describe('toUserMessage', () => {
  it('tells apart load shedding from a service that is down', () => {
    const shed = new HttpErrorResponse({ status: 503, error: { code: 'LoadShedding.Active', retryAfterSeconds: 5 } });
    const down = new HttpErrorResponse({ status: 503 });
    const denylist = new HttpErrorResponse({ status: 503, error: { type: 'Auth.SessionDenylistUnavailable' } });

    expect(toUserMessage(shed)).toBe(OVERLOADED_MESSAGE);
    expect(toUserMessage(down)).toBe(SERVICE_UNAVAILABLE_MESSAGE);
    expect(toUserMessage(denylist)).toBe(SERVICE_UNAVAILABLE_MESSAGE);
  });
});
