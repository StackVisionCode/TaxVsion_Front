import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { TeamMember } from '../user-table/user-table.component';
import {
  EligibleSuccessor,
  OFFBOARDING_NOTE_MAX,
  OFFBOARDING_REASONS,
  OffboardImpactItem,
  OffboardRequest,
  OffboardingReason,
} from '../../data-access/user-management.model';
import { UserManagementService } from '../../data-access/user-management.service';
import { OffboardImpactService } from '../../data-access/offboard-impact.service';

/**
 * Diálogo de "Offboard" (desvincular) (punto 3.2, FE-2). Al abrir compone la preview de impacto con un
 * fan-out a los servicios que Auth declara (`getOffboardImpact`, degradación por-servicio) y carga los sucesores
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
  private readonly impactService = inject(OffboardImpactService);

  @Input({ required: true }) member!: TeamMember;
  /** El padre está ejecutando el retiro: botón en espera y sin poder confirmar dos veces. */
  @Input() busy = false;
  /** Emite el sucesor elegido (null = sin sucesor) y el motivo opcional. */
  @Output() confirmed = new EventEmitter<OffboardRequest>();
  @Output() cancelled = new EventEmitter<void>();

  readonly impact = signal<OffboardImpactItem[]>([]);
  readonly impactLoading = signal(true);
  readonly successors = signal<EligibleSuccessor[]>([]);
  /** '' = dejar sin asignar (rutar a la oficina); si no, el id del sucesor. */
  readonly successorId = signal('');
  readonly acknowledged = signal(false);
  /** Motivo opcional ('' = sin motivo) y su nota; solo lo ven los admins en la ficha del retiro. */
  readonly reasons = OFFBOARDING_REASONS;
  readonly noteMax = OFFBOARDING_NOTE_MAX;
  readonly reason = signal<OffboardingReason | ''>('');
  readonly reasonNote = signal('');

  /** Algún servicio no respondió su count: se avisa en vez de mentir con un 0. */
  readonly hasUnavailable = computed(() => this.impact().some(item => !item.available));

  /** No se pudo saber nada (ni siquiera qué servicios participan): no decir "nada asignado". */
  readonly impactUnknown = computed(() => this.impact().length > 0 && this.impact().every(item => !item.available));

  /** Solo lo que tiene algo: una lista de ceros no le dice nada a quien decide. */
  readonly affected = computed(() => this.impact().filter(item => item.available && item.count > 0));

  private readonly successorName = computed(
    () => this.successors().find(successor => successor.id === this.successorId())?.name ?? null,
  );

  /** Lo que de verdad pasa con ese renglón según haya o no sucesor. */
  actionFor(item: OffboardImpactItem): string {
    const name = this.successorName();
    return name ? item.withSuccessor.replace('{name}', name) : item.withoutSuccessor;
  }

  ngOnInit(): void {
    this.impactService.getOffboardImpact(this.member.id, this.member.email).subscribe({
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
    if (!this.acknowledged() || this.busy) {
      return;
    }
    const note = this.reasonNote().trim();
    this.confirmed.emit({
      successorUserId: this.successorId() || null,
      reason: this.reason() || null,
      // La nota acompaña al motivo: sin motivo no se manda.
      reasonNote: this.reason() && note ? note.slice(0, this.noteMax) : null,
    });
  }
}
