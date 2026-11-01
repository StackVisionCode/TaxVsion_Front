import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  FormSelectControlComponent,
  type FormControlOption,
} from '@shared/ui/form-controls/form-select-control.component';
import { FormTextControlComponent } from '@shared/ui/form-controls/form-text-control.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { FormReportsService } from '../../data-access/form-reports.service';
import { FormRequestsService } from '../../data-access/form-requests.service';
import type {
  FormReportAnswerRow,
  FormReportSummaryBucket,
  FormReportableKey,
} from '../../data-access/client-forms.model';

/** El backend pagina las respuestas de a 50 (FormReportAnswersHandler.PageSize). */
const ANSWERS_PAGE_SIZE = 50;

@Component({
  selector: 'app-form-reports',
  imports: [FormSelectControlComponent, FormTextControlComponent, PaginationComponent, StateBlockComponent, DatePipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* Las barras del resumen crecen desde la izquierda al llegar los datos. */
    .bucket-bar {
      transform-origin: left center;
      animation: bucket-grow 520ms cubic-bezier(0.2, 0, 0, 1) both;
    }
    @keyframes bucket-grow {
      from {
        transform: scaleX(0);
      }
      to {
        transform: scaleX(1);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bucket-bar {
        animation: none;
      }
    }
  `,
  template: `
    <div class="mt-5 space-y-5">
      <div class="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label class="block text-sm font-semibold text-gray-700">
            Template
            <app-form-select-control
              class="mt-1 block"
              [value]="templateId()"
              [options]="templateOptions()"
              placeholder="Select a template"
              (valueChange)="selectTemplate($event)"
            />
          </label>
          <label class="block text-sm font-semibold text-gray-700">
            Field
            <app-form-select-control
              class="mt-1 block"
              [value]="key()"
              [options]="keyOptions()"
              [disabled]="!templateId() || keys().length === 0"
              [placeholder]="templateId() && keysLoaded() && keys().length === 0 ? 'No reportable fields' : 'Select a reportable field'"
              (valueChange)="selectKey($event)"
            />
          </label>
          <label class="block text-sm font-semibold text-gray-700">
            @if (valueOptions().length > 0) {
              Value
              <app-form-select-control
                class="mt-1 block"
                data-role="report-value-option"
                [value]="value()"
                [options]="valueOptions()"
                placeholder="Any value"
                (valueChange)="value.set($event)"
              />
            } @else {
              Value contains
              <app-form-text-control
                class="mt-1 block"
                data-role="report-value-contains"
                [value]="value()"
                [disabled]="!key()"
                (valueChange)="value.set($event)"
              />
            }
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="block text-sm font-semibold text-gray-700">
              From
              <app-form-text-control class="mt-1 block" type="date" [value]="from()" (valueChange)="from.set($event)" />
            </label>
            <label class="block text-sm font-semibold text-gray-700">
              To
              <app-form-text-control class="mt-1 block" type="date" [value]="to()" (valueChange)="to.set($event)" />
            </label>
          </div>
        </div>
        @if (templateId() && keysLoaded() && keys().length === 0) {
          <p class="mt-3 text-xs text-gray-500">
            This template has no reportable fields. Mark a choice, yes/no or dropdown field as
            Reportable in the builder to report on it.
          </p>
        }
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-bold px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-ink disabled:opacity-50"
            [disabled]="!canRun() || loading()"
            (click)="run()"
          >
            @if (loading()) {
              <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true"></span>
              Running…
            } @else {
              <ion-icon name="search-outline" class="text-base"></ion-icon>Run report
            }
          </button>
          <button
            type="button"
            class="inline-flex min-h-11 items-center gap-2 rounded-full border border-gray-300 px-5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            [disabled]="!templateId() || exporting()"
            (click)="exportCsv()"
          >
            <ion-icon name="download-outline" class="text-base"></ion-icon>
            {{ exporting() ? 'Preparing…' : 'Export CSV' }}
          </button>
        </div>
      </div>

      @if (error()) {
        <p class="rounded-2xl border border-red-100 bg-red-50 p-3 text-sm text-red-700" role="alert">{{ error() }}</p>
      }

      @if (!hasRun()) {
        <app-state-block
          [empty]="true"
          icon="analytics-outline"
          emptyTitle="Report on your client answers"
          emptyMessage="Pick a template and one of its reportable fields, then run the report."
          minHeight="14rem"
        />
      } @else {
        <div class="grid gap-5 transition-opacity lg:grid-cols-3" [class.opacity-60]="loading()">
          <div class="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm lg:col-span-1">
            <h3 class="text-sm font-bold text-gray-900">Summary</h3>
            <p class="mt-1 text-xs text-gray-500">{{ summaryTotal() }} answered</p>
            @if (buckets().length === 0) {
              <p class="mt-4 text-sm text-gray-500">No answers yet.</p>
            } @else {
              <ul class="mt-4 space-y-3">
                @for (bucket of buckets(); track bucket.value) {
                  <li>
                    <div class="flex items-center justify-between gap-3 text-sm">
                      <span class="truncate text-gray-700">{{ bucket.label || bucket.value }}</span>
                      <span class="shrink-0 text-xs font-semibold text-gray-500">
                        {{ bucket.count }} · {{ share(bucket.count) }}%
                      </span>
                    </div>
                    <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        class="bucket-bar h-full rounded-full bg-brand-bold/70"
                        [style.width.%]="share(bucket.count)"
                      ></div>
                    </div>
                  </li>
                }
              </ul>
            }
          </div>

          <div class="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm lg:col-span-2">
            <div class="border-b border-gray-100 px-5 py-4">
              <h3 class="text-sm font-bold text-gray-900">Results</h3>
              <p class="mt-0.5 text-xs text-gray-500">{{ total() }} {{ total() === 1 ? 'match' : 'matches' }}</p>
            </div>
            @if (rows().length === 0) {
              <p class="px-5 py-10 text-center text-sm text-gray-500">No matching answers.</p>
            } @else {
              <div class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="bg-gray-50/70 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th class="px-5 py-3">Client</th>
                      <th class="px-5 py-3">Form</th>
                      <th class="px-5 py-3">Value</th>
                      <th class="px-5 py-3">Completed</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    @for (row of rows(); track $index) {
                      <tr class="transition-colors hover:bg-gray-50/80">
                        <td class="px-5 py-3 font-medium text-gray-900">{{ row.displayName }}</td>
                        <td class="px-5 py-3 text-gray-700">{{ row.title }}</td>
                        <td class="px-5 py-3 text-gray-700">{{ row.valueLabel || row.valueText }}</td>
                        <td class="px-5 py-3 text-gray-500">{{ row.completedAtUtc | date: 'mediumDate' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <div class="px-5 pb-4">
                <app-pagination
                  [currentPage]="page()"
                  [totalItems]="total()"
                  [pageSize]="pageSize"
                  (pageChange)="loadPage($event)"
                />
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class FormReportsComponent implements OnInit {
  private readonly reports = inject(FormReportsService);
  private readonly requests = inject(FormRequestsService);

  readonly pageSize = ANSWERS_PAGE_SIZE;
  readonly templateId = signal('');
  readonly keys = signal<FormReportableKey[]>([]);
  readonly keysLoaded = signal(false);
  readonly key = signal('');
  readonly value = signal('');
  readonly from = signal('');
  readonly to = signal('');
  readonly rows = signal<FormReportAnswerRow[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly buckets = signal<FormReportSummaryBucket[]>([]);
  readonly summaryTotal = signal(0);
  readonly loading = signal(false);
  readonly exporting = signal(false);
  readonly hasRun = signal(false);
  readonly error = signal<string | null>(null);
  private readonly bucketMax = computed(() => Math.max(1, this.summaryTotal()));

  private readonly templates = signal<FormControlOption[]>([]);

  ngOnInit(): void {
    this.requests.assignableTemplates().subscribe({
      next: (list) =>
        this.templates.set(
          list.map((template) => ({ value: template.templateId, label: template.title || template.name })),
        ),
      error: () => this.error.set('Templates could not be loaded.'),
    });
  }

  templateOptions(): FormControlOption[] {
    return this.templates();
  }

  keyOptions(): FormControlOption[] {
    return this.keys().map((item) => ({ value: item.key, label: item.label }));
  }

  /** Campos de opciones se filtran eligiendo una (valor exacto); los de texto, escribiendo parte del valor. */
  readonly valueOptions = computed<FormControlOption[]>(
    () =>
      this.keys()
        .find((item) => item.key === this.key())
        ?.options?.map((option) => ({ value: option.value, label: option.label })) ?? [],
  );

  canRun(): boolean {
    return this.templateId().length > 0 && this.key().length > 0;
  }

  /** Porcentaje de un bucket sobre el total respondido (para la barra y la etiqueta). */
  share(count: number): number {
    return Math.round((count / this.bucketMax()) * 100);
  }

  selectTemplate(templateId: string): void {
    this.templateId.set(templateId);
    this.key.set('');
    this.value.set('');
    this.keys.set([]);
    this.keysLoaded.set(false);
    this.hasRun.set(false);
    this.error.set(null);
    if (!templateId) return;
    this.reports.keys(templateId).subscribe({
      next: (response) => {
        this.keys.set(response.keys);
        this.keysLoaded.set(true);
      },
      error: () => this.error.set('Reportable fields could not be loaded.'),
    });
  }

  selectKey(key: string): void {
    this.key.set(key);
    // El filtro de un campo no sirve para otro (option1 de una pregunta no es el de otra).
    this.value.set('');
  }

  run(): void {
    if (!this.canRun()) return;
    this.loadPage(1);
    this.reports.summary(this.templateId(), this.key()).subscribe({
      next: (summary) => {
        this.buckets.set(summary.buckets);
        this.summaryTotal.set(summary.total);
      },
      error: () => {
        this.buckets.set([]);
        this.summaryTotal.set(0);
      },
    });
  }

  loadPage(page: number): void {
    if (!this.canRun()) return;
    this.loading.set(true);
    this.error.set(null);
    this.reports
      .answers({
        templateId: this.templateId(),
        key: this.key(),
        ...this.valueFilter(),
        from: this.from() || null,
        to: this.to() || null,
        page,
      })
      .subscribe({
        next: (result) => {
          this.rows.set(result.items);
          this.total.set(result.totalCount);
          this.page.set(page);
          this.hasRun.set(true);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('The report could not be run.');
          this.loading.set(false);
        },
      });
  }

  private valueFilter(): { value: string | null; contains: string | null } {
    const value = this.value().trim() || null;
    return this.valueOptions().length > 0 ? { value, contains: null } : { value: null, contains: value };
  }

  exportCsv(): void {
    if (!this.templateId()) return;
    this.exporting.set(true);
    this.error.set(null);
    this.reports.export(this.templateId(), this.from() || null, this.to() || null).subscribe({
      next: (response) => {
        const blob = response.body;
        if (blob) saveBlob(blob, fileNameFrom(response.headers.get('content-disposition')));
        this.exporting.set(false);
      },
      error: () => {
        this.error.set('The export could not be generated.');
        this.exporting.set(false);
      },
    });
  }
}

/** Nombre del archivo desde Content-Disposition; si no viene, uno genérico. */
function fileNameFrom(header: string | null): string {
  if (header) {
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return 'form report.csv';
}

/** Descarga un blob autenticado con un object URL efímero (mismo patrón que client-imports). */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
