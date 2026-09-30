import { HttpErrorResponse } from '@angular/common/http';
import { SERVICE_UNAVAILABLE_MESSAGE } from '@core/models/api-error.model';
import { OVERLOADED_MESSAGE } from './throttling';
import { toUserMessage } from './error-messages';
import { messageForStatus } from './friendly-http-message';

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

describe('toUserMessage — status fallback', () => {
  it('uses the status catalog for uncatalogued codes', () => {
    const err = new HttpErrorResponse({ status: 404, error: { code: 'Customer.NotFound', message: 'Customer 1 not found' } });
    expect(toUserMessage(err)).toBe(messageForStatus(404));
  });
});
