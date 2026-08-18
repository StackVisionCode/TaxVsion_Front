import { Injectable, computed, inject, signal } from '@angular/core';
import { PlansService } from './plans.service';
import { Plan } from './plan.model';

/** Store de signals de la feature Planes (provisto en el route config; se destruye al salir). */
@Injectable()
export class PlansStore {
  private readonly service = inject(PlansService);

  readonly plans = signal<Plan[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly hasPlans = computed(() => this.plans().length > 0);

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().subscribe({
      next: plans => {
        this.plans.set([...plans].sort((a, b) => a.monthlyPriceUsd - b.monthlyPriceUsd));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar los planes.');
        this.loading.set(false);
      },
    });
  }
}
