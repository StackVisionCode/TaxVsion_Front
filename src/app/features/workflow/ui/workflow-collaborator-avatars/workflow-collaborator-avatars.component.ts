import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { initialsOf } from '@shared/utils/avatar.util';
import { WorkflowCollaborator } from '../../data-access/workflow.model';

/**
 * Círculos de la gente del workflow, con overflow "+N".
 *
 * Pinta desde el snapshot guardado en el documento (nombre/email), así que no
 * depende de la red: los avatares salen en el primer frame aunque
 * `/auth/users` no responda. Presentacional puro.
 */
@Component({
  selector: 'app-workflow-collaborator-avatars',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workflow-collaborator-avatars.component.html',
  styleUrl: './workflow-collaborator-avatars.component.css',
})
export class WorkflowCollaboratorAvatarsComponent {
  @Input() collaborators: WorkflowCollaborator[] = [];
  @Input() max = 3;

  @Output() open = new EventEmitter<void>();

  get visible(): WorkflowCollaborator[] {
    return this.collaborators.slice(0, this.max);
  }

  get overflow(): number {
    return Math.max(0, this.collaborators.length - this.max);
  }

  initials(collaborator: WorkflowCollaborator): string {
    return initialsOf(collaborator.name || collaborator.email);
  }

  /** Acento por orden de aparición: Twilight, Star, Azure (paleta Taxoffix). */
  tone(index: number): string {
    return ['bg-[#083645] text-white', 'bg-[#057BC1] text-white', 'bg-[#4DD8FF] text-[#083645]'][index % 3];
  }

  title(collaborator: WorkflowCollaborator): string {
    return `${collaborator.name} · ${collaborator.role}`;
  }
}
