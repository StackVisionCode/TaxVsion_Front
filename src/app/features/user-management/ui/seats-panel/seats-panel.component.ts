import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { parseUtcDateOrNull } from '../../../../shared/utils/utc-date.util';
import { SeatResponse, statusTone } from '../../data-access/seats.model';
import { SeatsStore } from '../../data-access/seats.store';
import { TeamMember } from '../user-table/user-table.component';

/**
 * Quién ocupa cada asiento comprado. Vive junto a las personas porque es lo que se decide sobre ellas;
 * comprar asientos es un cobro y eso se hace en el Account (o con el modal de compra de esta misma pantalla).
 */
@Component({
  selector: 'app-seats-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent, PaginationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './seats-panel.component.html',
})
export class SeatsPanelComponent {
  /** Los mismos compañeros que ya cargó la pantalla: no se vuelven a pedir. */
  readonly teammates = input<TeamMember[]>([]);

  readonly store = inject(SeatsStore);

  readonly assignTarget = signal<SeatResponse | null>(null);
  readonly assignUserId = signal('');
  readonly assignReason = signal('');
  readonly isReassign = computed(() => !!this.assignTarget()?.currentUserId);

  readonly releaseTarget = signal<SeatResponse | null>(null);
  readonly releaseReason = signal('');

  constructor() {
    this.store.load(1);
  }

  tone(status: string): 'active' | 'warning' | 'ended' | 'neutral' {
    return statusTone(status);
  }

  date(value: string | null): Date | null {
    return parseUtcDateOrNull(value);
  }

  userLabel(userId: string | null): string {
    if (!userId) {
      return 'Unassigned';
    }
    const user = this.teammates().find(candidate => candidate.id === userId);
    return user ? user.name : userId;
  }

  openAssign(seat: SeatResponse): void {
    this.assignTarget.set(seat);
    this.assignUserId.set('');
    this.assignReason.set('');
    this.store.actionError.set(null);
  }

  confirmAssign(): void {
    const seat = this.assignTarget();
    const userId = this.assignUserId();
    if (!seat || !userId) {
      return;
    }
    const done = () => this.assignTarget.set(null);
    if (seat.currentUserId) {
      this.store.reassign(seat.id, userId, this.assignReason().trim() || null, done);
      return;
    }
    this.store.assign(seat.id, userId, done);
  }

  openRelease(seat: SeatResponse): void {
    this.releaseTarget.set(seat);
    this.releaseReason.set('');
    this.store.actionError.set(null);
  }

  confirmRelease(): void {
    const seat = this.releaseTarget();
    if (!seat) {
      return;
    }
    this.store.release(seat.id, this.releaseReason().trim() || null, () => this.releaseTarget.set(null));
  }
}
