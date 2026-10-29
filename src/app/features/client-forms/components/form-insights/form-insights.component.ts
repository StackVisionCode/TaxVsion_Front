import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnInit,
  computed,
  inject,
  output,
} from '@angular/core';
import {
  FormSelectControlComponent,
  type FormControlOption,
} from '@shared/ui/form-controls/form-select-control.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { SegmentedComponent, type SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { StatCardsComponent, type StatCardItem } from '@shared/ui/stat-cards/stat-cards.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { TooltipDirective } from '@shared/ui/tooltip/tooltip.directive';
import { TrendBarsComponent, type TrendBarSeries } from '@shared/ui/trend-bars/trend-bars.component';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import type { FormInsightsAutomation, FormInsightsPeriod } from '../../data-access/form-insights.model';
import { FormInsightsStore } from '../../data-access/form-insights.store';
import {
  FUNNEL_HINTS,
  FUNNEL_LABELS,
  automationLabel,
  averageDelta,
  countDelta,
  durationDelta,
  failureReasonLabel,
  formatDuration,
  formatRate,
  rateDelta,
  trendLabel,
} from '../../utils/form-insights-format';

/** Segmento de la barra apilada de una automatización. */
interface AutomationSegment {
  label: string;
  count: number;
  barClass: string;
}

interface AutomationView {
  kind: string;
  label: string;
  total: number;
  successRate: string;
  segments: AutomationSegment[];
}

const KPI_INFO = {
  sent: 'Form requests your office sent in the selected period. Intake-link submissions are not included.',
  completed: 'Requests sent in the period that your team has reviewed and marked complete.',
  rate: 'Completed ÷ sent, for requests sent in the period. Recent requests may still be in progress.',
  median: "Middle value of the time between sending a request and the client's first submission.",
  submitted: 'Requests sent in the period that the client submitted at least once.',
  overdue: 'Open requests past their due date right now. Not limited to the selected period.',
  reminders: 'Average number of reminders (automatic and manual) sent per completed request.',
} as const;

const PERIOD_LONG: Readonly<Record<FormInsightsPeriod, string>> = {
  7: 'last 7 days',
  30: 'last 30 days',
  90: 'last 90 days',
};

const RANGE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/**
 * Pestaña Insights de Client Forms: métricas de la oficina sobre las requests que envía. Todo se
 * calcula en el backend (consultas agrupadas); aquí solo se formatea y se compara con el período
 * anterior. Va dentro de un `@defer` en la home: queda en su propio chunk.
 */
