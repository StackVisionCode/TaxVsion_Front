import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { insightsSummary, templateRow } from '../testing/insights.fixture';
import type { FormInsightsSummary } from './form-insights.model';
import { FormInsightsService } from './form-insights.service';
import { FormInsightsStore } from './form-insights.store';

describe('FormInsightsStore', () => {
  const service = { summary: vi.fn(), templates: vi.fn() };

  function setup(): FormInsightsStore {
    TestBed.configureTestingModule({
      providers: [FormInsightsStore, { provide: FormInsightsService, useValue: service }],
    });
    const store = TestBed.inject(FormInsightsStore);
    store.utcOffset = () => -300;
    return store;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    service.summary.mockReturnValue(of(insightsSummary()));
    service.templates.mockReturnValue(
      of({ items: [templateRow()], page: 1, size: 10, totalCount: 1 }),
    );
  });

  it('loads the summary and the first template page for the last 30 days', async () => {
    const store = setup();

    await store.load();

    expect(service.summary).toHaveBeenCalledWith(30, null, -300);
    expect(service.templates).toHaveBeenCalledWith(30, 1, 10, -300);
    expect(store.summary()?.current.sent).toBe(10);
    expect(store.rows()).toHaveLength(1);
    expect(store.total()).toBe(1);
    expect(store.summaryLoading()).toBe(false);
  });

  it('a new period reloads both the summary and the table from page 1', async () => {
    const store = setup();
    await store.load();
    await store.goToPage(2);

    await store.setPeriod(90);

    expect(store.period()).toBe(90);
    expect(service.summary).toHaveBeenLastCalledWith(90, null, -300);
    expect(service.templates).toHaveBeenLastCalledWith(90, 1, 10, -300);
  });

  it('the template filter only reloads the summary', async () => {
    const store = setup();
    await store.load();
    service.templates.mockClear();

    await store.setTemplate('t-2');
    await store.setTemplate('t-2');
    await store.setTemplate('');

    expect(service.summary).toHaveBeenNthCalledWith(2, 30, 't-2', -300);
    expect(service.summary).toHaveBeenNthCalledWith(3, 30, null, -300);
    expect(service.templates).not.toHaveBeenCalled();
    expect(store.templateId()).toBeNull();
  });

  it('keeps the last numbers and reports the error when a reload fails', async () => {
    const store = setup();
    await store.load();
    service.summary.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 500, error: { code: 'X', message: 'Boom' } }),
      ),
    );

    await store.loadSummary();

    expect(store.summaryError()).toBe('Boom');
    expect(store.summary()?.current.sent).toBe(10);
  });

  it('ignores a slow answer that arrives after a newer one', async () => {
    const store = setup();
    const slow = new Subject<FormInsightsSummary>();
    service.summary.mockReturnValueOnce(slow);
    const first = store.loadSummary();
    service.summary.mockReturnValueOnce(of(insightsSummary({ overdueOpen: 9 })));

    await store.loadSummary();
    slow.next(insightsSummary({ overdueOpen: 1 }));
    slow.complete();
    await first;

    expect(store.summary()?.overdueOpen).toBe(9);
  });

  it('shows the skeleton only before the first answer', async () => {
    const store = setup();
    const pending = new Subject<FormInsightsSummary>();
    service.summary.mockReturnValueOnce(pending);

    const loading = store.loadSummary();
    expect(store.initialLoading()).toBe(true);
    pending.next(insightsSummary());
    pending.complete();
    await loading;

    expect(store.initialLoading()).toBe(false);
  });
});
