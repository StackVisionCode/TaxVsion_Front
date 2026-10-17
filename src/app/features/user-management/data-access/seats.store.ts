import { Injectable, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { SeatResponse } from './seats.model';
import { SeatsService } from './seats.service';

const PAGE_SIZE = 20;

/**
 * Lista paginada de asientos comprados. La compra vive en `SeatPurchaseStore`; acá solo se enumera el
 * pool actual (ej. para mostrar un contador o un breakdown). No hay flujo de asignación manual: el seat
 * se consume lógicamente al invitar (`PlanGuard.EnsureSeatAvailableAsync` en el backend).
 */
@Injectable({ providedIn: 'root' })
export class SeatsStore {
  private readonly service = inject(SeatsService);

  readonly pageSize = PAGE_SIZE;

  readonly seats = signal<SeatResponse[]>([]);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  load(page = this.page()): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.getSeats(page, PAGE_SIZE).subscribe({
      next: result => {
        this.seats.set(result.items ?? []);
        this.total.set(result.totalCount ?? 0);
        this.page.set(page);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(toApiError(err).message);
        this.loading.set(false);
      },
    });
  }
}
