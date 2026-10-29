import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { FormInsightsService } from '../../data-access/form-insights.service';
import { insightsSummary, kpis, templateRow } from '../../testing/insights.fixture';
import { FormInsightsComponent } from './form-insights.component';

describe('FormInsightsComponent', () => {
  const service = { summary: vi.fn(), templates: vi.fn() };

  async function render() {
    TestBed.configureTestingModule({
      imports: [FormInsightsComponent],
      providers: [{ provide: FormInsightsService, useValue: service }],
    });
    const fixture = TestBed.createComponent(FormInsightsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  const text = (element: Element) => element.textContent!.replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    vi.clearAllMocks();
    service.summary.mockReturnValue(of(insightsSummary()));
    service.templates.mockReturnValue(
      of({ items: [templateRow()], page: 1, size: 10, totalCount: 1 }),
    );
  });

  it('shows the KPIs with their deltas against the prior period', async () => {
    const { fixture } = await render();
    const component = fixture.componentInstance;

    const primary = component.primaryKpis();
    expect(primary.map((item) => [item.label, item.value])).toEqual([
      ['Requests sent', 10],
      ['Completed', 4],
      ['Completion rate', '40%'],
      ['Median time to submit', '3 h'],
    ]);
    expect(primary[0].delta?.label).toBe('+25% vs prior period');
    expect(primary[2].delta?.sentiment).toBe('negative');
    expect(primary[3].delta?.sentiment).toBe('positive');
    expect(component.secondaryKpis().map((item) => item.value)).toEqual([6, 2, '1.5']);
  });

  it('renders the funnel, automation, failure reasons and template table as text', async () => {
    const { element } = await render();
    const content = text(element);

    expect(content).toContain('80% continued');
    expect(content).toContain('Possible duplicate client');
    expect(content).toContain('Create client');
    expect(content).toContain('50% succeeded · 4 total');
    const row = element.querySelector('section[aria-labelledby="insights-templates"] tbody tr')!;
    const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => text(cell));
    expect(cells).toEqual(['Annual intake', '6', '3', '50%', '1.5 h', '2']);
  });

  it('describes the trend chart for screen readers', async () => {
    const { element } = await render();

    expect(element.querySelector('app-trend-bars [role="img"]')!.getAttribute('aria-label')).toBe(
      'Requests sent and completed per day over the last 30 days: 10 sent, 4 completed. Busiest day: Oct 28 with 7 sent.',
    );
  });

  it('offers the Requests tab when the office has never sent a request', async () => {
    service.summary.mockReturnValue(
      of(
        insightsSummary({
          hasAnyRequests: false,
          current: kpis(),
          previous: kpis(),
          templates: [],
        }),
      ),
    );
    const { fixture, element } = await render();
    const opened = vi.fn();
    fixture.componentInstance.openRequests.subscribe(opened);

    expect(text(element)).toContain('No insights yet');
    expect(element.querySelector('app-stat-cards')).toBeNull();
    const cta = Array.from(element.querySelectorAll('button')).find(
      (button) => text(button) === 'Go to Requests',
    )!;
    cta.click();
    expect(opened).toHaveBeenCalled();
  });

  it('suggests a longer period when nothing was sent in this one', async () => {
    service.summary.mockReturnValue(of(insightsSummary({ current: kpis() })));
    const { fixture, element } = await render();

    const longer = Array.from(element.querySelectorAll('button')).find(
      (button) => text(button) === 'Show the last 90 days',
    )!;
    longer.click();
    await fixture.whenStable();

    expect(service.summary).toHaveBeenLastCalledWith(90, null, expect.any(Number));
  });

  it('shows the error with a retry when the first load fails', async () => {
    service.summary.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 503,
            error: { code: 'X', message: 'Service unavailable' },
          }),
      ),
    );
    const { fixture, element } = await render();
    service.summary.mockReturnValue(of(insightsSummary()));

    expect(text(element)).toContain('Service unavailable');
    const retry = Array.from(element.querySelectorAll('button')).find(
      (button) => text(button) === 'Retry',
    )!;
    retry.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('app-stat-cards')).not.toBeNull();
  });
});
