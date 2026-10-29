import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StaffDirectoryStore } from '@core/staff/staff-directory.store';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { WorkflowCollaborator } from '../../data-access/workflow.model';

/**
 * Círculos de la gente del workflow, con overflow "+N".
 *
 * Pinta desde el snapshot guardado en el documento (nombre/email), así que no
 * depende de la red: los avatares salen en el primer frame aunque
 * `/auth/users` no responda. La foto (si la hay) llega después desde el directorio de staff
 * compartido; mientras tanto, o sin foto, quedan las iniciales con el color de su userId.
 */
@Component({
  selector: 'app-workflow-collaborator-avatars',
  imports: [CommonModule, AvatarComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workflow-collaborator-avatars.component.html',
  styleUrl: './workflow-collaborator-avatars.component.css',
})
export class WorkflowCollaboratorAvatarsComponent {
  @Input() collaborators: WorkflowCollaborator[] = [];
  @Input() max = 3;

  @Output() open = new EventEmitter<void>();

  protected readonly staff = inject(StaffDirectoryStore);

  constructor() {
    this.staff.ensureLoaded();
  }

  get visible(): WorkflowCollaborator[] {
    return this.collaborators.slice(0, this.max);
  }

  get overflow(): number {
    return Math.max(0, this.collaborators.length - this.max);
  }

  title(collaborator: WorkflowCollaborator): string {
    return `${collaborator.name} · ${collaborator.role}`;
  }
}
