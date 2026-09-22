import { Injectable, computed, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { CustomerDirectoryService } from '@core/customers/customer-directory.service';
import { CustomerSummary, MonthlyNewCustomers } from '@core/customers/customer-summary.model';

/** Meses que pinta el mini gráfico de altas de clientes. */
const MONTHS_IN_CHART = 6;

/** Un mes del mini gráfico: cuántos clientes se dieron de alta. */
export interface MonthlyClientsBucket {
  /** Inicial del mes ("J", "F", …) como en el diseño original. */
  label: string;
  monthStart: Date;
  count: number;
}

/**
 * Estado de clientes para el dashboard (hero + widget "New Clients"). Una sola llamada a
 * `GET /customers/overview`: el backend agrega el total exacto, las altas por mes y las últimas
 * altas, así que el front ya NO trae cientos de filas para contarlas en el cliente (backlog 5.1).
 */
@Injectable({ providedIn: 'root' })
export class DashboardClientsStore {
  private readonly directory = inject(CustomerDirectoryService);

  private readonly _totalCount = signal(0);
  private readonly _monthly = signal<MonthlyNewCustomers[]>([]);
  private readonly _recent = signal<CustomerSummary[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private loaded = false;

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Total EXACTO de clientes del tenant (lo cuenta el backend). */
  readonly totalCount = this._totalCount.asReadonly();

  /** El backend agrega con conteos exactos, así que el desglose por mes siempre es fiel. */
  readonly hasFullHistory = computed(() => true);

  /** Altas por mes en los últimos {@link MONTHS_IN_CHART} meses (rellena con 0 los que faltan). */
  readonly monthlyClients = computed<MonthlyClientsBucket[]>(() => {
    const now = new Date();
    const byKey = new Map(this._monthly().map(m => [`${m.year}-${m.month}`, m.count]));
    const buckets: MonthlyClientsBucket[] = [];
    for (let offset = MONTHS_IN_CHART - 1; offset >= 0; offset--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      // El backend numera los meses 1..12; getMonth() es 0..11.
      const count = byKey.get(`${monthStart.getFullYear()}-${monthStart.getMonth() + 1}`) ?? 0;
      buckets.push({
        label: monthStart.toLocaleString('en-US', { month: 'narrow' }),
        monthStart,
        count,
      });
    }
    return buckets;
  });

  /** Altas del mes en curso. */
  readonly newThisMonth = computed(() => this.monthlyClients()[MONTHS_IN_CHART - 1]?.count ?? 0);

  /**
   * Variación de altas del mes en curso contra el anterior, en %. `null` si el mes anterior fue 0
   * (no hay base contra la que comparar).
   */
  readonly monthOverMonthPercent = computed<number | null>(() => {
    const months = this.monthlyClients();
    const previous = months[MONTHS_IN_CHART - 2]?.count ?? 0;
    const current = months[MONTHS_IN_CHART - 1]?.count ?? 0;
    if (previous <= 0) {
      return null;
    }
    return Math.round(((current - previous) / previous) * 100);
  });

  /** Últimas altas, de la más reciente a la más antigua (ya ordenadas por el backend). */
  readonly recentCustomers = computed<CustomerSummary[]>(() => this._recent());

  /** Idempotente: hero y "New Clients" lo llaman en el mismo render sin duplicar la petición. */
  load(force = false): void {
    if (this._loading() || (this.loaded && !force)) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this.directory.overview(MONTHS_IN_CHART).subscribe({
      next: result => {
        this._totalCount.set(result.totalCount);
        this._monthly.set(result.monthly ?? []);
        this._recent.set(result.recent ?? []);
        this.loaded = true;
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }
}