@Component({
  selector: 'app-form-insights',
  imports: [
    FormSelectControlComponent,
    PaginationComponent,
    SegmentedComponent,
    SkeletonComponent,
    StatCardsComponent,
    StateBlockComponent,
    TooltipDirective,
    TrendBarsComponent,
  ],
  providers: [FormInsightsStore],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .grow-x {
      transform-origin: left center;
      animation: grow-x 560ms cubic-bezier(0.2, 0, 0, 1) both;
    }
    @keyframes grow-x {
      from { transform: scaleX(0); }
      to { transform: scaleX(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .grow-x { animation: none; }
    }
  `,
  template: `
    @let view = summary();
    <div class="mt-5 space-y-5">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="min-w-0">
          <h2 class="text-lg font-bold text-gray-900">How your forms are doing</h2>
          <p class="mt-0.5 text-sm text-gray-500">{{ periodCaption() }}</p>
        </div>
        <div class="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <label class="sr-only" for="insights-template">Template</label>
          <app-form-select-control
            id="insights-template"
            class="block min-w-0 flex-1 sm:w-60 sm:flex-none"
            placeholder="All templates"
            [value]="store.templateId()"
            [options]="templateOptions()"
            [disabled]="templateOptions().length === 0"
            (valueChange)="store.setTemplate($event)"
          />
          <app-segmented
            mode="radio"
            ariaLabel="Period"
            [options]="periodOptions"
            [value]="store.period()"
            (valueChange)="store.setPeriod($event)"
          />
        </div>
      </div>

      @if (store.initialLoading()) {
        <div class="space-y-5" role="status" aria-label="Loading insights">
          <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
            @for (item of [1, 2, 3, 4]; track item) {
              <app-skeleton variant="block" minHeight="8rem" />
            }
          </div>
          <div class="grid gap-5 lg:grid-cols-5">
            <app-skeleton class="lg:col-span-3" variant="card" [rows]="6" minHeight="20rem" />
            <app-skeleton class="lg:col-span-2" variant="card" [rows]="5" minHeight="20rem" />
          </div>
        </div>
      } @else if (!view && store.summaryError()) {
        <app-state-block [error]="store.summaryError()" minHeight="16rem" (retry)="store.loadSummary()" />
      } @else if (view) {
        @if (!view.hasAnyRequests) {
          <div class="flex flex-col items-center rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-6 py-14 text-center">
            <span class="grid h-14 w-14 place-items-center rounded-2xl bg-white text-brand-bold shadow-sm ring-1 ring-gray-100">
              <ion-icon name="stats-chart-outline" class="text-2xl" aria-hidden="true"></ion-icon>
            </span>
            <h3 class="mt-4 text-base font-bold text-gray-900">No insights yet</h3>
            <p class="mt-1 max-w-md text-sm text-gray-500">
              Insights appear once your office sends its first form request. You'll see how many clients
              start, submit and finish their forms, how long it takes, and where automations need attention.
            </p>
            <button
              type="button"
              class="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-bold px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-ink"
              (click)="openRequests.emit()"
            >
              <ion-icon name="paper-plane-outline" class="text-base" aria-hidden="true"></ion-icon>Go to Requests
            </button>
          </div>
        } @else {
          <div class="space-y-5 transition-opacity" [class.opacity-60]="store.summaryLoading()"
            [attr.aria-busy]="store.summaryLoading()">
            @if (store.summaryError()) {
              <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                <span>{{ store.summaryError() }} Showing the last loaded numbers.</span>
                <button type="button" class="font-semibold underline-offset-2 hover:underline" (click)="store.loadSummary()">Retry</button>
              </div>
            }
            @if (view.current.sent === 0) {
              <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900" role="status">
                <span class="inline-flex items-center gap-2">
                  <ion-icon name="information-circle-outline" class="text-base" aria-hidden="true"></ion-icon>
                  No requests were sent in the {{ periodLong() }}{{ store.templateId() ? ' for this template' : '' }}.
                </span>
                @if (store.period() !== 90) {
                  <button type="button" class="font-semibold underline-offset-2 hover:underline" (click)="store.setPeriod(90)">
                    Show the last 90 days
                  </button>
                }
              </div>
            }

            <!-- app-stat-cards es inline: el gap del flex separa las dos filas. -->
            <div class="flex flex-col gap-4">
              <app-stat-cards [items]="primaryKpis()" />
              <app-stat-cards [items]="secondaryKpis()" />
            </div>

            <div class="grid gap-5 lg:grid-cols-5">
              <section class="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm lg:col-span-3" aria-labelledby="insights-trend">
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 id="insights-trend" class="text-sm font-bold text-gray-900">Sent vs completed</h3>
                  <p class="text-xs text-gray-500">{{ view.period.granularity === 'Week' ? 'Per week' : 'Per day' }} · your local time</p>
                </div>
                <app-trend-bars
                  class="mt-3"
                  [labels]="trendLabels()"
                  [series]="trendSeries()"
                  [ariaLabel]="trendSummary()"
                  [periodHeader]="view.period.granularity === 'Week' ? 'Week' : 'Day'"
                />
              </section>

              <section class="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm lg:col-span-2" aria-labelledby="insights-funnel">
                <h3 id="insights-funnel" class="text-sm font-bold text-gray-900">Request funnel</h3>
                <p class="mt-0.5 text-xs text-gray-500">Requests sent in the period and how far they got.</p>
                <ol class="mt-4 space-y-4">
                  @for (step of funnel(); track step.key; let first = $first) {
                    <li>
                      @if (!first) {
                        <p class="-mt-2 mb-2 flex items-center gap-1 text-xs font-medium text-gray-500">
                          <ion-icon name="arrow-down-outline" class="text-xs" aria-hidden="true"></ion-icon>
                          {{ step.conversion }} continued
                        </p>
                      }
                      <div class="flex items-baseline justify-between gap-3 text-sm">
                        <span class="inline-flex items-center gap-1 font-semibold text-gray-800">
                          {{ step.label }}
                          <button type="button" class="grid h-6 w-6 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                            [appTooltip]="step.hint" [attr.aria-label]="'About ' + step.label">
                            <ion-icon name="information-circle-outline" class="text-sm" aria-hidden="true"></ion-icon>
                          </button>
                          <span class="sr-only">{{ step.hint }}</span>
                        </span>
                        <span class="font-bold tabular-nums text-gray-900">{{ step.count }}</span>
                      </div>
                      <div class="mt-1.5 h-2.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                        <div class="grow-x h-full rounded-full bg-brand-bold" [style.width.%]="step.share"
                          [style.opacity]="step.opacity"></div>
                      </div>
                    </li>
                  }
                </ol>
              </section>
            </div>

            <div class="grid gap-5 lg:grid-cols-5">
              <section class="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm lg:col-span-3" aria-labelledby="insights-automation">
                <h3 id="insights-automation" class="text-sm font-bold text-gray-900">Automation health</h3>
                <p class="mt-0.5 text-xs text-gray-500">What ran after submissions in the period (latest attempt of each).</p>
                <ul class="mt-4 space-y-4">
                  @for (row of automation(); track row.kind) {
                    <li>
                      <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <span class="font-semibold text-gray-800">{{ row.label }}</span>
                        <span class="text-xs text-gray-500">
                          @if (row.total === 0) { No runs } @else { {{ row.successRate }} succeeded · {{ row.total }} total }
                        </span>
                      </div>
                      @if (row.total > 0) {
                        <div class="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                          @for (segment of row.segments; track segment.label) {
                            <div class="grow-x h-full" [class]="segment.barClass" [style.width.%]="(segment.count / row.total) * 100"></div>
                          }
                        </div>
                        <p class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
                          @for (segment of row.segments; track segment.label) {
                            <span class="inline-flex items-center gap-1">
                              <span class="h-2 w-2 rounded-full" [class]="segment.barClass" aria-hidden="true"></span>
                              <span class="font-semibold tabular-nums text-gray-800">{{ segment.count }}</span> {{ segment.label }}
                            </span>
                          }
                        </p>
                      }
                    </li>
                  }
                </ul>
                <div class="mt-5 border-t border-gray-100 pt-4">
                  <h4 class="text-xs font-bold uppercase tracking-wide text-gray-500">Top failure reasons</h4>
                  @if (failureReasons().length === 0) {
                    <p class="mt-2 inline-flex items-center gap-1.5 text-sm text-emerald-700">
                      <ion-icon name="checkmark-circle-outline" class="text-base" aria-hidden="true"></ion-icon>
                      No failures in this period.
                    </p>
                  } @else {
                    <ol class="mt-2 divide-y divide-gray-100">
                      @for (reason of failureReasons(); track reason.key) {
                        <li class="flex items-center justify-between gap-3 py-2 text-sm">
                          <span class="min-w-0">
                            <span class="block truncate font-medium text-gray-800">{{ reason.label }}</span>
                            <span class="block text-xs text-gray-500">{{ reason.kind }}</span>
                          </span>
                          <span class="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-700">{{ reason.count }}</span>
                        </li>
                      }
                    </ol>
                  }
                </div>
              </section>

              <div class="space-y-5 lg:col-span-2">
                <section class="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm" aria-labelledby="insights-signatures">
                  <div class="flex items-baseline justify-between gap-2">
                    <h3 id="insights-signatures" class="text-sm font-bold text-gray-900">Signatures</h3>
                    @if (view.signatures.requested > 0) {
                      <span class="text-xs text-gray-500">{{ signedRate() }} signed</span>
                    }
                  </div>
                  @if (view.signatures.requested === 0) {
                    <p class="mt-2 text-sm text-gray-500">No signatures were requested in this period.</p>
                  } @else {
                    <dl class="mt-3 grid grid-cols-3 gap-2">
                      @for (item of signatureStats(); track item.label) {
                        <div class="rounded-xl bg-gray-50 px-3 py-2">
                          <dt class="text-xs text-gray-500">{{ item.label }}</dt>
                          <dd class="text-lg font-bold tabular-nums text-gray-900">{{ item.value }}</dd>
                        </div>
                      }
                    </dl>
                  }
                </section>

                <section class="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm" aria-labelledby="insights-split">
                  <h3 id="insights-split" class="text-sm font-bold text-gray-900">Clients vs external</h3>
                  <ul class="mt-3 space-y-3">
                    @for (item of split(); track item.label) {
                      <li>
                        <div class="flex items-baseline justify-between gap-2 text-sm">
                          <span class="font-medium text-gray-800">{{ item.label }}</span>
                          <span class="text-xs text-gray-500">
                            <span class="font-semibold tabular-nums text-gray-800">{{ item.completed }}</span> of
                            <span class="font-semibold tabular-nums text-gray-800">{{ item.sent }}</span> completed · {{ item.rate }}
                          </span>
                        </div>
                        <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                          <div class="grow-x h-full rounded-full bg-sage-500" [style.width.%]="item.share"></div>
                        </div>
                      </li>
                    }
                  </ul>
                </section>
              </div>
            </div>
          </div>

          <section class="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm" aria-labelledby="insights-templates">
            <div class="border-b border-gray-100 px-5 py-4">
              <h3 id="insights-templates" class="text-sm font-bold text-gray-900">By template</h3>
              <p class="mt-0.5 text-xs text-gray-500">Requests sent in the {{ periodLong() }}, busiest first. Not affected by the template filter.</p>
            </div>
            @if (store.rows().length === 0 || store.templatesError()) {
              <div class="p-5">
                <app-state-block
                  variant="inline"
                  [loading]="store.templatesLoading() && store.rows().length === 0"
                  loadingText="Loading templates…"
                  [error]="store.templatesError()"
                  [empty]="store.rows().length === 0"
                  icon="document-text-outline"
                  emptyTitle="No requests were sent in this period"
                  (retry)="store.loadTemplates()"
                />
              </div>
            } @else {
              <div class="overflow-x-auto transition-opacity" [class.opacity-60]="store.templatesLoading()">
                <table class="w-full min-w-[40rem] text-left text-sm">
                  <thead class="bg-gray-50/70 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th scope="col" class="px-5 py-3">Template</th>
                      <th scope="col" class="px-5 py-3 text-right">Sent</th>
                      <th scope="col" class="px-5 py-3 text-right">Completed</th>
                      <th scope="col" class="px-5 py-3">Completion</th>
                      <th scope="col" class="px-5 py-3 text-right">
                        <span class="inline-flex items-center gap-1">
                          Time to submit
                          <button type="button" class="grid h-5 w-5 place-items-center rounded-full normal-case text-gray-400 hover:bg-gray-200/60 hover:text-gray-600"
                            [appTooltip]="medianInfo" aria-label="About time to submit">
                            <ion-icon name="information-circle-outline" class="text-sm" aria-hidden="true"></ion-icon>
                          </button>
                        </span>
                      </th>
                      <th scope="col" class="px-5 py-3 text-right">
                        <span class="inline-flex items-center gap-1">
                          Returns
                          <button type="button" class="grid h-5 w-5 place-items-center rounded-full normal-case text-gray-400 hover:bg-gray-200/60 hover:text-gray-600"
                            [appTooltip]="returnsInfo" aria-label="About returns">
                            <ion-icon name="information-circle-outline" class="text-sm" aria-hidden="true"></ion-icon>
                          </button>
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    @for (row of store.rows(); track row.templateId) {
                      <tr class="transition-colors hover:bg-gray-50/80">
                        <th scope="row" class="max-w-[16rem] truncate px-5 py-3 font-medium text-gray-900">{{ row.name }}</th>
                        <td class="px-5 py-3 text-right tabular-nums text-gray-700">{{ row.sent }}</td>
                        <td class="px-5 py-3 text-right tabular-nums text-gray-700">{{ row.completed }}</td>
                        <td class="px-5 py-3">
                          <div class="flex items-center gap-2">
                            <div class="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                              <div class="h-full rounded-full bg-brand-bold" [style.width.%]="(row.completionRate ?? 0) * 100"></div>
                            </div>
                            <span class="tabular-nums text-gray-700">{{ formatRate(row.completionRate) }}</span>
                          </div>
                        </td>
                        <td class="px-5 py-3 text-right tabular-nums text-gray-700">{{ formatDuration(row.medianMinutesToFirstSubmission) }}</td>
                        <td class="px-5 py-3 text-right tabular-nums text-gray-700">{{ row.returns }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <div class="px-5 pb-4">
                <app-pagination
                  [currentPage]="store.page()"
                  [totalItems]="store.total()"
                  [pageSize]="store.pageSize"
                  (pageChange)="store.goToPage($event)"
                />
              </div>
            }
          </section>
        }
      }
    </div>
  `,
})
export class FormInsightsComponent implements OnInit {
  readonly store = inject(FormInsightsStore);
  /** El estado vacío ofrece ir a la bandeja para enviar la primera request. */
  readonly openRequests = output<void>();

  readonly formatRate = formatRate;
  readonly formatDuration = formatDuration;
  readonly medianInfo = KPI_INFO.median;
  readonly returnsInfo = 'How many times your team used Request changes on these requests.';
  readonly periodOptions: readonly SegmentedOption<FormInsightsPeriod>[] = [
    { id: 7, label: '7 days' },
    { id: 30, label: '30 days' },
    { id: 90, label: '90 days' },
  ];

  readonly summary = this.store.summary;

  readonly periodLong = computed(() => PERIOD_LONG[this.store.period()]);

  readonly periodCaption = computed(() => {
    const period = this.summary()?.period;
    if (!period) return `Your office's form requests over the ${this.periodLong()}.`;
    const from = RANGE_FORMAT.format(parseUtcDate(period.fromUtc));
    const to = RANGE_FORMAT.format(parseUtcDate(period.toUtc));
    return `${from} – ${to} · compared with the previous ${period.days} days`;
  });

  readonly templateOptions = computed<FormControlOption[]>(() =>
    (this.summary()?.templates ?? []).map((item) => ({ value: item.templateId, label: item.name })),
  );

  readonly primaryKpis = computed<StatCardItem[]>(() => {
    const summary = this.summary();
    if (!summary) return [];
    const { current, previous } = summary;
    return [
      {
        label: 'Requests sent',
        value: current.sent,
        tone: 'sky',
        icon: 'paper-plane-outline',
        info: KPI_INFO.sent,
        delta: countDelta(current.sent, previous.sent),
        hint: current.cancelled > 0 ? `${current.cancelled} cancelled` : null,
      },
      {
        label: 'Completed',
        value: current.completed,
        tone: 'sage',
        icon: 'checkmark-done-outline',
        info: KPI_INFO.completed,
        delta: countDelta(current.completed, previous.completed),
      },
      {
        label: 'Completion rate',
        value: formatRate(current.completionRate),
        tone: 'navy',
        icon: 'analytics-outline',
        info: KPI_INFO.rate,
        delta: rateDelta(current.completionRate, previous.completionRate),
        hint: current.sent > 0 ? `${current.completed} of ${current.sent} requests` : null,
      },
      {
        label: 'Median time to submit',
        value: formatDuration(current.medianMinutesToFirstSubmission),
        tone: 'sand',
        icon: 'time-outline',
        info: KPI_INFO.median,
        delta: durationDelta(current.medianMinutesToFirstSubmission, previous.medianMinutesToFirstSubmission),
        hint: 'From sent to first submission',
      },
    ];
  });

  readonly secondaryKpis = computed<StatCardItem[]>(() => {
    const summary = this.summary();
    if (!summary) return [];
    const { current, previous } = summary;
    return [
      {
        label: 'Submitted',
        value: current.submitted,
        tone: 'white',
        icon: 'checkmark-circle-outline',
        info: KPI_INFO.submitted,
        delta: countDelta(current.submitted, previous.submitted),
        hint: `${current.started} started`,
      },
      {
        label: 'Overdue now',
        value: summary.overdueOpen,
        tone: 'white',
        icon: 'alarm-outline',
        info: KPI_INFO.overdue,
        hint: summary.overdueOpen > 0 ? 'Open and past their due date' : 'Nothing past due',
      },
      {
        label: 'Avg. reminders per completed',
        value:
          current.averageRemindersPerCompleted === null ? null : current.averageRemindersPerCompleted.toFixed(1),
        tone: 'white',
        icon: 'repeat-outline',
        info: KPI_INFO.reminders,
        delta: averageDelta(current.averageRemindersPerCompleted, previous.averageRemindersPerCompleted),
      },
    ];
  });

  readonly trendLabels = computed(() => {
    const summary = this.summary();
    return summary ? summary.trend.map((point) => trendLabel(point.start, summary.period.granularity)) : [];
  });

  readonly trendSeries = computed<TrendBarSeries[]>(() => {
    const trend = this.summary()?.trend ?? [];
    return [
      { name: 'Sent', values: trend.map((point) => point.sent), tone: 'striped' },
      { name: 'Completed', values: trend.map((point) => point.completed), tone: 'solid' },
    ];
  });

  /** Resumen en texto del gráfico para lectores de pantalla. */
  readonly trendSummary = computed(() => {
    const summary = this.summary();
    if (!summary) return 'Sent vs completed';
    const unit = summary.period.granularity === 'Week' ? 'week' : 'day';
    const sent = summary.trend.reduce((sum, point) => sum + point.sent, 0);
    const completed = summary.trend.reduce((sum, point) => sum + point.completed, 0);
    const labels = this.trendLabels();
    const busiest = summary.trend.reduce(
      (best, point, index) => (point.sent > best.sent ? { sent: point.sent, index } : best),
      { sent: 0, index: -1 },
    );
    const peak = busiest.index >= 0 ? ` Busiest ${unit}: ${labels[busiest.index]} with ${busiest.sent} sent.` : '';
    return `Requests sent and completed per ${unit} over the ${this.periodLong()}: ${sent} sent, ${completed} completed.${peak}`;
  });

  readonly funnel = computed(() => {
    const steps = this.summary()?.funnel ?? [];
    const top = Math.max(1, steps[0]?.count ?? 0);
    return steps.map((step, index) => ({
      key: step.key,
      label: FUNNEL_LABELS[step.key] ?? step.key,
      hint: FUNNEL_HINTS[step.key] ?? '',
      count: step.count,
      conversion: formatRate(step.conversionFromPrevious),
      share: (step.count / top) * 100,
      // Cada paso un poco más intenso: se lee como embudo sin depender solo del color.
      opacity: 0.45 + (index / Math.max(1, steps.length - 1)) * 0.55,
    }));
  });

  readonly automation = computed<AutomationView[]>(() =>
    (this.summary()?.automation ?? []).map((row) => this.automationView(row)),
  );

  readonly failureReasons = computed(() =>
    (this.summary()?.topFailureReasons ?? []).map((reason) => ({
      key: `${reason.kind}:${reason.code}`,
      label: failureReasonLabel(reason.code),
      kind: automationLabel(reason.kind),
      count: reason.count,
    })),
  );

  readonly signedRate = computed(() => {
    const signatures = this.summary()?.signatures;
    return signatures && signatures.requested > 0 ? formatRate(signatures.signed / signatures.requested) : '—';
  });

  readonly signatureStats = computed(() => {
    const signatures = this.summary()?.signatures;
    if (!signatures) return [];
    return [
      { label: 'Requested', value: signatures.requested },
      { label: 'Signed', value: signatures.signed },
      { label: 'Waiting', value: signatures.pending },
      { label: 'Declined', value: signatures.declined },
      { label: 'Expired', value: signatures.expired + signatures.canceled },
      { label: 'Failed', value: signatures.failed },
    ];
  });

  readonly split = computed(() =>
    (this.summary()?.participantSplit ?? []).map((item) => ({
      label: item.kind === 'Customer' ? 'Clients (portal)' : 'External (email link)',
      sent: item.sent,
      completed: item.completed,
      rate: formatRate(item.sent > 0 ? item.completed / item.sent : null),
      share: item.sent > 0 ? (item.completed / item.sent) * 100 : 0,
    })),
  );

  ngOnInit(): void {
    void this.store.load();
  }

  private automationView(row: FormInsightsAutomation): AutomationView {
    const segments: AutomationSegment[] = [
      { label: 'succeeded', count: row.succeeded, barClass: 'bg-emerald-500' },
      { label: 'failed', count: row.failed, barClass: 'bg-red-500' },
      { label: 'rejected', count: row.rejected, barClass: 'bg-amber-400' },
      { label: 'in progress', count: row.pending, barClass: 'bg-sky-400' },
      { label: 'skipped', count: row.skipped, barClass: 'bg-gray-300' },
    ].filter((segment) => segment.count > 0);
    const total = row.succeeded + row.failed + row.rejected + row.pending + row.skipped;
    // Lo omitido no cuenta para el éxito: no se intentó.
    const attempted = total - row.skipped;
    return {
      kind: row.kind,
      label: automationLabel(row.kind),
      total,
      successRate: formatRate(attempted > 0 ? row.succeeded / attempted : null),
      segments,
    };
  }
}
