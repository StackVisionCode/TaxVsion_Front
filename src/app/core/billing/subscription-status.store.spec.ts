import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { BillingPreferenceService } from './billing-preference.service';
import { MySubscription } from './subscription-status.model';
import { SubscriptionStatusService } from './subscription-status.service';
import { SubscriptionStatusStore } from './subscription-status.store';

/** Cuándo se tapa el CRM: desde que vence sin pagar, no en un estado al día. */
describe('SubscriptionStatusStore · isLocked', () => {
  function storeWith(status: string, billingAccessBlocked = false): SubscriptionStatusStore {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SubscriptionStatusService,
          useValue: { getMySubscription: () => of({ status, billingAccessBlocked } as MySubscription) },
        },
        { provide: BillingPreferenceService, useValue: { get: () => of(null) } },
        { provide: AuthService, useValue: {} },
      ],
    });
    const store = TestBed.inject(SubscriptionStatusStore);
    store.refresh().subscribe();
    return store;
  }

  afterEach(() => TestBed.resetTestingModule());

  it.each(['PastDue', 'Suspended', 'Expired'])('%s bloquea', status => {
    expect(storeWith(status).isLocked()).toBe(true);
  });

  it.each(['Active', 'Trialing'])('%s no bloquea', status => {
    expect(storeWith(status).isLocked()).toBe(false);
  });

  it('un 403 de suscripción inactiva bloquea aunque /me no haya cargado', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: SubscriptionStatusService, useValue: {} },
        { provide: BillingPreferenceService, useValue: {} },
        { provide: AuthService, useValue: {} },
      ],
    });
    const store = TestBed.inject(SubscriptionStatusStore);

    store.markBlockedFromError();

    expect(store.isLocked()).toBe(true);
  });
});
