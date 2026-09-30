import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { SeatResponse } from './seats.model';
import { SeatsService } from './seats.service';

const PAGE_SIZE = 20;

/**
 * Lista de asientos comprados y a quién está asignado cada uno. Comprar vive en `SeatPurchaseStore`; acá
 * solo se reparte lo ya comprado, que es lo propio del espacio de trabajo.
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
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);

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

  assign(id: string, userId: string, onDone: () => void): void {
    this.run(this.service.assignSeat(id, { userId }), onDone);
  }

  release(id: string, reason: string | null, onDone: () => void): void {
    this.run(this.service.releaseSeat(id, { reason }), onDone);
  }

  reassign(id: string, toUserId: string, reason: string | null, onDone: () => void): void {
    this.run(this.service.reassignSeat(id, { toUserId, reason }), onDone);
  }

  private run(action: Observable<unknown>, onDone: () => void): void {
    this.busy.set(true);
    this.actionError.set(null);
    action.subscribe({
      next: () => {
        this.busy.set(false);
        this.load();
        onDone();
      },
      error: err => {
        this.busy.set(false);
        this.actionError.set(toApiError(err).message);
      },
    });
  }
}
