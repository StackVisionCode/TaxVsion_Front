import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SeatPurchaseStore } from './seat-purchase.store';
import { SubscriptionService } from './subscription.service';
import {
  ProviderCustomer,
  SeatCheckoutStatusResponse,
  SeatPurchaseOutcome,
  SeatQuoteResponse,
  StartSeatCheckoutResponse,
} from './subscription.model';

describe('SeatPurchaseStore', () => {
  const quote: SeatQuoteResponse = {
    seatType: 'Standard',
    quantity: 2,
    billingCycle: 'Monthly',
    unitAmountCents: 1500,
    proratedUnitAmountCents: 1500,
    proratedTotalCents: 3000,
    currency: 'USD',
    currentPeriodEndUtc: '2026-10-16T00:00:00Z',
  };

  function setup(serviceStub: Partial<SubscriptionService>): SeatPurchaseStore {
    TestBed.configureTestingModule({
      providers: [SeatPurchaseStore, { provide: SubscriptionService, useValue: serviceStub }],
    });
    return TestBed.inject(SeatPurchaseStore);
  }

  it('loadQuote stores the server quote and clears loading', () => {
    const store = setup({ getSeatQuote: () => of(quote) });

    store.loadQuote('Standard', 2);

    expect(store.quote()).toEqual(quote);
    expect(store.quoteLoading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('loadQuote surfaces the error message and leaves no quote', () => {
    const store = setup({ getSeatQuote: () => throwError(() => ({ status: 500 })) });

    store.loadQuote('Standard', 2);

    expect(store.quote()).toBeNull();
    expect(store.quoteLoading()).toBe(false);
    expect(store.error()).not.toBeNull();
  });

  it('startPurchase maps the created ids to a charged outcome', () => {
    const store = setup({ purchaseSeats: () => of(['id-1', 'id-2']) });
    let outcome: SeatPurchaseOutcome | undefined;

    store.startPurchase('Standard', 2, true).subscribe(result => (outcome = result));

    expect(outcome).toEqual({ status: 'charged', seatIds: ['id-1', 'id-2'] });
    expect(store.purchasing()).toBe(false);
  });

  it('clearQuote resets the quote and error', () => {
    const store = setup({ getSeatQuote: () => of(quote) });
    store.loadQuote('Standard', 2);

    store.clearQuote();

    expect(store.quote()).toBeNull();
    expect(store.error()).toBeNull();
  });

  it('checkCardOnFile picks the default saved card when the tenant has one', () => {
    const customer: ProviderCustomer = {
      id: 'c1',
      providerCode: 'Stripe',
      email: 'owner@acme.test',
      savedMethods: [
        { id: 'pm1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, isDefault: true },
      ],
    };
    const store = setup({ getProviderCustomer: () => of(customer) });

    store.checkCardOnFile('Stripe');

    expect(store.hasCardOnFile()).toBe(true);
    expect(store.defaultCard()?.last4).toBe('4242');
  });

  it('checkCardOnFile reports no card when the provider-customer is missing (404)', () => {
    const store = setup({ getProviderCustomer: () => throwError(() => ({ status: 404 })) });

    store.checkCardOnFile('Stripe');

    expect(store.hasCardOnFile()).toBe(false);
    expect(store.defaultCard()).toBeNull();
  });

  it('startCheckout returns the redirect response and clears purchasing', () => {
    const response: StartSeatCheckoutResponse = {
      seatPurchaseIntentId: 'intent-1',
      checkoutUrl: 'https://pay.example/xyz',
      paymentId: 'pay-1',
      expiresAtUtc: '2026-10-16T00:00:00Z',
    };
    const store = setup({ startSeatCheckout: () => of(response) });
    let received: StartSeatCheckoutResponse | undefined;

    store
      .startCheckout({
        seatType: 'Standard',
        quantity: 2,
        autoRenew: true,
        payerEmail: 'owner@acme.test',
        successUrl: 'https://app/ok',
        cancelUrl: 'https://app/ok',
      })
      .subscribe(result => (received = result));

    expect(received).toEqual(response);
    expect(store.purchasing()).toBe(false);
  });

  it('getCheckoutStatus passes the intent status through', () => {
    const status: SeatCheckoutStatusResponse = {
      seatPurchaseIntentId: 'intent-1',
      status: 'Provisioned',
      seatType: 'Standard',
      quantity: 2,
      proratedTotalCents: 3000,
      currency: 'USD',
      checkoutUrl: null,
    };
    const store = setup({ getSeatCheckoutStatus: () => of(status) });
    let received: SeatCheckoutStatusResponse | undefined;

    store.getCheckoutStatus('intent-1').subscribe(result => (received = result));

    expect(received).toEqual(status);
  });
});
