import { Injectable, computed, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { firstValueFrom } from 'rxjs';
import { browserUtcOffsetMinutes } from '../utils/form-insights-format';
import type {
  FormInsightsPeriod,
  FormInsightsSummary,
  FormInsightsTemplateRow,
} from './form-insights.model';
import { FormInsightsService } from './form-insights.service';

export const INSIGHTS_TEMPLATES_PAGE_SIZE = 10;
export const INSIGHTS_DEFAULT_PERIOD: FormInsightsPeriod = 30;

/**
 * Estado de la pestaña Insights: resumen (KPIs, embudo, serie, automatizaciones) y la tabla por
 * plantilla, que se pagina aparte. El filtro de plantilla solo afecta al resumen; el período, a ambos.
 * Cada carga descarta las respuestas viejas (cambios rápidos de período).
 */
@Injectable()
export class FormInsightsStore {
  private readonly service = inject(FormInsightsService);
  /** Se inyecta para poder fijarlo en los tests. */
  utcOffset: () => number = browserUtcOffsetMinutes;
  private summarySeq = 0;
  private templatesSeq = 0;

  private readonly _period = signal<FormInsightsPeriod>(INSIGHTS_DEFAULT_PERIOD);
  private readonly _templateId = signal<string | null>(null);
  private readonly _summary = signal<FormInsightsSummary | null>(null);
  private readonly _summaryLoading = signal(false);
  private readonly _summaryError = signal<string | null>(null);
  private readonly _rows = signal<FormInsightsTemplateRow[]>([]);
  private readonly _total = signal(0);
  private readonly _page = signal(1);
  private readonly _templatesLoading = signal(false);
  private readonly _templatesError = signal<string | null>(null);

  readonly period = this._period.asReadonly();
  readonly templateId = this._templateId.asReadonly();
  readonly summary = this._summary.asReadonly();
  readonly summaryLoading = this._summaryLoading.asReadonly();
  readonly summaryError = this._summaryError.asReadonly();
  readonly rows = this._rows.asReadonly();
  readonly total = this._total.asReadonly();
  readonly page = this._page.asReadonly();
  readonly templatesLoading = this._templatesLoading.asReadonly();
  readonly templatesError = this._templatesError.asReadonly();
  readonly pageSize = INSIGHTS_TEMPLATES_PAGE_SIZE;

  /** Primera carga sin datos todavía: se muestra el skeleton; las siguientes atenúan lo que hay. */
  readonly initialLoading = computed(() => this._summaryLoading() && this._summary() === null);

  async load(): Promise<void> {
    await Promise.all([this.loadSummary(), this.loadTemplates(1)]);
  }

  async setPeriod(period: FormInsightsPeriod): Promise<void> {
    if (period === this._period()) return;
    this._period.set(period);
    await this.load();
  }

  async setTemplate(templateId: string | null): Promise<void> {
    const next = templateId || null;
    if (next === this._templateId()) return;
    this._templateId.set(next);
    await this.loadSummary();
  }

  goToPage(page: number): Promise<void> {
    return this.loadTemplates(page);
  }

  async loadSummary(): Promise<void> {
    const seq = ++this.summarySeq;
    this._summaryLoading.set(true);
    this._summaryError.set(null);
    try {
      const summary = await firstValueFrom(
        this.service.summary(this._period(), this._templateId(), this.utcOffset()),
      );
      if (seq !== this.summarySeq) return;
      this._summary.set(summary);
    } catch (error) {
      if (seq !== this.summarySeq) return;
      this._summaryError.set(toApiError(error).message || 'Insights could not be loaded.');
    } finally {
      if (seq === this.summarySeq) this._summaryLoading.set(false);
    }
  }

  async loadTemplates(page = this._page()): Promise<void> {
    const seq = ++this.templatesSeq;
    this._templatesLoading.set(true);
    this._templatesError.set(null);
    try {
      const result = await firstValueFrom(
        this.service.templates(this._period(), page, this.pageSize, this.utcOffset()),
      );
      if (seq !== this.templatesSeq) return;
      this._rows.set(result.items ?? []);
      this._total.set(result.totalCount ?? 0);
      this._page.set(result.page ?? page);
    } catch (error) {
      if (seq !== this.templatesSeq) return;
      this._templatesError.set(toApiError(error).message || 'Templates could not be loaded.');
    } finally {
      if (seq === this.templatesSeq) this._templatesLoading.set(false);
    }
  }
}
