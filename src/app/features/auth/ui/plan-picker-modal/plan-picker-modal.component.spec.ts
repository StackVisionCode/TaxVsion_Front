import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { RATE_LIMITED_MESSAGE } from '@core/errors/throttling';
import { Plan } from '@core/plans/plan.model';
import { PlansService } from '@core/plans/plans.service';
import { PlanPickerModalComponent } from './plan-picker-modal.component';

function plan(id: string, monthlyPriceUsd: number): Plan {
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    description: '',
    tier: id,
    monthlyPriceUsd,
    supportedBillingCycles: ['Monthly', 'Yearly'],
    pricesUsdByCycle: { Monthly: monthlyPriceUsd, Yearly: monthlyPriceUsd * 10 },
    maxUsers: 5,
    maxPendingInvitations: 5,
    storageQuotaBytes: 0,
    enabledModules: [],
  };
}

describe('PlanPickerModalComponent', () => {
  function create(list: () => unknown) {
    TestBed.configureTestingModule({
      imports: [PlanPickerModalComponent],
      providers: [{ provide: PlansService, useValue: { list: vi.fn(list) } }],
    });
    return TestBed.createComponent(PlanPickerModalComponent).componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('loads the public catalog from cheapest to most expensive and emits the chosen cycle', () => {
    const component = create(() => of([plan('pro', 99), plan('basic', 49)]));
    const chosen = vi.fn();
    component.planChosen.subscribe(chosen);

    component.load();
    component.setCycle('Yearly');
    component.choose(component.plans()[0]);

    expect(component.plans().map(p => p.id)).toEqual(['basic', 'pro']);
    expect(component.yearlyAvailable()).toBe(true);
    expect(chosen).toHaveBeenCalledWith({ plan: component.plans()[0], cycle: 'Yearly' });
  });

  it('shows a friendly message when the catalog is rate limited', () => {
    const component = create(() =>
      throwError(() => new HttpErrorResponse({ status: 429, error: { code: 'RateLimit.Exceeded', retryAfterSeconds: 10 } })),
    );

    component.load();

    expect(component.error()).toBe(RATE_LIMITED_MESSAGE);
    expect(component.loading()).toBe(false);
  });
});
