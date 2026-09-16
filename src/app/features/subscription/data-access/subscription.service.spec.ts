import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfigService } from '@core/config/api-config.service';
import { SubscriptionService } from './subscription.service';
import { SeatQuoteResponse } from './subscription.model';

describe('SubscriptionService — seats', () => {
  let service: SubscriptionService;
  let httpMock: HttpTestingController;
  const base = 'http://test';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SubscriptionService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantBase: () => base } },
      ],
    });
    service = TestBed.inject(SubscriptionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getSeatQuote GETs /seats/quote with seatType and quantity params', () => {
    const expected: SeatQuoteResponse = {
      seatType: 'Standard',
      quantity: 3,
      billingCycle: 'Monthly',
      unitAmountCents: 1500,
      proratedUnitAmountCents: 1500,
      proratedTotalCents: 4500,
      currency: 'USD',
      currentPeriodEndUtc: '2026-10-16T00:00:00Z',
    };
    let received: SeatQuoteResponse | undefined;

    service.getSeatQuote('Standard', 3).subscribe(quote => (received = quote));

    const request = httpMock.expectOne(candidate => candidate.url === `${base}/seats/quote`);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('seatType')).toBe('Standard');
    expect(request.request.params.get('quantity')).toBe('3');
    request.flush(expected);
    expect(received).toEqual(expected);
  });

  it('purchaseSeats POSTs the request to /seats/purchase', () => {
    let ids: string[] | undefined;

    service.purchaseSeats({ seatType: 'Standard', quantity: 2, autoRenew: true }).subscribe(result => (ids = result));

    const request = httpMock.expectOne(`${base}/seats/purchase`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ seatType: 'Standard', quantity: 2, autoRenew: true });
    request.flush(['id-1', 'id-2']);
    expect(ids).toEqual(['id-1', 'id-2']);
  });
});
