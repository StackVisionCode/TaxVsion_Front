import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { SeatPurchaseModalComponent } from './seat-purchase-modal.component';
import { SeatPurchaseStore } from '../../data-access/seat-purchase.store';

describe('SeatPurchaseModalComponent', () => {
  function setup() {
    const calls = { loadQuote: 0, checkCardOnFile: 0, clearQuote: 0 };
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
    return { component: fixture.componentInstance, calls };
  }

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
});
