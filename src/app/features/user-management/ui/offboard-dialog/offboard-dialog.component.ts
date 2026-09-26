import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { TeamMember } from '../user-table/user-table.component';
import { EligibleSuccessor, OffboardImpactItem } from '../../data-access/user-management.model';
import { UserManagementService } from '../../data-access/user-management.service';

/**
 * Diálogo de "Remove from office" (punto 3.2, FE-2). Al abrir compone la preview de impacto con un
 * fan-out a los 7 servicios (`getOffboardImpact`, degradación por-servicio) y carga los sucesores
 * elegibles. El admin elige a quién se reasigna el trabajo activo (o lo deja sin asignar = a la oficina),
 * confirma que es irreversible, y `confirmed` emite el `successorUserId` (null = oficina). Se crea fresco
 * por apertura (`*ngIf` en el padre), así el estado siempre arranca limpio. Colores de acción = marca de
 * la oficina (`brand-bold`).
 */
@Component({
  selector: 'app-offboard-dialog',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './offboard-dialog.component.html',
})
export class OffboardDialogComponent implements OnInit {
  private readonly service = inject(UserManagementService);

  @Input({ required: true }) member!: TeamMember;
  /** Emite el successorUserId elegido (null = dejar sin asignar / rutar a la oficina). */
  @Output() confirmed = new EventEmitter<string | null>();
  @Output() cancelled = new EventEmitter<void>();

  readonly impact = signal<OffboardImpactItem[]>([]);
  readonly impactLoading = signal(true);
  readonly successors = signal<EligibleSuccessor[]>([]);
  /** '' = dejar sin asignar (rutar a la oficina); si no, el id del sucesor. */
  readonly successorId = signal('');
  readonly acknowledged = signal(false);
  readonly submitting = signal(false);

  /** Algún servicio no respondió su count: se avisa en vez de mentir con un 0. */
  readonly hasUnavailable = computed(() => this.impact().some(item => !item.available));

  ngOnInit(): void {
    this.service.getOffboardImpact(this.member.id).subscribe({
      next: items => {
        this.impact.set(items);
        this.impactLoading.set(false);
      },
      error: () => this.impactLoading.set(false),
    });
    this.service.getEligibleSuccessors(this.member.id).subscribe({
      next: list => this.successors.set(list),
      error: () => this.successors.set([]),
    });
  }

  confirm(): void {
    if (!this.acknowledged() || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.confirmed.emit(this.successorId() || null);
  }
}
