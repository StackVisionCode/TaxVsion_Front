import { Injectable, computed, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { ClientsService } from '../../clients/data-access/clients.service';
import { CustomerSummary } from '../../clients/data-access/clients.model';

/** Meses que pinta el mini gráfico de altas de clientes. */
const MONTHS_IN_CHART = 6;

/**
 * Cuántos clientes se traen para poder agrupar por mes de alta. `/customers`
 * ordena por `displayName` y NO admite filtro por fecha, así que la única
 * forma de agrupar por mes es traer las filas y contarlas acá. Si el tenant
 * tiene más clientes que esto, el desglose mensual se considera incompleto y
 * NO se pinta (ver {@link DashboardClientsStore.hasFullHistory}).
 */
const FETCH_SIZE = 500;

/** Un mes del mini gráfico: cuántos clientes se dieron de alta. */
export interface MonthlyClientsBucket {
  /** Inicial del mes ("J", "F", …) como en el diseño original. */
  label: string;
  monthStart: Date;
  count: number;
}

/**
 * Estado compartido de clientes para el dashboard (hero + widget "New
 * Clients"). Una sola llamada a `GET /customers` para los dos.
 *
 * No se reutiliza `ClientsStore` a propósito: ese store trae solo los
 * `NotArchived` con `size: 200`, descarta el `totalCount` del backend y su
 * `search` lo maneja la página de clientes — compartirlo haría que el
 * dashboard y la página se pisaran el filtro. Acá se llama al `ClientsService`
 * (root y sin estado) y se guarda lo que el dashboard necesita.
 */
@Injectable({ providedIn: 'root' })
export class DashboardClientsStore {
  private readonly service = inject(ClientsService);

  private readonly _customers = signal<CustomerSummary[]>([]);
  private readonly _totalCount = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private loaded = false;

  readonly customers = this._customers.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Total EXACTO de clientes del tenant (lo cuenta el backend, no la página traída). */
  readonly totalCount = this._totalCount.asReadonly();

  /**
   * ¿Se trajeron todas las filas? Solo entonces el desglose por mes es cierto;
   * si el tenant supera {@link FETCH_SIZE}, contar sobre una página ordenada
   * por nombre daría un gráfico falso.
   */
  readonly hasFullHistory = computed(
    () => this._customers().length >= this._totalCount() && this._totalCount() > 0,
  );

  /** Altas por mes en los últimos {@link MONTHS_IN_CHART} meses. */
  readonly monthlyClients = computed<MonthlyClientsBucket[]>(() => {
    const now = new Date();
    const buckets: MonthlyClientsBucket[] = [];
    for (let offset = MONTHS_IN_CHART - 1; offset >= 0; offset--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      buckets.push({
        label: monthStart.toLocaleString('en-US', { month: 'narrow' }),
        monthStart,
        count: 0,
      });
    }

    for (const customer of this._customers()) {
      const createdAt = new Date(customer.createdAtUtc);
      if (Number.isNaN(createdAt.getTime())) {
        continue;
      }
      const index = buckets.findIndex(
        b =>
          b.monthStart.getFullYear() === createdAt.getFullYear() &&
          b.monthStart.getMonth() === createdAt.getMonth(),
      );
      if (index !== -1) {
        buckets[index].count++;
      }
    }
    return buckets;
  });

  /** Altas del mes en curso. */
  readonly newThisMonth = computed(() => this.monthlyClients()[MONTHS_IN_CHART - 1]?.count ?? 0);

  /**
   * Variación de altas del mes en curso contra el anterior, en %. `null` si el
   * mes anterior fue 0 (no hay base contra la que comparar).
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

  /** Últimas altas, de la más reciente a la más antigua. */
  readonly recentCustomers = computed<CustomerSummary[]>(() =>
    [...this._customers()]
      .sort((a, b) => new Date(b.createdAtUtc).getTime() - new Date(a.createdAtUtc).getTime())
      .slice(0, 3),
  );

  /**
   * GET /customers?status=All. Idempotente: hero y "New Clients" lo llaman en
   * el mismo render sin duplicar la petición.
   */
  load(force = false): void {
    if (this._loading() || (this.loaded && !force)) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this.service.search({ status: 'All', page: 1, size: FETCH_SIZE }).subscribe({
      next: result => {
        this._customers.set(result.items ?? []);
        this._totalCount.set(result.totalCount ?? 0);
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
