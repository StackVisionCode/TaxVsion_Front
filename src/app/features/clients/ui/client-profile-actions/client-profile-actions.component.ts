import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { WorkspaceLink } from '../../data-access/client-workspace-links';

/**
 * Grupo "Actions" del header del perfil: los atajos del workspace del cliente (SMS, reunión,
 * correo, firma). Presentacional: el contenedor decide qué se ve (permisos + plan) y arma los
 * deep links; aquí solo se pintan. SMS es un modal local, por eso es un evento y no un link.
 */
@Component({
  selector: 'app-client-profile-actions',
  imports: [CommonModule, RouterModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-actions.component.html',
})
export class ClientProfileActionsComponent {
  @Input() canSms = false;
  @Input() emailLink: WorkspaceLink | null = null;
  @Input() meetingLink: WorkspaceLink | null = null;
  @Input() signatureLink: WorkspaceLink | null = null;

  @Output() sendSms = new EventEmitter<void>();

  get hasAny(): boolean {
    return this.canSms || !!this.emailLink || !!this.meetingLink || !!this.signatureLink;
  }
}
