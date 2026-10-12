import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { TaskStore } from '../../../task/data-access/task.store';
import { DeadlineRow, DeadlineTone, upcomingDeadlines } from '../../utils/dashboard-insights.util';

const MAX_ROWS = 6;
const HORIZON_DAYS = 30;
const CUSTOMERS: AccessRequirement = { module: 'customers', anyOf: ['customers.view'] };

const CHIP_CLASSES: Record<DeadlineTone, string> = {
  overdue: 'bg-red-50 text-red-600',
  soon: 'bg-sand-100 text-sand-700',
  later: 'bg-gray-100 text-gray-600',
};

/**
 * Widget "Filing deadlines": tareas con vencimiento ESTATUTARIO (`dueIsStatutory`) en los próximos 30
 * días, con cuenta regresiva — el patrón de deadlines de TaxDome/Karbon para una oficina de impuestos.
 *
 * Antes ocupaba este lugar "Performance Analytics" con un estado vacío (ningún servicio expone
 * métricas de procesos). Los vencimientos sí son reales: es la única noción de "deadline de
 * presentación" que existe hoy en la plataforma. Salen del tablero de tareas abiertas (máx. 500).
 */
@Component({
  selector: 'app-dashboard-filing-deadlines',
  imports: [CommonModule, RouterLink, StateBlockComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-filing-deadlines.component.html',
})
export class DashboardFilingDeadlinesComponent implements OnInit {
  private readonly store = inject(TaskStore);
  private readonly access = inject(AccessStore);

  readonly loading = this.store.loading;
  readonly error = this.store.error;
  readonly filtered = this.store.isSearching;
  readonly canOpenClients = this.access.canUse(CUSTOMERS);

  private readonly deadlines = computed(() => upcomingDeadlines(this.store.tasks(), new Date(), HORIZON_DAYS));
  readonly rows = computed(() => this.deadlines().slice(0, MAX_ROWS));
  readonly hiddenCount = computed(() => Math.max(0, this.deadlines().length - MAX_ROWS));

  ngOnInit(): void {
    this.store.init();
  }

  retry(): void {
    this.store.refresh();
  }

  chipClass(row: DeadlineRow): string {
    return CHIP_CLASSES[row.tone];
  }

  monthLabel(row: DeadlineRow): string {
    const [y, m, d] = row.dueDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short' });
  }

  dayLabel(row: DeadlineRow): string {
    return String(Number(row.dueDate.slice(8, 10)));
  }
}
