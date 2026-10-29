import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { FormReportsService } from '../../data-access/form-reports.service';
import { FormRequestsService } from '../../data-access/form-requests.service';
import type {
  FormReportAnswersFilters,
  FormReportKeysResponse,
  FormReportSummaryResponse,
  PagedResult,
  FormReportAnswerRow,
} from '../../data-access/client-forms.model';
import { FormReportsComponent } from './form-reports.component';

describe('FormReportsComponent', () => {
  const keys = vi.fn();
  const answers = vi.fn();
  const summary = vi.fn();
  const exportCsv = vi.fn();
  const assignableTemplates = vi.fn();

  function build(): FormReportsComponent {
    keys.mockReturnValue(
      of<FormReportKeysResponse>({
        templateId: 't1',
        keys: [{ key: 'crypto', label: 'Owned crypto', type: 'yesNo', repeatable: false }],
      }),
    );
    answers.mockReturnValue(
      of<PagedResult<FormReportAnswerRow>>({
        items: [
          {
            formRequestId: 'r1',
            customerId: 'c1',
            participantId: null,
            displayName: 'Ada Lovelace',
            title: '2026 Intake',
            revisionNumber: 1,
            completedAtUtc: '2026-04-15T10:00:00Z',
            key: 'crypto',
            rowIndex: null,
            valueText: 'Yes',
            valueNumber: null,
            valueDate: null,
          },
        ],
        page: 1,
        size: 50,
        totalCount: 1,
      }),
    );
    summary.mockReturnValue(
      of<FormReportSummaryResponse>({
        templateId: 't1',
        key: 'crypto',
        total: 3,
        buckets: [
          { value: 'Yes', count: 2 },
          { value: 'No', count: 1 },
        ],
      }),
    );
    assignableTemplates.mockReturnValue(
      of([{ templateId: 't1', name: 'Intake', purpose: 'clientIntake', latestVersionNumber: 1, title: '2026 Intake' }]),
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: FormReportsService, useValue: { keys, answers, summary, export: exportCsv } },
        { provide: FormRequestsService, useValue: { assignableTemplates } },
      ],
    });
    return TestBed.runInInjectionContext(() => new FormReportsComponent());
  }

  it('loads reportable keys when a template is picked', () => {
    const component = build();
    component.ngOnInit();

    component.selectTemplate('t1');

    expect(keys).toHaveBeenCalledWith('t1');
    expect(component.keyOptions()).toEqual([{ value: 'crypto', label: 'Owned crypto' }]);
    expect(component.canRun()).toBe(false);
  });

  it('runs the report and fills results and summary', () => {
    const component = build();
    component.selectTemplate('t1');
    component.selectKey('crypto');
    component.value.set('Yes');

    component.run();

    const filters = answers.mock.calls[0][0] as FormReportAnswersFilters;
    expect(filters).toMatchObject({ templateId: 't1', key: 'crypto', value: 'Yes', page: 1 });
    expect(summary).toHaveBeenCalledWith('t1', 'crypto');
    expect(component.rows().length).toBe(1);
    expect(component.total()).toBe(1);
    expect(component.summaryTotal()).toBe(3);
    expect(component.buckets()[0]).toEqual({ value: 'Yes', count: 2 });
    expect(component.hasRun()).toBe(true);
  });

  it('pages through results without re-running the summary', () => {
    const component = build();
    component.selectTemplate('t1');
    component.selectKey('crypto');
    component.run();
    summary.mockClear();

    component.loadPage(2);

    const filters = answers.mock.calls.at(-1)![0] as FormReportAnswersFilters;
    expect(filters).toMatchObject({ templateId: 't1', key: 'crypto', page: 2 });
    expect(component.page()).toBe(2);
    expect(summary).not.toHaveBeenCalled();
  });

  it('shows each bucket as a share of the answered total', () => {
    const component = build();
    component.selectTemplate('t1');
    component.selectKey('crypto');
    component.run();

    expect(component.share(2)).toBe(67);
    expect(component.share(1)).toBe(33);
  });

  it('exports the CSV and saves the file from the Content-Disposition name', () => {
    const component = build();
    component.selectTemplate('t1');
    const headers = { get: (_: string) => 'attachment; filename="2026 Intake report.csv"' };
    exportCsv.mockReturnValue(of({ body: new Blob(['x']), headers }));
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    component.exportCsv();

    expect(exportCsv).toHaveBeenCalledWith('t1', null, null);
    expect(createUrl).toHaveBeenCalled();
    expect(component.exporting()).toBe(false);
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    click.mockRestore();
  });
});
