import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../../../app.routes';

describe('PayableRedirectPageComponent', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('redirects stable invoice URLs back to the PaymentClient resolver', async () => {
    const replace = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, replace },
      writable: true,
      configurable: true,
    });

    TestBed.configureTestingModule({
      providers: [provideRouter(routes)],
    });
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/payments-client/invoices/ref_123');

    expect(replace).toHaveBeenCalledWith('http://localhost:5047/payments-client/invoices/ref_123');
  });
});
