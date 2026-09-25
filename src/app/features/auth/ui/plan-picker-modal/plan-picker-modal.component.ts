import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { formatBytes } from '@core/cloud-storage/cloud-storage.model';
import { toApiError } from '@core/models/api-error.model';
import { Plan } from '@core/plans/plan.model';
import { PlansService } from '@core/plans/plans.service';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';

export type BillingCycle = 'Monthly' | 'Yearly';

/** Lo que el modal devuelve al elegir: el plan y el ciclo con el que se mostró el precio. */
export interface PlanChoice {
  plan: Plan;
  cycle: BillingCycle;
}

/** Nombres legibles de los módulos que llegan como códigos en `enabledModules`. */
const MODULE_LABELS: Record<string, string> = {
  customers: 'Client management',
  documents: 'Documents & storage',
  signatures: 'E-signatures',
  email: 'Email inbox',
  comms: 'Team chat & meetings',
  campaigns: 'Email campaigns',
  marketing: 'Marketing tools',
  reports: 'Reports',
  miles: 'Mileage tracking',
  builder: 'Form builder',
  planner: 'Task planner',
  irs: 'IRS tools',
};

/**
 * Catálogo público de planes (`GET /plans`) en un modal, para elegir antes de empezar
 * el alta. Precios y límites salen del backend — nada hardcodeado: el precio depende del
 * ciclo (`pricesUsdByCycle`) y los beneficios son los `enabledModules` de cada plan más
 * sus cupos reales de usuarios y almacenamiento.
 *
 * Solo elige: no crea nada. El alta sigue en el Landing, al que se llega con el plan ya seleccionado.
 */
@Component({
  selector: 'app-plan-picker-modal',
  imports: [CommonModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './plan-picker-modal.component.html',
})
export class PlanPickerModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();
  @Output() planChosen = new EventEmitter<PlanChoice>();

  private readonly catalog = inject(PlansService);

  readonly plans = signal<Plan[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly cycle = signal<BillingCycle>('Monthly');

  private loaded = false;

  /** Los planes se piden al abrir, no al construir: el modal vive en el login. */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && !this.loaded) {
      this.load();
    }
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.catalog.list().subscribe({
      next: plans => {
        // De más barato a más caro: el catálogo llega sin orden garantizado.
        this.plans.set([...plans].sort((a, b) => a.monthlyPriceUsd - b.monthlyPriceUsd));
        this.loaded = true;
        this.loading.set(false);
      },
      error: err => {
        this.error.set(toApiError(err).message);
        this.loading.set(false);
      },
    });
  }

  /** Solo se ofrece el ciclo anual si algún plan lo soporta. */
  readonly yearlyAvailable = computed(() =>
    this.plans().some(plan => plan.supportedBillingCycles?.includes('Yearly')),
  );

  setCycle(cycle: BillingCycle): void {
    this.cycle.set(cycle);
  }

  priceFor(plan: Plan): number {
    return plan.pricesUsdByCycle?.[this.cycle()] ?? plan.monthlyPriceUsd;
  }

  /** "$129" o "$1,290" — sin decimales cuando son redondos, como en el resto de la app. */
  formatPrice(amount: number): string {
    return amount.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }

  cycleSuffix(): string {
    return this.cycle() === 'Yearly' ? '/year' : '/month';
  }

  /** Meses de descuento del plan anual frente a 12 mensualidades (0 si no hay ahorro). */
  yearlySavingMonths(plan: Plan): number {
    const yearly = plan.pricesUsdByCycle?.['Yearly'];
    const monthly = plan.pricesUsdByCycle?.['Monthly'] ?? plan.monthlyPriceUsd;
    if (!yearly || !monthly) {
      return 0;
    }
    const saved = monthly * 12 - yearly;
    return saved > 0 ? Math.round(saved / monthly) : 0;
  }

  storageLabel(plan: Plan): string {
    return formatBytes(plan.storageQuotaBytes);
  }

  moduleLabel(code: string): string {
    return MODULE_LABELS[code] ?? code;
  }

  choose(plan: Plan): void {
    this.planChosen.emit({ plan, cycle: this.cycle() });
  }

  close(): void {
    this.closed.emit();
  }
}
