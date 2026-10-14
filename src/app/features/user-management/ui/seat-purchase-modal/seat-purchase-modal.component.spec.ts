import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { SeatPurchaseModalComponent, SEAT_CHECKOUT_INTENT_KEY } from './seat-purchase-modal.component';
import { SeatPurchaseStore } from '../../data-access/seat-purchase.store';

describe('SeatPurchaseModalComponent', () => {
  function setup(overrides: Partial<Record<string, unknown>> = {}) {
    const calls = { loadQuote: 0, checkCardOnFile: 0, clearQuote: 0, getCheckoutStatus: 0, cancelOpenCheckout: 0 };
    const storeStub = {
      quote: signal(null),
      quoteLoading: signal(false),
      purchasing: signal(false),
      error: signal<string | null>(null),
      hasCardOnFile: signal<boolean | null>(null),
      defaultCard: signal(null),
      clearQuote: () => (calls.clearQuote += 1),
      loadQuote: () => (calls.loadQuote += 1),
      checkCardOnFile: () => (calls.checkCardOnFile += 1),
      startPurchase: () => of({ status: 'charged', seatIds: ['s1'] }),
      getCheckoutStatus: () => {
        calls.getCheckoutStatus += 1;
        return of({
          seatPurchaseIntentId: 'int-1',
          status: 'Pending',
          seatType: 'Standard',
          quantity: 3,
          proratedTotalCents: 1500,
          currency: 'USD',
          checkoutUrl: 'https://pay.example.com/int-1',
        });
      },
      cancelOpenCheckout: () => {
        calls.cancelOpenCheckout += 1;
        return of({ alreadyCancelled: false, intentId: 'int-1' });
      },
      ...overrides,
    };
    const authStub = { currentUser: () => ({ email: 'owner@acme.test' }) };

    TestBed.configureTestingModule({
      imports: [SeatPurchaseModalComponent],
      providers: [
        { provide: SeatPurchaseStore, useValue: storeStub },
        { provide: AuthService, useValue: authStub },
      ],
    });
    const fixture = TestBed.createComponent(SeatPurchaseModalComponent);
    return { component: fixture.componentInstance, calls, storeStub };
  }

  beforeEach(() => {
    try {
      sessionStorage.removeItem(SEAT_CHECKOUT_INTENT_KEY);
    } catch {
      // jsdom: sessionStorage siempre disponible, pero por si acaso.
    }
  });

  it('loads the quote and checks the card when opened', () => {
    const { component, calls } = setup();

    component.isOpen = true;

    expect(calls.loadQuote).toBe(1);
    expect(calls.checkCardOnFile).toBe(1);
    expect(component.quantity()).toBe(1);
  });

  it('does not re-run the open flow when isOpen is set true again', () => {
    const { component, calls } = setup();

    component.isOpen = true;
    component.isOpen = true;

    expect(calls.loadQuote).toBe(1);
  });

  it('emits purchased after a successful off-session buy', () => {
    const { component } = setup();
    let purchased = false;
    component.purchased.subscribe(() => (purchased = true));

    component.isOpen = true;
    component.buyWithCardOnFile();

    expect(purchased).toBe(true);
  });

  it('shows the pending view when a stored intent is still open on the backend', () => {
    const { component, calls } = setup();
    sessionStorage.setItem(SEAT_CHECKOUT_INTENT_KEY, 'int-1');

    component.isOpen = true;

    expect(calls.getCheckoutStatus).toBe(1);
    expect(component.pendingIntent()?.seatPurchaseIntentId).toBe('int-1');
    // Mientras el pending esté arriba no se arranca la compra: ni cotización ni tarjeta.
    expect(calls.loadQuote).toBe(0);
    expect(calls.checkCardOnFile).toBe(0);
  });

  it('falls through to purchase when the stored intent is already in a terminal status', () => {
    const { component, calls } = setup({
      getCheckoutStatus: () => of({
        seatPurchaseIntentId: 'int-1',
        status: 'Cancelled',
        seatType: 'Standard',
        quantity: 3,
        proratedTotalCents: 1500,
        currency: 'USD',
        checkoutUrl: null,
      }),
    });
    sessionStorage.setItem(SEAT_CHECKOUT_INTENT_KEY, 'int-1');

    component.isOpen = true;

    expect(component.pendingIntent()).toBeNull();
    expect(calls.loadQuote).toBe(1);
    expect(calls.checkCardOnFile).toBe(1);
    expect(sessionStorage.getItem(SEAT_CHECKOUT_INTENT_KEY)).toBeNull();
  });

  it('falls through to purchase when the status call fails', () => {
    const { component, calls } = setup({
      getCheckoutStatus: () => throwError(() => new Error('404')),
    });
    sessionStorage.setItem(SEAT_CHECKOUT_INTENT_KEY, 'int-1');

    component.isOpen = true;

    expect(component.pendingIntent()).toBeNull();
    expect(calls.loadQuote).toBe(1);
  });

  it('cancels the open intent, clears storage and opens the purchase view', () => {
    const { component, calls } = setup();
    sessionStorage.setItem(SEAT_CHECKOUT_INTENT_KEY, 'int-1');

    component.isOpen = true;
    expect(component.pendingIntent()).not.toBeNull();

    component.cancelPendingCheckout();

    expect(calls.cancelOpenCheckout).toBe(1);
    expect(component.pendingIntent()).toBeNull();
    expect(sessionStorage.getItem(SEAT_CHECKOUT_INTENT_KEY)).toBeNull();
    expect(calls.loadQuote).toBe(1);
    expect(calls.checkCardOnFile).toBe(1);
  });

  it('surfaces an error inline when cancelling the open intent fails', () => {
    const { component } = setup({
      cancelOpenCheckout: () => throwError(() => ({ error: { message: 'nope' } })),
    });
    sessionStorage.setItem(SEAT_CHECKOUT_INTENT_KEY, 'int-1');

    component.isOpen = true;
    component.cancelPendingCheckout();

    expect(component.pendingCancelError()).not.toBeNull();
    expect(component.pendingIntent()).not.toBeNull();
  });
});
